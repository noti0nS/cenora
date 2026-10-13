import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Media } from '@cenora/shared';
import type { Env } from '../src/lib';
import { recommendations, relatedTitles } from '../src/recommendations';

function media(id: number, overrides: Partial<Media> = {}): Media {
  return {
    id: `media-${id}`,
    title: `Título ${id}`,
    kind: 'movie',
    isAnime: false,
    year: 2020,
    synopsis: '',
    posterUrl: null,
    tmdbId: id,
    tmdbRating: null,
    groupStatus: 'planned',
    groupSeason: null,
    groupEpisode: null,
    revision: 0,
    average: null,
    ratingCount: 0,
    personal: null,
    ...overrides,
  };
}
const personal = (
  rating: number | null,
  status: 'watched' | 'want' | 'watching' | 'dropped' = 'watched',
) => ({
  rating,
  status,
  season: null,
  episode: null,
  revision: 1,
});
const catalog = (id: number, extra = {}) => ({ id, title: `Catálogo ${id}`, ...extra });

/** Models only the provider cache; ranking itself uses ordinary shared Media values. */
function environment(token: string | undefined = 'test-token') {
  const rows = new Map<string, { payload: string; expires_at: number; updated_at: string }>();
  const env = {
    TMDB_TOKEN: token,
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => rows.get(String(args[0])) ?? null,
          run: async () => {
            expect(sql).toContain('INSERT INTO provider_cache');
            rows.set(String(args[0]), {
              payload: String(args[1]),
              expires_at: Number(args[2]),
              updated_at: String(args[3]),
            });
          },
        }),
      }),
    },
  } as unknown as Env;
  return { env, rows };
}
afterEach(() => vi.unstubAllGlobals());

