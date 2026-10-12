import type { CatalogResult, Person, Provider } from '@cenora/shared';
import { ApiError, type Env } from './lib';
type Json = Record<string, any>;
const image = (path: string | null | undefined, size = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
async function cached(env: Env, key: string, seconds: number, load: () => Promise<Json>) {
  const row = await env.DB.prepare(
    'SELECT payload,expires_at,updated_at FROM provider_cache WHERE key=?',
  )
    .bind(key)
    .first<{ payload: string; expires_at: number; updated_at: string }>();
  if (row && row.expires_at > Date.now())
    return { data: JSON.parse(row.payload) as Json, stale: false, updatedAt: row.updated_at };
  try {
    const data = await load();
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO provider_cache (key,payload,expires_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,updated_at=excluded.updated_at',
    )
      .bind(key, JSON.stringify(data), Date.now() + seconds * 1000, updatedAt)
      .run();
    return { data, stale: false, updatedAt };
  } catch (e) {
    if (row)
      return { data: JSON.parse(row.payload) as Json, stale: true, updatedAt: row.updated_at };
    throw e;
  }
}
async function tmdb(env: Env, path: string) {
  if (!env.TMDB_TOKEN)
    throw new ApiError(
      503,
      'CATALOG_UNAVAILABLE',
      'A busca de filmes ainda não está configurada. Você pode adicionar um título manualmente.',
    );
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.searchParams.set('language', 'pt-BR');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (env.TMDB_TOKEN.length < 50) url.searchParams.set('api_key', env.TMDB_TOKEN);
  else headers.Authorization = `Bearer ${env.TMDB_TOKEN}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok)
    throw new ApiError(
      503,
      'PROVIDER_UNAVAILABLE',
      'A busca está indisponível por enquanto. Tente novamente ou adicione manualmente.',
    );
  return (await res.json()) as Json;
}
export async function searchCatalog(
  env: Env,
  clubId: string,
  query: string,
  page: number,
): Promise<{ results: CatalogResult[]; page: number; totalPages: number; available: boolean }> {
  if (!env.TMDB_TOKEN) return { results: [], page, totalPages: 0, available: false };
  const result = await cached(env, `search:${query.toLocaleLowerCase('pt-BR')}:${page}`, 3600, () =>
    tmdb(env, `search/multi?query=${encodeURIComponent(query)}&page=${page}&include_adult=false`),
  );
  const items = (result.data.results || []).filter(
    (r: Json) => r.media_type === 'movie' || r.media_type === 'tv',
  );
  const results: CatalogResult[] = [];
  for (const r of items) {
    const kind = r.media_type as 'movie' | 'tv';
    const existing = await env.DB.prepare(
      'SELECT id FROM media WHERE tmdb_id=? AND kind=? AND club_id=?',
    )
      .bind(r.id, kind, clubId)
      .first<{ id: string }>();
    results.push({
      tmdbId: r.id,
      title: r.title || r.name,
      kind,
      year: parseInt((r.release_date || r.first_air_date || '').slice(0, 4)) || null,
      posterUrl: image(r.poster_path),
      synopsis: r.overview || '',
      existingId: existing?.id || null,
    });
  }
  return {
    results,
    page,
    totalPages: Math.min(result.data.total_pages || 0, 500),
    available: true,
  };
}
export async function catalogDetails(env: Env, kind: 'movie' | 'tv', tmdbId: number) {
  const result = await cached(env, `details:${kind}:${tmdbId}`, 7 * 86400, () =>
    tmdb(env, `${kind}/${tmdbId}?append_to_response=credits,external_ids`),
  );
  const r = result.data;
  return {
    title: r.title || r.name,
    year: parseInt((r.release_date || r.first_air_date || '').slice(0, 4)) || null,
    synopsis: r.overview || '',
    posterUrl: image(r.poster_path, 'w500'),
    tmdbRating: r.vote_count ? r.vote_average : null,
    runtime: r.runtime || r.episode_run_time?.[0] || null,
    genres: (r.genres || []).map((g: Json) => g.name),
    cast: (r.credits?.cast || []).slice(0, 12).map((p: Json): Person => ({
      id: p.id,
      name: p.name,
      character: p.character || '',
      photo: image(p.profile_path, 'w185'),
    })),
    imdbId: r.imdb_id || r.external_ids?.imdb_id || null,
    stale: result.stale,
  };
}
export async function availability(env: Env, kind: 'movie' | 'tv', tmdbId: number) {
  const result = await cached(env, `providers:${kind}:${tmdbId}:BR`, 86400, () =>
    tmdb(env, `${kind}/${tmdbId}/watch/providers`),
  );
  const br = result.data.results?.BR;
  const map = (items: Json[] = []): Provider[] =>
    items.map((p) => ({
      id: p.provider_id,
      name: p.provider_name,
      logo: image(p.logo_path, 'w92'),
    }));
  return {
    subscription: map(br?.flatrate),
    rent: map(br?.rent),
    buy: map(br?.buy),
    link: br?.link || null,
    updatedAt: result.updatedAt,
    stale: result.stale,
  };
}
export async function imdbRating(env: Env, imdbId: string | null) {
  if (!env.OMDB_KEY || !imdbId || !/^tt\d+$/.test(imdbId)) return null;
  try {
    const r = await cached(env, `imdb:${imdbId}`, 7 * 86400, async () => {
      const url = new URL('https://www.omdbapi.com/');
      url.searchParams.set('apikey', env.OMDB_KEY!);
      url.searchParams.set('i', imdbId);
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error('OMDb');
      return (await res.json()) as Json;
    });
    return parseFloat(r.data.imdbRating) || null;
  } catch {
    return null;
  }
}
export async function biography(env: Env, personId: number) {
  const r = await cached(env, `person:${personId}`, 7 * 86400, () =>
    tmdb(env, `person/${personId}`),
  );
  return {
    name: r.data.name,
    biography: r.data.biography || 'Biografia ainda não disponível em português.',
    photo: image(r.data.profile_path, 'w342'),
    birthday: r.data.birthday || null,
  };
}
