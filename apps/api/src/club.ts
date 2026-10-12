import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { listSchema, normalizeName, importSchema } from '@cenora/shared';
import { ApiError, body, owner, id, token, hash, type AppEnv } from './lib';
import { lists as listTable } from './schema';
import { attach, registerCatalog, requireList } from './media';

export const clubRoutes = new Hono<AppEnv>();

clubRoutes.get('/lists', async (c) => {
  const clubId = c.get('club').id;
  const rows = await drizzle(c.env.DB)
    .select({
      id: listTable.id,
      name: listTable.name,
      color: listTable.color,
      icon: listTable.icon,
      revision: listTable.revision,
    })
    .from(listTable)
    .where(eq(listTable.clubId, clubId))
    .orderBy(sql`rowid`)
    .all();
  const counts = await c.env.DB.prepare(
    'SELECT li.list_id,COUNT(*) count FROM list_items li JOIN lists l ON l.id=li.list_id WHERE l.club_id=? GROUP BY li.list_id',
  )
    .bind(clubId)
    .all<{ list_id: string; count: number }>();
  return c.json(
    rows.map((list) => ({
      ...list,
      count: counts.results.find((row) => row.list_id === list.id)?.count || 0,
    })),
  );
});

clubRoutes.post('/lists', async (c) => {
  const input = await body(c, listSchema);
  const listId = id();
  try {
    await c.env.DB.prepare(
      'INSERT INTO lists (id,club_id,name,normalized_name,color,icon,created_by) VALUES (?,?,?,?,?,?,?)',
    )
      .bind(
        listId,
        c.get('club').id,
        input.name,
        normalizeName(input.name),
        input.color,
        input.icon,
        c.get('member').id,
      )
      .run();
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      throw new ApiError(409, 'DUPLICATE_LIST', 'Já existe uma lista com esse nome neste clube.');
    throw error;
  }
  return c.json({ id: listId }, 201);
});

clubRoutes.patch('/lists/:id', async (c) => {
  await requireList(c, c.req.param('id'));
  const input = await body(c, listSchema.extend({ revision: z.number().int().nonnegative() }));
  try {
    const result = await c.env.DB.prepare(
      'UPDATE lists SET name=?,normalized_name=?,color=?,icon=?,revision=revision+1 WHERE id=? AND revision=? AND club_id=?',
    )
      .bind(
        input.name,
        normalizeName(input.name),
        input.color,
        input.icon,
        c.req.param('id'),
        input.revision,
        c.get('club').id,
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError(409, 'CONFLICT', 'A lista mudou. Atualize e tente novamente.');
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      throw new ApiError(409, 'DUPLICATE_LIST', 'Já existe uma lista com esse nome neste clube.');
    throw error;
  }
  return c.json({ ok: true });
});

clubRoutes.delete('/lists/:id', async (c) => {
  owner(c);
  await requireList(c, c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM lists WHERE id=? AND club_id=?')
    .bind(c.req.param('id'), c.get('club').id)
    .run();
  return c.json({ ok: true });
});

clubRoutes.post('/lists/:id/items', async (c) => {
  const input = await body(c, z.object({ mediaId: z.string().uuid() }));
  await attach(c, c.req.param('id'), input.mediaId);
  return c.json({ ok: true });
});

clubRoutes.delete('/lists/:id/items/:mediaId', async (c) => {
  await requireList(c, c.req.param('id'));
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
        'SELECT id,name,role,active,(user_id IS NOT NULL) linked FROM members WHERE club_id=? ORDER BY role DESC,name',
      )
        .bind(c.get('club').id)
        .all()
    ).results,
  );
});

clubRoutes.post('/token', async (c) => {
  owner(c);
  const code = token();
  const clubId = c.get('club').id;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE clubs SET token_hash=?,token_version=token_version+1 WHERE id=?').bind(
      await hash(code),
      clubId,
    ),
    c.env.DB.prepare(
      'DELETE FROM sessions WHERE member_id IN (SELECT id FROM members WHERE club_id=?) AND token_hash<>?',
    ).bind(clubId, c.get('sessionHash')),
    c.env.DB.prepare(
      'UPDATE sessions SET club_version=(SELECT token_version FROM clubs WHERE id=?) WHERE token_hash=?',
    ).bind(clubId, c.get('sessionHash')),
  ]);
  return c.json({ clubToken: code });
});

clubRoutes.post('/members/:id/recovery', async (c) => {
  owner(c);
  const member = await c.env.DB.prepare(
    'SELECT id,user_id FROM members WHERE id=? AND club_id=? AND active=1',
  )
    .bind(c.req.param('id'), c.get('club').id)
    .first<{ id: string; user_id: string | null }>();
  if (!member) throw new ApiError(404, 'NOT_FOUND', 'Perfil não encontrado.');
  if (member.user_id)
    throw new ApiError(
      409,
      'LINKED',
      'Esta pessoa entra com o próprio acesso. Peça para ela usar o e-mail ou o código de recuperação dela.',
    );
  const code = token();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE members SET recovery_hash=? WHERE id=? AND club_id=?').bind(
      await hash(code),
      c.req.param('id'),
      c.get('club').id,
    ),
    c.env.DB.prepare('DELETE FROM sessions WHERE member_id=? AND token_hash<>?').bind(
      c.req.param('id'),
      c.get('sessionHash'),
    ),
  ]);
  return c.json({ recoveryCode: code });
});