describe('TMDB recommendations', () => {
  it('combines favorite seeds, deduplicates candidates and ranks both shelf and discovery', async () => {
    const { env, rows } = environment();
    const fetch = vi.fn(async (url: URL) =>
      Response.json({
        results: url.pathname.includes('/1/')
          ? [catalog(3), catalog(10), catalog(11)]
          : [catalog(10), catalog(3)],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const titles = [
      media(1, { personal: personal(9) }),
      media(2, { personal: personal(8) }),
      media(3),
      media(4, { personal: personal(null, 'want') }),
    ];
    const result = await recommendations(env, 'movie', titles, false, true);
    expect(result.personalized).toBe(true);
    expect(result.discover.map((m) => m.tmdbId)).toEqual([10, 11]);
    expect(result.shelf.map((m) => m.id)).toEqual(['media-3', 'media-4']);
    expect(result.shelf[0].reason).toBe('Porque você gostou de Título 1');
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url] of fetch.mock.calls) {
      expect(url.searchParams.get('language')).toBe('pt-BR');
      expect(url.origin).toBe('https://api.themoviedb.org');
      expect(url.pathname).toMatch(/\/movie\/\d+\/recommendations$/);
    }
    expect([...rows.values()].every((r) => !r.payload.includes('Título'))).toBe(true);
    await recommendations(env, 'movie', titles, true);
    expect(fetch).toHaveBeenCalledTimes(2); // Only public responses are shared.
  });

  it('limits requests to four positively rated seeds, never dropped or low-rated titles', async () => {
    const { env } = environment();
    const fetch = vi.fn(async (_url: URL) => Response.json({ results: [catalog(100)] }));
    vi.stubGlobal('fetch', fetch);
    const titles = Array.from({ length: 8 }, (_, i) =>
      media(i + 1, { personal: personal(7 + i * 0.25) }),
    );
    titles.push(
      media(20, { personal: personal(10, 'dropped') }),
      media(21, { personal: personal(4) }),
    );
    await recommendations(env, 'movie', titles, false);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.map((c) => String(c[0])).join(' ')).not.toMatch(
      /\/(20|21)\/recommendations/,
    );
  });

  it('uses popular discovery without a seed and keeps anime and shows distinct', async () => {
    const { env } = environment();
    const fetch = vi.fn(async (_url: URL) =>
      Response.json({
        results: [
          catalog(10, { name: 'Anime', genre_ids: [16], origin_country: ['JP'] }),
          catalog(11, { genre_ids: [18], origin_country: ['JP'] }),
          catalog(12, { genre_ids: [16], origin_country: ['US'] }),
          catalog(13, { adult: true, genre_ids: [16], origin_country: ['JP'] }),
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const anime = await recommendations(env, 'anime', [], false, true);
    expect(anime.personalized).toBe(false);
    expect(anime.discover.map((m) => m.tmdbId)).toEqual([10]);
    expect(anime.discover[0]).toMatchObject({
      kind: 'tv',
      isAnime: true,
      reason: 'Em destaque no TMDB',
    });
    const url = fetch.mock.calls[0][0] as URL;
    expect(url.searchParams.get('with_genres')).toBe('16');
    expect(url.searchParams.get('with_origin_country')).toBe('JP');
    const shows = await recommendations(env, 'tv', [], false, true);
    expect(shows.discover.map((m) => m.tmdbId)).toEqual([11, 12]);
  });

  it('excludes existing titles even when stored anime classification differs, but not other media kinds', async () => {
    const { env } = environment();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ results: [catalog(10), catalog(11)] })),
    );
    const titles = [media(10, { kind: 'tv', isAnime: true }), media(11)];
    const result = await recommendations(env, 'tv', titles, false, true);
    expect(result.discover.map((m) => m.tmdbId)).toEqual([11]);
    expect(result.shelf).toEqual([]);
  });

  it('survives provider outages, honors personal/group exclusions and keeps manual shelf titles', async () => {
    const { env } = environment();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429 })),
    );
    const titles = [
      media(1, { personal: personal(9) }),
      media(2, { personal: personal(null, 'dropped') }),
      media(3, { personal: personal(4, 'want') }),
      media(4, { groupStatus: 'watched', personal: personal(null, 'want') }),
      media(5, { tmdbId: null, personal: personal(null, 'watching') }),
      media(6, { personal: personal(null, 'want') }),
      media(7, { average: 9, ratingCount: 2 }),
    ];
    const result = await recommendations(env, 'movie', titles, false);
    expect(result).toMatchObject({ discover: [], degraded: true, personalized: false });
    expect(result.shelf.map((m) => m.id)).toEqual(['media-5', 'media-6', 'media-7']);
    const mine = await recommendations(env, 'movie', titles, true);
    expect(mine.shelf.map((m) => m.id)).toEqual(['media-5', 'media-4', 'media-6']);
  });

  it('works without TMDB configuration and never tries an external request', async () => {
    const { env } = environment('');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await recommendations(env, 'movie', [media(1, { tmdbId: null })], false);
    expect(result).toMatchObject({ catalogAvailable: false, degraded: false, discover: [] });
    expect(result.shelf).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns stale public recommendations when TMDB fails and reports partial failures', async () => {
    const { env, rows } = environment();
    rows.set('recommendations:movie:1:pt-BR', {
      payload: JSON.stringify({ results: [catalog(10)] }),
      expires_at: 1,
      updated_at: '2026-10-01T00:00:00Z',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const result = await recommendations(
      env,
      'movie',
      [media(1, { personal: personal(9) }), media(2, { personal: personal(8) })],
      false,
      true,
    );
    expect(result).toMatchObject({ stale: true, degraded: true, personalized: true });
    expect(result.discover.map((m) => m.tmdbId)).toEqual([10]);
  });

  it('falls back to discovery for empty recommendation feeds and caps result sizes', async () => {
    const { env } = environment();
    const fetch = vi.fn(async (url: URL) =>
      Response.json({
        results: url.pathname.includes('recommendations')
          ? []
          : Array.from({ length: 30 }, (_, i) => catalog(100 + i)),
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await recommendations(
      env,
      'movie',
      [media(1, { personal: personal(9) }), ...Array.from({ length: 20 }, (_, i) => media(10 + i))],
      false,
      true,
    );
    expect(result.personalized).toBe(false);
    expect(result.discover).toHaveLength(12);
    expect(result.shelf).toHaveLength(12);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not rediscover matching manual titles and fills discovery when all matches are known', async () => {
    const { env } = environment();
    const fetch = vi.fn(async (url: URL) =>
      Response.json({
        results: url.pathname.includes('recommendations')
          ? [catalog(2), catalog(3, { title: 'A ÓRIGEM', release_date: '2010-01-01' })]
          : [catalog(10)],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await recommendations(
      env,
      'movie',
      [
        media(1, { personal: personal(9) }),
        media(2),
        media(3, { tmdbId: null, title: 'A Origem', year: 2010 }),
      ],
      false,
      true,
    );
    expect(result.discover.map((m) => m.tmdbId)).toEqual([10]);
    expect(result.shelf[0]).toMatchObject({
      id: 'media-2',
      reason: 'Porque você gostou de Título 1',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('never discovers popular titles without explicit opt-in', async () => {
    const { env } = environment();
    const fetch = vi.fn(async () => Response.json({ results: [] }));
    vi.stubGlobal('fetch', fetch);
    expect((await recommendations(env, 'movie', [media(1)], false)).discover).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    await recommendations(env, 'movie', [media(1)], false, true);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('contextual suggestions use the opened title, not personal favorites, and link existing club titles', async () => {
    const { env } = environment();
    const fetch = vi.fn(async (url: URL) => {
      expect(url.pathname).toBe('/3/tv/50/recommendations');
      return Response.json({ results: [catalog(50), catalog(51), catalog(52)] });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await relatedTitles(env, media(50, { kind: 'tv' }), [
      media(51, { kind: 'tv' }),
      media(52),
    ]);
    expect(result.results.map((m) => m.tmdbId)).toEqual([51, 52]);
    expect(result.results[0].existingId).toBe('media-51');
    expect(result.results[1].existingId).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('manual or unconfigured titles do not request contextual suggestions', async () => {
    const { env } = environment();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await relatedTitles(env, media(1, { tmdbId: null }), [])).toMatchObject({
      results: [],
      available: false,
    });
    expect(await relatedTitles(environment('').env, media(1), [])).toMatchObject({
      results: [],
      available: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
