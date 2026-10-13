import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  manualMediaSchema,
  catalogSchema,
  personalSchema,
  groupSchema,
  normalizeName,
  type Media,
  type MediaDetails,
} from '@cenora/shared';
import { ApiError, body, checkpoint, id, owner, type AppEnv } from './lib';
import { catalogDetails, availability, imdbRating, searchCatalog, biography } from './providers';

type Row = Record<string, any>;
export const mediaSelect = `WITH ratings AS (SELECT mm.media_id,AVG(mm.half_points/2.0) average,COUNT(mm.half_points) rating_count FROM member_media mm JOIN members rater ON rater.id=mm.member_id JOIN media rated ON rated.id=mm.media_id WHERE rated.club_id=? AND rater.club_id=rated.club_id AND rater.active=1 GROUP BY mm.media_id)
 SELECT m.*,r.average,COALESCE(r.rating_count,0) rating_count,p.status personal_status,p.half_points,p.season personal_season,p.episode personal_episode,p.revision personal_revision FROM media m LEFT JOIN ratings r ON r.media_id=m.id LEFT JOIN member_media p ON p.media_id=m.id AND p.member_id=?`;
export function toMedia(r: Row): Media {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    isAnime: r.kind === 'tv' && r.is_anime === 1,
    year: r.year,
    synopsis: r.synopsis,
    posterUrl: r.poster_url,
    tmdbId: r.tmdb_id,
    tmdbRating: r.tmdb_rating,
    groupStatus: r.group_status,
    groupSeason: r.group_season,
    groupEpisode: r.group_episode,
    revision: r.revision,
    average: r.average,
    ratingCount: r.rating_count,
    personal: r.personal_status
      ? {
          status: r.personal_status,
          rating: r.half_points === null ? null : r.half_points / 2,
          season: r.personal_season,
          episode: r.personal_episode,
          revision: r.personal_revision,
        }
      : null,
  };
}
export async function getMedia(c: Context<AppEnv>, mediaId: string) {
  const row = await c.env.DB.prepare(`${mediaSelect} WHERE m.id=? AND m.club_id=?`)
    .bind(c.get('club').id, c.get('member').id, mediaId, c.get('club').id)
    .first();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Este título não foi encontrado.');
  return { row: row as Row, media: toMedia(row as Row) };
}
export async function requireList(c: Context<AppEnv>, listId: string) {
  if (
    !(await c.env.DB.prepare('SELECT id FROM lists WHERE id=? AND club_id=?')
      .bind(listId, c.get('club').id)
      .first())
  ) {
    throw new ApiError(404, 'NOT_FOUND', 'A lista não foi encontrada.');
  }
}
export async function attach(c: Context<AppEnv>, listId: string, mediaId: string) {
  const scope = await c.env.DB.prepare(
    'SELECT EXISTS(SELECT 1 FROM lists WHERE id=? AND club_id=?) list_ok, EXISTS(SELECT 1 FROM media WHERE id=? AND club_id=?) media_ok',
  )
    .bind(listId, c.get('club').id, mediaId, c.get('club').id)
    .first<{ list_ok: number; media_ok: number }>();
  if (!scope?.list_ok || !scope.media_ok) {
    throw new ApiError(404, 'NOT_FOUND', 'A lista ou o título não foi encontrado.');
  }
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO list_items (list_id,media_id,added_by,position) VALUES (?,?,?,COALESCE((SELECT MAX(position)+1 FROM list_items WHERE list_id=?),0))',
  )
    .bind(listId, mediaId, c.get('member').id, listId)
    .run();
}
export async function registerCatalog(c: Context<AppEnv>, input: z.infer<typeof catalogSchema>) {
  if (
    !(await c.env.DB.prepare('SELECT id FROM lists WHERE id=? AND club_id=?')
      .bind(input.listId, c.get('club').id)
      .first())
  )
    throw new ApiError(404, 'NOT_FOUND', 'A lista não foi encontrada.');
  let existing = await c.env.DB.prepare(
    'SELECT id FROM media WHERE tmdb_id=? AND kind=? AND club_id=?',
  )
    .bind(input.tmdbId, input.kind, c.get('club').id)
    .first<{ id: string }>();
  if (!existing) {
    const r = await catalogDetails(c.env, input.kind, input.tmdbId),
      mediaId = id();
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO media (id,club_id,title,normalized_title,kind,year,synopsis,poster_url,tmdb_id,tmdb_rating,metadata,created_by,is_anime) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        mediaId,
        c.get('club').id,
        r.title,
        normalizeName(r.title),
        input.kind,
        r.year,
        r.synopsis,
        r.posterUrl,
        input.tmdbId,
        r.tmdbRating,
        JSON.stringify(r),
        c.get('member').id,
        input.kind === 'tv' && (input.isAnime ?? r.isAnime) ? 1 : 0,
      )
      .run();
    existing = await c.env.DB.prepare(
      'SELECT id FROM media WHERE tmdb_id=? AND kind=? AND club_id=?',
    )
      .bind(input.tmdbId, input.kind, c.get('club').id)
      .first<{ id: string }>();
  }
  if (!existing)
    throw new ApiError(503, 'REGISTER_FAILED', 'Não foi possível registrar este título.');
  await attach(c, input.listId, existing.id);
  return existing.id;
}
export const mediaRoutes = new Hono<AppEnv>();
mediaRoutes.get('/', async (c) => {
  const offset = Math.max(0, Math.min(parseInt(c.req.query('offset') || '0') || 0, 10000)),
    query = normalizeName(c.req.query('q') || '').slice(0, 100);
  const list = c.req.query('list'),
    mine = c.req.query('mine') === 'true',
    status = c.req.query('status'),
    kind = c.req.query('kind');
  const filters: string[] = ['m.club_id=?'],
    args: unknown[] = [c.get('club').id, c.get('member').id, c.get('club').id];
  if (list) {
    await requireList(c, list);
    filters.push('EXISTS (SELECT 1 FROM list_items li WHERE li.media_id=m.id AND li.list_id=?)');
    args.push(list);
  }
  if (kind === 'movie' || kind === 'tv' || kind === 'anime') {
    filters.push('m.kind=?');
    args.push(kind === 'anime' ? 'tv' : kind);
    if (kind !== 'movie') {
      filters.push('m.is_anime=?');
      args.push(kind === 'anime' ? 1 : 0);
    }
  }
  if (mine) filters.push('p.member_id IS NOT NULL');
  if (query) {
    filters.push('instr(m.normalized_title,?)>0');
    args.push(query);
  }
  if (status) {
    if (mine) {
      filters.push('p.status=?');
      args.push(status);
    } else {
      filters.push('m.group_status=?');
      args.push(status);
    }
  }
  const order: Record<string, string> = {
    title: 'm.title COLLATE NOCASE ASC,m.id',
    rating: 'r.average DESC,m.title,m.id',
    recent: 'm.created_at DESC,m.id',
    original: list
      ? '(SELECT position FROM list_items WHERE list_id=? AND media_id=m.id),m.id'
      : 'm.created_at,m.id',
  };
  const sort = order[c.req.query('sort') || 'original'] || order.original;
  if (sort.includes('list_id=?')) args.push(list);
  args.push(61, offset);
  const result = await c.env.DB.prepare(
    `${mediaSelect}${filters.length ? ' WHERE ' + filters.join(' AND ') : ''} ORDER BY ${sort} LIMIT ? OFFSET ?`,
  )
    .bind(...args)
    .all<Row>();
  return c.json({
    items: result.results.slice(0, 60).map(toMedia),
    nextOffset: result.results.length > 60 ? offset + 60 : null,
  });
});
mediaRoutes.get('/counts', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT CASE WHEN is_anime=1 THEN 'anime' ELSE kind END kind,COUNT(*) count FROM media WHERE club_id=? GROUP BY CASE WHEN is_anime=1 THEN 'anime' ELSE kind END",
  )
    .bind(c.get('club').id)
    .all<{ kind: 'movie' | 'tv' | 'anime'; count: number }>();
  const counts = { movie: 0, tv: 0, anime: 0 };
  for (const row of rows.results) counts[row.kind] = row.count;
  return c.json(counts);
});
/** Random candidates for the Roleta: titles nobody has finished and this member has not closed. */
/** Same-origin copy of a catalog poster, so the share card canvas is not tainted by CORS. */
mediaRoutes.get('/poster', async (c) => {
  const url = c.req.query('url') ?? '';
  if (!url.startsWith('https://image.tmdb.org/t/p/') || url.includes('..'))
    return c.json({ error: 'Pôster indisponível.' }, 400);
  try {
    const res = await fetch(url);
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/'))
      return c.json({ error: 'Pôster indisponível.' }, 404);
    return new Response(res.body, {
      headers: {
        'content-type': res.headers.get('content-type')!,
        'cache-control': 'private, max-age=86400',
      },
    });
  } catch {
    return c.json({ error: 'Pôster indisponível.' }, 502);
  }
});
mediaRoutes.get('/spin', async (c) => {
  const shelf = c.req.query('kind');
  const kind = shelf === 'tv' || shelf === 'anime' ? 'tv' : 'movie';
  const mine = c.req.query('mine') === 'true';
  const result = await c.env.DB.prepare(
    `${mediaSelect} WHERE m.club_id=? AND m.kind=? AND m.is_anime=? AND m.group_status<>'watched' AND (p.status IS NULL OR p.status IN ('want','watching'))${mine ? ' AND p.member_id IS NOT NULL' : ''} ORDER BY RANDOM() LIMIT 12`,
  )
    .bind(c.get('club').id, c.get('member').id, c.get('club').id, kind, shelf === 'anime' ? 1 : 0)
    .all<Row>();
  return c.json({ items: result.results.map(toMedia) });
});
mediaRoutes.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim().slice(0, 100);
  const page = Math.max(1, Math.min(500, parseInt(c.req.query('page') || '1') || 1));
  if (q.length < 2)
    return c.json({ results: [], page, totalPages: 0, available: Boolean(c.env.TMDB_TOKEN) });
  return c.json(await searchCatalog(c.env, c.get('club').id, q, page));
});
mediaRoutes.get('/person/:id', async (c) => {
  const personId = Number(c.req.param('id'));
  if (!Number.isInteger(personId) || personId < 1)
    throw new ApiError(400, 'VALIDATION', 'Pessoa inválida.');
  return c.json(await biography(c.env, personId));
});
mediaRoutes.post('/manual', async (c) => {
  const input = await body(c, manualMediaSchema);
  if (
    !(await c.env.DB.prepare('SELECT id FROM lists WHERE id=? AND club_id=?')
      .bind(input.listId, c.get('club').id)
      .first())
  )
    throw new ApiError(404, 'NOT_FOUND', 'A lista não foi encontrada.');
  const existing = await c.env.DB.prepare(
    'SELECT id FROM media WHERE normalized_title=? AND kind=? AND COALESCE(year,0)=? AND tmdb_id IS NULL AND club_id=?',
  )
    .bind(normalizeName(input.title), input.kind, input.year ?? 0, c.get('club').id)
    .first<{ id: string }>();
  const mediaId = existing?.id || id();
  if (!existing)
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO media (id,club_id,title,normalized_title,kind,year,synopsis,poster_url,created_by,is_anime) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        mediaId,
        c.get('club').id,
        input.title,
        normalizeName(input.title),
        input.kind,
        input.year ?? null,
        input.synopsis,
        input.posterUrl ?? null,
        c.get('member').id,
        input.kind === 'tv' && input.isAnime ? 1 : 0,
      )
      .run();
  const registered =
    existing ||
    (await c.env.DB.prepare(
      'SELECT id FROM media WHERE normalized_title=? AND kind=? AND COALESCE(year,0)=? AND tmdb_id IS NULL AND club_id=?',
    )
      .bind(normalizeName(input.title), input.kind, input.year ?? 0, c.get('club').id)
      .first<{ id: string }>());
  if (!registered)
    throw new ApiError(503, 'REGISTER_FAILED', 'Não foi possível guardar este título.');
  await attach(c, input.listId, registered.id);
  const { media } = await getMedia(c, registered.id);
  return c.json({ id: registered.id, isAnime: media.isAnime }, 201);
});
mediaRoutes.post('/catalog', async (c) => {
  const mediaId = await registerCatalog(c, await body(c, catalogSchema));
  const { media } = await getMedia(c, mediaId);
  return c.json({ id: mediaId, isAnime: media.isAnime }, 201);
});
mediaRoutes.get('/:id', async (c) => {
  const { row, media } = await getMedia(c, c.req.param('id'));
  let metadata: Row = {};
  try {
    metadata = JSON.parse(row.metadata || '{}');
  } catch {}
  let stale = false,
    providers: MediaDetails['availability'] = {
      subscription: [],
      rent: [],
      buy: [],
      link: null,
      updatedAt: null,
    };
  if (media.tmdbId && c.env.TMDB_TOKEN) {
    const results = await Promise.allSettled([
      catalogDetails(c.env, media.kind, media.tmdbId),
      availability(c.env, media.kind, media.tmdbId),
    ]);
    if (results[0].status === 'fulfilled') {
      metadata = results[0].value;
      stale = metadata.stale;
    } else stale = true;
    if (results[1].status === 'fulfilled') {
      providers = results[1].value;
      stale = stale || results[1].value.stale;
    } else stale = true;
  }
  const ratings = await c.env.DB.prepare(
    'SELECT p.member_id memberId,m.name,p.half_points/2.0 rating FROM member_media p JOIN members m ON m.id=p.member_id WHERE p.media_id=? AND m.club_id=? AND p.half_points IS NOT NULL AND m.active=1 ORDER BY m.name',
  )
    .bind(media.id, c.get('club').id)
    .all();
  const lists = await c.env.DB.prepare(
    'SELECT li.list_id FROM list_items li JOIN lists l ON l.id=li.list_id WHERE li.media_id=? AND l.club_id=?',
  )
    .bind(media.id, c.get('club').id)
    .all<{ list_id: string }>();
  return c.json({
    ...media,
    synopsis: metadata.synopsis || media.synopsis,
    posterUrl: metadata.posterUrl || media.posterUrl,
    tmdbRating: metadata.tmdbRating ?? media.tmdbRating,
    runtime: metadata.runtime || null,
    seasons: metadata.seasons || [],
    genres: metadata.genres || [],
    cast: metadata.cast || [],
    imdbId: metadata.imdbId || null,
    imdbRating: await imdbRating(c.env, metadata.imdbId || null),
    availability: providers,
    ratings: ratings.results,
    lists: lists.results.map((l) => l.list_id),
    stale,
  });
});
mediaRoutes.delete('/:id', async (c) => {
  owner(c);
  const input = await body(c, z.object({ revision: z.number().int().nonnegative() }));
  const { media } = await getMedia(c, c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM media WHERE id=? AND club_id=? AND revision=?')
    .bind(media.id, c.get('club').id, input.revision)
    .run();
  if (!result.meta.changes)
    throw new ApiError(
      409,
      'CONFLICT',
      'Este título mudou. Atualize e confirme a remoção novamente.',
    );
  return c.json({ ok: true });
});
mediaRoutes.put('/:id/personal', async (c) => {
  const input = await body(c, personalSchema);
  const { media } = await getMedia(c, c.req.param('id'));
  checkpoint(media.kind, input.season, input.episode);
  if (!media.personal && input.revision !== 0)
    throw new ApiError(409, 'CONFLICT', 'Seu progresso mudou. Atualize e tente novamente.');
  const result = await c.env.DB.prepare(
    'INSERT INTO member_media (member_id,media_id,status,half_points,season,episode,revision) VALUES (?,?,?,?,?,?,1) ON CONFLICT(member_id,media_id) DO UPDATE SET status=excluded.status,half_points=excluded.half_points,season=excluded.season,episode=excluded.episode,revision=member_media.revision+1 WHERE member_media.revision=?',
  )
    .bind(
      c.get('member').id,
      media.id,
      input.status,
      input.rating === null ? null : input.rating * 2,
      input.season,
      input.episode,
      input.revision,
    )
    .run();
  if (!result.meta.changes)
    throw new ApiError(409, 'CONFLICT', 'Seu progresso mudou. Atualize e tente novamente.');
  return c.json({ ok: true });
});
mediaRoutes.put('/:id/group', async (c) => {
  const input = await body(c, groupSchema);
  const { media } = await getMedia(c, c.req.param('id'));
  checkpoint(media.kind, input.season, input.episode);
  const result = await c.env.DB.prepare(
    'UPDATE media SET group_status=?,group_season=?,group_episode=?,revision=revision+1 WHERE id=? AND revision=? AND club_id=?',
  )
    .bind(input.status, input.season, input.episode, media.id, input.revision, c.get('club').id)
    .run();
  if (!result.meta.changes)
    throw new ApiError(
      409,
      'CONFLICT',
      'Alguém acabou de atualizar este título. Atualize e tente novamente.',
    );
  return c.json({ ok: true });
});
mediaRoutes.patch('/:id/manual', async (c) => {
  const input = await body(
    c,
    manualMediaSchema
      .omit({ listId: true, kind: true, isAnime: true })
      .extend({ revision: z.number().int().nonnegative() }),
  );
  const { media } = await getMedia(c, c.req.param('id'));
  if (media.tmdbId)
    throw new ApiError(400, 'CATALOG_MEDIA', 'Os dados deste título vêm do catálogo.');
  const result = await c.env.DB.prepare(
    'UPDATE media SET title=?,normalized_title=?,year=?,synopsis=?,poster_url=?,revision=revision+1 WHERE id=? AND revision=? AND club_id=?',
  )
    .bind(
      input.title,
      normalizeName(input.title),
      input.year ?? null,
      input.synopsis,
      input.posterUrl ?? null,
      media.id,
      input.revision,
      c.get('club').id,
    )
    .run()
    .catch((error: unknown) => {
      if (String(error).includes('UNIQUE')) {
        throw new ApiError(
          409,
          'DUPLICATE_MEDIA',
          'Já existe um título manual com este nome e ano.',
        );
      }
      throw error;
    });
  if (!result.meta.changes)
    throw new ApiError(409, 'CONFLICT', 'Este título mudou. Atualize e tente novamente.');
  return c.json({ ok: true });
});
mediaRoutes.post('/:id/link', async (c) => {
  const input = await body(
    c,
    catalogSchema.omit({ listId: true }).extend({ revision: z.number().int().nonnegative() }),
  );
  const { media } = await getMedia(c, c.req.param('id'));
  if (media.tmdbId || media.kind !== input.kind)
    throw new ApiError(400, 'WRONG_KIND', 'Selecione um resultado do mesmo tipo do título manual.');
  const match = await c.env.DB.prepare(
    'SELECT id FROM media WHERE tmdb_id=? AND kind=? AND club_id=?',
  )
    .bind(input.tmdbId, input.kind, c.get('club').id)
    .first();
  if (match)
    throw new ApiError(
      409,
      'CATALOG_DUPLICATE',
      'Este resultado já foi registrado. Escolha outro resultado ou mantenha o título manual.',
    );
  const d = await catalogDetails(c.env, input.kind, input.tmdbId);
  const result = await c.env.DB.prepare(
    'UPDATE media SET tmdb_id=?,title=?,normalized_title=?,year=?,synopsis=?,poster_url=?,tmdb_rating=?,metadata=?,is_anime=?,revision=revision+1 WHERE id=? AND revision=? AND club_id=? AND tmdb_id IS NULL',
  )
    .bind(
      input.tmdbId,
      d.title,
      normalizeName(d.title),
      d.year,
      d.synopsis,
      d.posterUrl,
      d.tmdbRating,
      JSON.stringify(d),
      media.kind === 'tv' && (media.isAnime || d.isAnime) ? 1 : 0,
      media.id,
      input.revision,
      c.get('club').id,
    )
    .run();
  if (!result.meta.changes)
    throw new ApiError(409, 'CONFLICT', 'Este título mudou. Atualize e tente novamente.');
  return c.json({ ok: true });
});