clubRoutes.post('/members/:id/claim', async (c) => {
  owner(c);
  const member = await c.env.DB.prepare(
    'SELECT id FROM members WHERE id=? AND club_id=? AND active=1',
  )
    .bind(c.req.param('id'), c.get('club').id)
    .first();
  if (!member) throw new ApiError(404, 'NOT_FOUND', 'Perfil não encontrado.');
  const code = token();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM member_claims WHERE member_id=?').bind(c.req.param('id')),
    c.env.DB.prepare(
      'INSERT INTO member_claims (id,member_id,code_hash,created_by,expires_at,used_at) VALUES (?,?,?,?,?,NULL)',
    ).bind(id(), c.req.param('id'), await hash(code), c.get('member').id, now + 7 * 86400),
  ]);
  return c.json({ claimCode: code });
});

clubRoutes.delete('/members/:id', async (c) => {
  owner(c);
  const target = await c.env.DB.prepare('SELECT id,role FROM members WHERE id=? AND club_id=?')
    .bind(c.req.param('id'), c.get('club').id)
    .first<{ id: string; role: string }>();
  if (!target) throw new ApiError(404, 'NOT_FOUND', 'Perfil não encontrado.');
  if (target.role === 'owner')
    throw new ApiError(400, 'OWNER', 'O responsável não pode ser removido.');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE members SET active=0 WHERE id=? AND club_id=? AND role<>'owner'").bind(
      target.id,
      c.get('club').id,
    ),
    c.env.DB.prepare('DELETE FROM sessions WHERE member_id=?').bind(target.id),
  ]);
  return c.json({ ok: true });
});

clubRoutes.post('/import', async (c) => {
  owner(c);
  const input = await body(c, importSchema);
  if (input.entries.length > 3)
    throw new ApiError(400, 'BATCH_LIMIT', 'Importe até 3 títulos por chamada.');
  const clubId = c.get('club').id;
  const ids: string[] = [];
  for (const entry of input.entries) {
    let list = await c.env.DB.prepare('SELECT id FROM lists WHERE normalized_name=? AND club_id=?')
      .bind(normalizeName(entry.category), clubId)
      .first<{ id: string }>();
    if (!list) {
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO lists (id,club_id,name,normalized_name,color,icon,created_by) VALUES (?,?,?,?,'lavender','film',?)",
      )
        .bind(id(), clubId, entry.category, normalizeName(entry.category), c.get('member').id)
        .run();
      list = await c.env.DB.prepare('SELECT id FROM lists WHERE normalized_name=? AND club_id=?')
        .bind(normalizeName(entry.category), clubId)
        .first<{ id: string }>();
    }
    if (!list) throw new ApiError(503, 'REGISTER_FAILED', 'Não foi possível preparar a lista.');
    const original = normalizeName(entry.originalTitle || entry.title);
    const variant = normalizeName(entry.title);
    const sourceKey = JSON.stringify([normalizeName(entry.category), original]);
    const aliases = await c.env.DB.prepare(
      'SELECT media_id FROM import_aliases WHERE club_id=? AND source_key=? AND (variant_key=? OR ?=1)',
    )
      .bind(clubId, sourceKey, variant, original === variant ? 1 : 0)
      .all<{ media_id: string }>();
    if (aliases.results.length) {
      for (const alias of aliases.results) {
        await attach(c, list.id, alias.media_id);
        ids.push(alias.media_id);
      }
      continue;
    }
    let mediaId: string;
    if (entry.tmdbId) {
      mediaId = await registerCatalog(c, {
        tmdbId: entry.tmdbId,
        kind: entry.kind,
        listId: list.id,
      });
    } else {
      let media = await c.env.DB.prepare(
        'SELECT id FROM media WHERE club_id=? AND normalized_title=? AND kind=? ORDER BY tmdb_id DESC LIMIT 1',
      )
        .bind(clubId, variant, entry.kind)
        .first<{ id: string }>();
      if (!media) {
        await c.env.DB.prepare(
          'INSERT OR IGNORE INTO media (id,club_id,title,normalized_title,kind,created_by) VALUES (?,?,?,?,?,?)',
        )
          .bind(id(), clubId, entry.title, variant, entry.kind, c.get('member').id)
          .run();
        media = await c.env.DB.prepare(
          'SELECT id FROM media WHERE club_id=? AND normalized_title=? AND kind=? AND year IS NULL AND tmdb_id IS NULL',
        )
          .bind(clubId, variant, entry.kind)
          .first<{ id: string }>();
      }
      if (!media)
        throw new ApiError(503, 'REGISTER_FAILED', 'Não foi possível importar este título.');
      mediaId = media.id;
      await attach(c, list.id, mediaId);
    }
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO import_aliases (club_id,source_key,variant_key,media_id) VALUES (?,?,?,?)',
    )
      .bind(clubId, sourceKey, variant, mediaId)
      .run();
    ids.push(mediaId);
  }
  return c.json({ imported: ids.length, ids });
});

clubRoutes.get('/export', async (c) => {
  owner(c);
  const clubId = c.get('club').id;
  const result = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,name,role,active FROM members WHERE club_id=?').bind(clubId),
    c.env.DB.prepare('SELECT id,name,color,icon,revision FROM lists WHERE club_id=?').bind(clubId),
    c.env.DB.prepare('SELECT * FROM media WHERE club_id=?').bind(clubId),
    c.env.DB.prepare(
      'SELECT li.* FROM list_items li JOIN lists l ON l.id=li.list_id WHERE l.club_id=?',
    ).bind(clubId),
    c.env.DB.prepare(
      'SELECT mm.* FROM member_media mm JOIN media m ON m.id=mm.media_id WHERE m.club_id=?',
    ).bind(clubId),
    c.env.DB.prepare('SELECT * FROM import_aliases WHERE club_id=?').bind(clubId),
  ]);
  c.header('Content-Disposition', 'attachment; filename="cenora.json"');
  return c.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    club: c.get('club'),
    members: result[0].results,
    lists: result[1].results,
    media: result[2].results,
    items: result[3].results,
    tracking: result[4].results,
    importAliases: result[5].results,
  });
});
