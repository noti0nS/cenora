import { normalizeName, type ImportEntry, type PersonalStatus } from '@cenora/shared';

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const clean = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.trim() || row.some(Boolean)) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function clampRating(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0.5) return null;
  const rounded = Math.round(Math.min(10, value) * 2) / 2;
  return rounded >= 0.5 && rounded <= 10 ? rounded : null;
}

function validYear(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '').trim(), 10);
  return Number.isInteger(n) && n >= 1888 && n <= 2100 ? n : null;
}

function parseCsvImport(text: string, filename = ''): ImportEntry[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => normalizeName(h));
  const col = (...names: string[]) => {
    for (const name of names) {
      const idx = headers.indexOf(normalizeName(name));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  // IMDb CSV (Const, Title, Original Title, Title Type, Year, Your Rating)
  const imdbTitleIdx = col('Title');
  const imdbTypeIdx = col('Title Type');
  if (imdbTitleIdx !== -1 && (imdbTypeIdx !== -1 || col('Const') !== -1)) {
    const origIdx = col('Original Title');
    const yearIdx = col('Year');
    const ratingIdx = col('Your Rating');
    const entries: ImportEntry[] = [];
    for (const row of rows.slice(1)) {
      const title = (row[imdbTitleIdx] || '').trim();
      if (!title) continue;
      const rawType = normalizeName(row[imdbTypeIdx] || '');
      const isTv = rawType.includes('tvseries') || rawType.includes('tvminiseries');
      const rating = ratingIdx !== -1 ? clampRating(parseFloat(row[ratingIdx] || '')) : null;
      const originalTitle = origIdx !== -1 ? (row[origIdx] || '').trim() : '';
      entries.push({
        title: title.slice(0, 200),
        ...(originalTitle && originalTitle !== title
          ? { originalTitle: originalTitle.slice(0, 200) }
          : {}),
        year: yearIdx !== -1 ? validYear(row[yearIdx]) : null,
        kind: isTv ? 'tv' : 'movie',
        category: isTv ? 'Séries' : 'Filmes',
        personalStatus: rating ? 'watched' : 'want',
        ...(rating ? { personalRating: rating } : {}),
      });
    }
    return entries;
  }

  // Letterboxd CSV (Date, Name, Year, Letterboxd URI, Rating)
  const lbNameIdx = col('Name', 'Title', 'Título');
  if (lbNameIdx !== -1) {
    const yearIdx = col('Year', 'Ano');
    const ratingIdx = col('Rating', 'Nota');
    const isWatchlist = normalizeName(filename).includes('watchlist');
    const entries: ImportEntry[] = [];
    for (const row of rows.slice(1)) {
      const title = (row[lbNameIdx] || '').trim();
      if (!title) continue;
      const rawRating = ratingIdx !== -1 ? parseFloat(row[ratingIdx] || '') : NaN;
      // Letterboxd uses 0.5..5.0; convert to Cenora's 1.0..10.0 scale when <= 5
      const scaled = Number.isFinite(rawRating)
        ? rawRating <= 5 && !headers.includes('nota')
          ? rawRating * 2
          : rawRating
        : null;
      const rating = clampRating(scaled);
      entries.push({
        title: title.slice(0, 200),
        year: yearIdx !== -1 ? validYear(row[yearIdx]) : null,
        kind: 'movie',
        category: 'Filmes',
        personalStatus: rating ? 'watched' : isWatchlist ? 'want' : 'watched',
        ...(rating ? { personalRating: rating } : {}),
      });
    }
    return entries;
  }

  return [];
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function xmlTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeXmlEntities(match[1]) : '';
}

function parseMalXmlImport(text: string): ImportEntry[] {
  const blocks = text.match(/<anime>[\s\S]*?<\/anime>/gi) ?? [];
  const entries: ImportEntry[] = [];
  for (const block of blocks) {
    const title = xmlTag(block, 'series_title');
    if (!title) continue;
    const seriesType = normalizeName(xmlTag(block, 'series_type'));
    const isMovie = seriesType === 'movie';
    const rawStatus = normalizeName(xmlTag(block, 'my_status'));
    const statusMap: Record<string, PersonalStatus> = {
      completed: 'watched',
      '2': 'watched',
      watching: 'watching',
      '1': 'watching',
      dropped: 'dropped',
      '4': 'dropped',
      'plan to watch': 'want',
      '6': 'want',
      'on-hold': 'watching',
      '3': 'watching',
    };
    const personalStatus = statusMap[rawStatus] ?? 'want';
    const rawScore = parseFloat(xmlTag(block, 'my_score'));
    const personalRating = clampRating(rawScore > 0 ? rawScore : null);
    const watchedEpisodes = parseInt(xmlTag(block, 'my_watched_episodes'), 10);
    entries.push({
      title: title.slice(0, 200),
      kind: isMovie ? 'movie' : 'tv',
      category: isMovie ? 'Filmes' : 'Animes',
      personalStatus,
      ...(personalRating ? { personalRating } : {}),
      ...(!isMovie && Number.isInteger(watchedEpisodes) && watchedEpisodes > 0
        ? { personalSeason: 1, personalEpisode: Math.min(9999, watchedEpisodes) }
        : {}),
    });
  }
  return entries;
}

export function parseImportFile(
  text: string,
  filename: string,
): { entries: ImportEntry[]; truncated: boolean } {
  const lower = filename.toLowerCase();
  let parsed: ImportEntry[] = [];
  if (lower.endsWith('.xml') || text.trimStart().startsWith('<')) {
    parsed = parseMalXmlImport(text);
  } else if (lower.endsWith('.csv')) {
    parsed = parseCsvImport(text, filename);
  } else {
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json)) {
        parsed = json;
      } else if (json && Array.isArray(json.entries)) {
        parsed = json.entries;
      } else if (json && Array.isArray(json.media)) {
        parsed = json.media.map((m: Record<string, unknown>) => ({
          title: String(m.title ?? ''),
          kind: m.kind === 'tv' ? 'tv' : 'movie',
          category: m.is_anime || m.isAnime ? 'Animes' : m.kind === 'tv' ? 'Séries' : 'Filmes',
          ...(typeof m.year === 'number' ? { year: m.year } : {}),
          ...(typeof m.tmdb_id === 'number'
            ? { tmdbId: m.tmdb_id }
            : typeof m.tmdbId === 'number'
              ? { tmdbId: m.tmdbId }
              : {}),
        }));
      }
    } catch {
      parsed = parseCsvImport(text, filename);
    }
  }
  // Deduplicate by (category, normalized title) while keeping the richest entry
  const unique = new Map<string, ImportEntry>();
  for (const item of parsed) {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) continue;
    const key = `${normalizeName(item.category || 'Filmes')}:${normalizeName(item.title)}`;
    const prev = unique.get(key);
    if (!prev || (!prev.personalRating && item.personalRating)) {
      unique.set(key, item);
    }
  }
  const all = [...unique.values()];
  return {
    entries: all.slice(0, 100),
    truncated: all.length > 100,
  };
}
