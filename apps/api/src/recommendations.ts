import type {
  CatalogResult,
  Media,
  Recommendations,
  RelatedTitles,
  ShelfKind,
} from '@cenora/shared';
import { normalizeName } from '@cenora/shared';
import type { Env } from './lib';
import { recommendationCatalog } from './providers';

/** Contextual recommendations use only the opened title, regardless of personal ratings. */
export async function relatedTitles(
  env: Env,
  title: Media,
  clubTitles: Pick<Media, 'id' | 'tmdbId' | 'kind' | 'isAnime'>[],
): Promise<RelatedTitles> {
  if (!env.TMDB_TOKEN || !title.tmdbId) return { results: [], available: false, stale: false };
  const result = await recommendationCatalog(
    env,
    title.isAnime ? 'anime' : title.kind,
    title.tmdbId,
  );
  return {
    results: result.items
      .filter((item) => item.tmdbId !== title.tmdbId)
      .slice(0, 8)
      .map((item) => {
        const existing = clubTitles.find((m) => m.kind === item.kind && m.tmdbId === item.tmdbId);
        return {
          ...item,
          existingId: existing?.id ?? null,
          isAnime: existing?.isAnime ?? item.isAnime,
        };
      }),
    available: true,
    stale: result.stale,
  };
}

/** A bounded, deterministic layer over TMDB recommendations, not a trained model. */
export async function recommendations(
  env: Env,
  kind: ShelfKind,
  clubTitles: Media[],
  mine: boolean,
  includeDiscover = false,
): Promise<Recommendations> {
  const mediaKind = kind === 'movie' ? 'movie' : 'tv';
  const titles = clubTitles.filter((m) => m.kind === mediaKind && m.isAnime === (kind === 'anime'));
  // A stored anime classification may override TMDB's heuristic. Never rediscover that title.
  const known = new Set(
    clubTitles.filter((m) => m.kind === mediaKind && m.tmdbId).map((m) => m.tmdbId),
  );
  const manual = clubTitles.filter((m) => m.kind === mediaKind && !m.tmdbId);
  const isNew = (item: CatalogResult) =>
    !known.has(item.tmdbId) &&
    !manual.some(
      (m) =>
        normalizeName(m.title) === normalizeName(item.title) &&
        (m.year === null || item.year === null || m.year === item.year),
    );
  const seeds = titles
    .filter(
      (m) =>
        m.tmdbId && m.personal && m.personal.status !== 'dropped' && (m.personal.rating ?? 0) >= 7,
    )
    .sort((a, b) => b.personal!.rating! - a.personal!.rating! || a.id.localeCompare(b.id))
    .slice(0, 4);
  const candidates = new Map<number, { item: CatalogResult; weight: number; reason: string }>();
  let degraded = false;
  let stale = false;
  let personalized = false;
  const collect = (items: CatalogResult[], seed?: Media) => {
    for (const [index, item] of items.entries()) {
      const weight = (seed?.personal?.rating ?? 5) / (index + 5);
      const previous = candidates.get(item.tmdbId);
      if (previous) previous.weight += weight;
      else
        candidates.set(item.tmdbId, {
          item,
          weight,
          reason: seed ? `Porque você gostou de ${seed.title}` : 'Em destaque no TMDB',
        });
    }
  };
  if (env.TMDB_TOKEN) {
    const results = await Promise.allSettled(
      seeds.map((seed) => recommendationCatalog(env, kind, seed.tmdbId!)),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        collect(result.value.items, seeds[index]);
        stale ||= result.value.stale;
        personalized ||= result.value.items.length > 0;
      } else degraded = true;
    }
    // An empty recommendation feed should not strand a new member or a niche title.
    if (includeDiscover && ![...candidates.values()].some((c) => isNew(c.item))) {
      try {
        const result = await recommendationCatalog(env, kind);
        collect(result.items);
        stale ||= result.stale;
      } catch {
        degraded = true;
      }
    }
  }
  const discover = (includeDiscover ? [...candidates.values()] : [])
    .filter((c) => isNew(c.item))
    .sort((a, b) => b.weight - a.weight || a.item.tmdbId - b.item.tmdbId)
    .slice(0, 12)
    .map((c) => ({ ...c.item, reason: c.reason }));
  const shelf = titles
    .filter(
      (m) =>
        (!mine || m.personal !== null) &&
        (mine || m.groupStatus !== 'watched') &&
        m.personal?.status !== 'watched' &&
        m.personal?.status !== 'dropped' &&
        (m.personal?.rating == null || m.personal.rating > 4),
    )
    .map((m) => {
      const match = m.tmdbId ? candidates.get(m.tmdbId) : undefined;
      const intent = m.personal?.status === 'watching' ? 2 : m.personal?.status === 'want' ? 1 : 0;
      const weight = (match?.weight ?? 0) * 10 + intent + (m.average ?? 0) / 10;
      const reason =
        match?.reason ??
        (m.personal?.status === 'watching'
          ? 'Continue o que você está assistindo'
          : m.personal?.status === 'want'
            ? 'Está na sua lista de desejos'
            : m.ratingCount > 0
              ? 'Avaliado pelo seu clube'
              : 'Ainda esperando uma primeira sessão');
      return { item: { ...m, reason }, weight };
    })
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        a.item.title.localeCompare(b.item.title, 'pt-BR') ||
        a.item.id.localeCompare(b.item.id),
    )
    .slice(0, 12)
    .map((c) => c.item);
  return {
    shelf,
    discover,
    personalized,
    catalogAvailable: Boolean(env.TMDB_TOKEN),
    degraded,
    stale,
  };
}
