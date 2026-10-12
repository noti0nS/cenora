import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';
import { listSchema, normalizeName, importSchema, displayName } from '@watchlist/shared';
import { ApiError, body, owner, id, token, hash, type AppEnv } from './lib';
import { lists as listTable } from './schema';
import { screenshotEntries } from '@watchlist/shared/import';
import { attach, registerCatalog } from './media';

export const clubRoutes = new Hono<AppEnv>();
clubRoutes.get('/import-preset', (c) => {
  owner(c);
  return c.json(screenshotEntries);
});
clubRoutes.get('/lists', async (c) => {
  const rows = await drizzle(c.env.DB)
    .select({
      id: listTable.id,
      name: listTable.name,
      color: listTable.color,
      icon: listTable.icon,
      revision: listTable.revision,
    })
    .from(listTable)
    .all();
  const counts = await c.env.DB.prepare(
    'SELECT list_id,COUNT(*) count FROM list_items GROUP BY list_id',
  ).all<{ list_id: string; count: number }>();
  return c.json(
    rows.map((l) => ({ ...l, count: counts.results.find((r) => r.list_id === l.id)?.count || 0 })),
  );
});
clubRoutes.post('/lists', async (c) => {
  const input = await body(c, listSchema);
  const listId = id();
  try {
    await c.env.DB.prepare(
      'INSERT INTO lists (id,name,normalized_name,color,icon,created_by) VALUES (?,?,?,?,?,?)',
    )
      .bind(
        listId,
        input.name,
        normalizeName(input.name),
        input.color,
        input.icon,
        c.get('member').id,
      )
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE'))
      throw new ApiError(409, 'DUPLICATE_LIST', 'Já existe uma lista com esse nome.');
    throw e;
  }
  return c.json({ id: listId }, 201);
});
clubRoutes.patch('/lists/:id', async (c) => {
  const input = await body(c, listSchema.extend({ revision: z.number().int().nonnegative() }));
  try {
    const result = await c.env.DB.prepare(
      'UPDATE lists SET name=?,normalized_name=?,color=?,icon=?,revision=revision+1 WHERE id=? AND revision=?',
    )
      .bind(
        input.name,
        normalizeName(input.name),
        input.color,
        input.icon,
        c.req.param('id'),
        input.revision,
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError(409, 'CONFLICT', 'A lista mudou. Atualize e tente novamente.');
  } catch (e) {
    if (String(e).includes('UNIQUE'))
      throw new ApiError(409, 'DUPLICATE_LIST', 'Já existe uma lista com esse nome.');
    throw e;
  }
  return c.json({ ok: true });
});
clubRoutes.delete('/lists/:id', async (c) => {
  owner(c);
  await c.env.DB.prepare('DELETE FROM lists WHERE id=?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
clubRoutes.post('/lists/:id/items', async (c) => {
  const input = await body(c, z.object({ mediaId: z.string().uuid() }));
  if (!(await c.env.DB.prepare('SELECT id FROM media WHERE id=?').bind(input.mediaId).first()))
    throw new ApiError(404, 'NOT_FOUND', 'Título não encontrado.');
  await attach(c.env.DB, c.req.param('id'), input.mediaId, c.get('member').id);
  return c.json({ ok: true });
});
clubRoutes.delete('/lists/:id/items/:mediaId', async (c) => {
  await c.env.DB.prepare('DELETE FROM list_items WHERE list_id=? AND media_id=?')
    .bind(c.req.param('id'), c.req.param('mediaId'))
    .run();
  return c.json({ ok: true });
});
clubRoutes.get('/members', async (c) => {
  owner(c);
  return c.json(
    (
      await c.env.DB.prepare(
        'SELECT id,name,role,active FROM members ORDER BY role DESC,name',
      ).all()
    ).results,
  );
});
clubRoutes.post('/token', async (c) => {
  owner(c);
  const code = token();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE club SET token_hash=?,token_version=token_version+1 WHERE id=1').bind(
      await hash(code),
    ),
    c.env.DB.prepare('DELETE FROM sessions WHERE token_hash<>?').bind(c.get('sessionHash')),
    c.env.DB.prepare(
      'UPDATE sessions SET club_version=(SELECT token_version FROM club WHERE id=1) WHERE token_hash=?',
    ).bind(c.get('sessionHash')),
  ]);
  return c.json({ clubToken: code });
});
clubRoutes.post('/members/:id/recovery', async (c) => {
  owner(c);
  const member = await c.env.DB.prepare('SELECT id FROM members WHERE id=? AND active=1')
    .bind(c.req.param('id'))
    .first();
  if (!member) throw new ApiError(404, 'NOT_FOUND', 'Perfil não encontrado.');
  const code = token();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE members SET recovery_hash=? WHERE id=?').bind(
      await hash(code),
      c.req.param('id'),
    ),
    c.env.DB.prepare('DELETE FROM sessions WHERE member_id=? AND token_hash<>?').bind(
      c.req.param('id'),
      c.get('sessionHash'),
    ),
  ]);
  return c.json({ recoveryCode: code });
});
clubRoutes.delete('/members/:id', async (c) => {
  owner(c);
  if (c.req.param('id') === c.get('member').id)
    throw new ApiError(400, 'OWNER', 'O responsável não pode ser removido.');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE members SET active=0 WHERE id=? AND role<>'owner'").bind(
      c.req.param('id'),
    ),
    c.env.DB.prepare('DELETE FROM sessions WHERE member_id=?').bind(c.req.param('id')),
  ]);
  return c.json({ ok: true });
});
clubRoutes.post('/import', async (c) => {
  owner(c);
  const input = await body(c, importSchema);
  if (input.entries.length > 3)
    throw new ApiError(400, 'BATCH_LIMIT', 'Importe até 3 títulos por chamada.');
  const ids: string[] = [];
  for (const entry of input.entries) {
    let list = await c.env.DB.prepare('SELECT id FROM lists WHERE normalized_name=?')
      .bind(normalizeName(entry.category))
      .first<{ id: string }>();
    if (!list) {
      const listId = id();
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO lists (id,name,normalized_name,color,icon,created_by) VALUES (?,?,?,'lavender','film',?)",
      )
        .bind(listId, entry.category, normalizeName(entry.category), c.get('member').id)
        .run();
      list = await c.env.DB.prepare('SELECT id FROM lists WHERE normalized_name=?')
        .bind(normalizeName(entry.category))
        .first<{ id: string }>();
    }
    // Source identity survives catalog renaming, edits, and reviewed compound-title splits.
    const original = normalizeName(entry.originalTitle || entry.title);
    const variant = normalizeName(entry.title);
    const sourceKey = JSON.stringify([normalizeName(entry.category), original]);
    const aliases = await c.env.DB.prepare(
      'SELECT media_id FROM import_aliases WHERE source_key=? AND (variant_key=? OR ?=1)',
    )
      .bind(sourceKey, variant, original === variant ? 1 : 0)
      .all<{ media_id: string }>();
    if (aliases.results.length) {
      for (const alias of aliases.results) {
        await attach(c.env.DB, list!.id, alias.media_id, c.get('member').id);
        ids.push(alias.media_id);
      }
      continue;
    }
    let mediaId: string;
    if (entry.tmdbId) {
      mediaId = await registerCatalog(c, {
        tmdbId: entry.tmdbId,
        kind: entry.kind,
        listId: list!.id,
      });
    } else {
      let media = await c.env.DB.prepare(
        'SELECT id FROM media WHERE normalized_title=? AND kind=? ORDER BY tmdb_id DESC LIMIT 1',
      )
        .bind(variant, entry.kind)
        .first<{ id: string }>();
      if (!media) {
        media = { id: id() };
        await c.env.DB.prepare(
          'INSERT OR IGNORE INTO media (id,title,normalized_title,kind,created_by) VALUES (?,?,?,?,?)',
        )
          .bind(media.id, entry.title, variant, entry.kind, c.get('member').id)
          .run();
        media = await c.env.DB.prepare(
          'SELECT id FROM media WHERE normalized_title=? AND kind=? AND year IS NULL AND tmdb_id IS NULL',
        )
          .bind(variant, entry.kind)
          .first<{ id: string }>();
      }
      if (!media)
        throw new ApiError(503, 'REGISTER_FAILED', 'Não foi possível importar este título.');
      mediaId = media.id;
      await attach(c.env.DB, list!.id, mediaId, c.get('member').id);
    }
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO import_aliases (source_key,variant_key,media_id) VALUES (?,?,?)',
    )
      .bind(sourceKey, variant, mediaId)
      .run();
    ids.push(mediaId);
  }
  return c.json({ imported: ids.length, ids });
});
clubRoutes.get('/export', async (c) => {
  owner(c);
  const result = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,name,role,active FROM members'),
    c.env.DB.prepare('SELECT id,name,color,icon,revision FROM lists'),
    c.env.DB.prepare('SELECT * FROM media'),
    c.env.DB.prepare('SELECT * FROM list_items'),
    c.env.DB.prepare('SELECT * FROM member_media'),
    c.env.DB.prepare('SELECT * FROM import_aliases'),
  ]);
  c.header('Content-Disposition', 'attachment; filename="watchlist.json"');
  return c.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    members: result[0].results,
    lists: result[1].results,
    media: result[2].results,
    items: result[3].results,
    tracking: result[4].results,
    importAliases: result[5].results,
  });
});
