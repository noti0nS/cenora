import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  identitySchema,
  recoverySchema,
  setupSchema,
  normalizeName,
  displayName,
} from '@watchlist/shared';
import type { Context } from 'hono';
import type { Member } from '@watchlist/shared';
import { ApiError, body, hash, token, id, rateLimit, type AppEnv } from './lib';

export async function issueSession(c: Context<AppEnv>, memberId: string) {
  const value = token();
  const club = await c.env.DB.prepare('SELECT token_version FROM club WHERE id=1').first<{
    token_version: number;
  }>();
  await c.env.DB.prepare(
    'INSERT INTO sessions (token_hash,member_id,club_version,expires_at) VALUES (?,?,?,?)',
  )
    .bind(
      await hash(value),
      memberId,
      club!.token_version,
      Math.floor(Date.now() / 1000) + 30 * 86400,
    )
    .run();
  setCookie(c, 'watchlist_session', value, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: 30 * 86400,
  });
}
export async function currentMember(c: Context<AppEnv>): Promise<Member | null> {
  const raw = getCookie(c, 'watchlist_session');
  if (!raw || raw.length > 128) return null;
  const digest = await hash(raw);
  const member = await c.env.DB.prepare(
    'SELECT m.id,m.name,m.role FROM sessions s JOIN members m ON m.id=s.member_id JOIN club c ON c.id=1 WHERE s.token_hash=? AND s.expires_at>? AND s.club_version=c.token_version AND m.active=1',
  )
    .bind(digest, Math.floor(Date.now() / 1000))
    .first<Member>();
  if (member) {
    c.set('member', member);
    c.set('sessionHash', digest);
  }
  return member;
}
async function clubToken(c: Context<AppEnv>, raw: string) {
  const club = await c.env.DB.prepare('SELECT token_hash FROM club WHERE id=1').first<{
    token_hash: string;
  }>();
  if (!club?.token_hash || club.token_hash !== (await hash(raw)))
    throw new ApiError(401, 'INVALID_TOKEN', 'O código do clube não é válido.');
}
export const auth = new Hono<AppEnv>();
auth.get('/session', async (c) => {
  const club = await c.env.DB.prepare('SELECT owner_id FROM club WHERE id=1').first<{
    owner_id: string | null;
  }>();
  return c.json({
    member: await currentMember(c),
    needsSetup: !club?.owner_id,
    catalogAvailable: Boolean(c.env.TMDB_TOKEN),
  });
});
auth.post('/setup', async (c) => {
  await rateLimit(c);
  const input = await body(c, setupSchema);
  const setupHash = await hash(input.setupCode);
  const memberId = id(),
    recoveryCode = token(),
    clubCode = token(),
    now = Math.floor(Date.now() / 1000);
  const statements = [
    c.env.DB.prepare(
      "INSERT INTO members (id,name,normalized_name,recovery_hash,role) SELECT ?,?,?,?,'owner' FROM club WHERE id=1 AND setup_hash=? AND owner_id IS NULL",
    ).bind(memberId, input.name, normalizeName(input.name), await hash(recoveryCode), setupHash),
    c.env.DB.prepare(
      'UPDATE club SET token_hash=?,owner_id=?,setup_hash=NULL WHERE id=1 AND setup_hash=? AND owner_id IS NULL',
    ).bind(await hash(clubCode), memberId, setupHash),
    ...[
      { name: 'Filmes', color: 'lavender', icon: 'film' },
      { name: 'Animes', color: 'coral', icon: 'sparkles' },
      { name: 'Séries', color: 'sage', icon: 'tv' },
    ].map((l) =>
      c.env.DB.prepare(
        'INSERT INTO lists (id,name,normalized_name,color,icon,created_by) SELECT ?,?,?,?,?,? FROM club WHERE owner_id=?',
      ).bind(id(), l.name, normalizeName(l.name), l.color, l.icon, memberId, memberId),
    ),
    c.env.DB.prepare('DELETE FROM auth_attempts WHERE expires_at<?').bind(now),
  ];
  const result = await c.env.DB.batch(statements);
  if (result[0].meta.changes !== 1)
    throw new ApiError(
      401,
      'INVALID_SETUP',
      'O código de configuração não é válido ou já foi utilizado.',
    );
  await issueSession(c, memberId);
  return c.json(
    {
      member: { id: memberId, name: input.name, role: 'owner' },
      recoveryCode,
      clubToken: clubCode,
    },
    201,
  );
});
auth.post('/join', async (c) => {
  await rateLimit(c);
  const input = await body(c, identitySchema);
  await clubToken(c, input.token);
  if (
    await c.env.DB.prepare('SELECT id FROM members WHERE normalized_name=?')
      .bind(normalizeName(input.name))
      .first()
  )
    throw new ApiError(
      409,
      'NAME_EXISTS',
      'Este nome já tem um perfil. Use seu código de recuperação ou escolha outro nome.',
    );
  const memberId = id(),
    recoveryCode = token();
  try {
    await c.env.DB.prepare(
      "INSERT INTO members (id,name,normalized_name,recovery_hash,role) VALUES (?,?,?,?,'member')",
    )
      .bind(memberId, input.name, normalizeName(input.name), await hash(recoveryCode))
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE'))
      throw new ApiError(409, 'NAME_EXISTS', 'Este nome já tem um perfil.');
    throw e;
  }
  await issueSession(c, memberId);
  return c.json({ member: { id: memberId, name: input.name, role: 'member' }, recoveryCode }, 201);
});
auth.post('/recover', async (c) => {
  await rateLimit(c);
  const input = await body(c, recoverySchema);
  await clubToken(c, input.token);
  const member = await c.env.DB.prepare(
    'SELECT id,name,role FROM members WHERE normalized_name=? AND recovery_hash=? AND active=1',
  )
    .bind(normalizeName(input.name), await hash(input.recoveryCode))
    .first<Member>();
  if (!member)
    throw new ApiError(401, 'INVALID_RECOVERY', 'Confira o nome e o código de recuperação.');
  await issueSession(c, member.id);
  return c.json({ member });
});
auth.post('/logout', async (c) => {
  const raw = getCookie(c, 'watchlist_session');
  if (raw)
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?')
      .bind(await hash(raw))
      .run();
  deleteCookie(c, 'watchlist_session', { path: '/' });
  return c.json({ ok: true });
});
auth.patch('/profile', async (c) => {
  if (!(await currentMember(c)))
    throw new ApiError(401, 'UNAUTHORIZED', 'Entre no clube para continuar.');
  const input = await body(c, identitySchema.pick({ name: true }));
  try {
    await c.env.DB.prepare('UPDATE members SET name=?,normalized_name=? WHERE id=?')
      .bind(input.name, normalizeName(input.name), c.get('member').id)
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE'))
      throw new ApiError(409, 'NAME_EXISTS', 'Este nome já está em uso.');
    throw e;
  }
  return c.json({ ...c.get('member'), name: input.name });
});
auth.post('/recovery-code', async (c) => {
  if (!(await currentMember(c)))
    throw new ApiError(401, 'UNAUTHORIZED', 'Entre no clube para continuar.');
  const code = token();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE members SET recovery_hash=? WHERE id=?').bind(
      await hash(code),
      c.get('member').id,
    ),
    c.env.DB.prepare('DELETE FROM sessions WHERE member_id=? AND token_hash<>?').bind(
      c.get('member').id,
      c.get('sessionHash'),
    ),
  ]);
  return c.json({ recoveryCode: code });
});
