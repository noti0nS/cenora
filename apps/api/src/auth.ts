import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  identitySchema,
  recoverySchema,
  createClubSchema,
  normalizeName,
  type Member,
  type Club,
} from '@cenora/shared';
import type { Context } from 'hono';
import { ApiError, body, hash, token, id, rateLimit, type AppEnv } from './lib';

type ClubRow = Club & { owner_id: string; token_version: number };

export async function issueSession(c: Context<AppEnv>, memberId: string) {
  const membership = await c.env.DB.prepare(
    'SELECT c.token_version FROM members m JOIN clubs c ON c.id=m.club_id WHERE m.id=? AND m.active=1',
  )
    .bind(memberId)
    .first<{ token_version: number }>();
  if (!membership) throw new ApiError(401, 'UNAUTHORIZED', 'Este perfil não está disponível.');
  const value = token();
  await c.env.DB.prepare(
    'INSERT INTO sessions (token_hash,member_id,club_version,expires_at) VALUES (?,?,?,?)',
  )
    .bind(
      await hash(value),
      memberId,
      membership.token_version,
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
  const row = await c.env.DB.prepare(
    'SELECT m.id,m.name,m.role,c.id club_id,c.name club_name,c.owner_id FROM sessions s JOIN members m ON m.id=s.member_id JOIN clubs c ON c.id=m.club_id WHERE s.token_hash=? AND s.expires_at>? AND s.club_version=c.token_version AND m.active=1',
  )
    .bind(digest, Math.floor(Date.now() / 1000))
    .first<Member & { club_id: string; club_name: string; owner_id: string }>();
  if (!row) return null;
  const member: Member = { id: row.id, name: row.name, role: row.role };
  c.set('member', member);
  c.set('club', { id: row.club_id, name: row.club_name });
  c.set('clubOwnerId', row.owner_id);
  c.set('sessionHash', digest);
  return member;
}

async function findClub(c: Context<AppEnv>, raw: string): Promise<ClubRow> {
  const club = await c.env.DB.prepare(
    'SELECT id,name,owner_id,token_version FROM clubs WHERE token_hash=?',
  )
    .bind(await hash(raw))
    .first<ClubRow>();
  if (!club) throw new ApiError(401, 'INVALID_TOKEN', 'O código do clube não é válido.');
  return club;
}

export const auth = new Hono<AppEnv>();

auth.get('/session', async (c) => {
  const member = await currentMember(c);
  return c.json({
    member,
    club: member ? c.get('club') : null,
    catalogAvailable: Boolean(c.env.TMDB_TOKEN),
  });
});

auth.post('/create', async (c) => {
  await rateLimit(c);
  const input = await body(c, createClubSchema);
  const club: Club = { id: id(), name: 'Clube de ' + input.name };
  const member: Member = { id: id(), name: input.name, role: 'owner' };
  const recoveryCode = token();
  const clubCode = token();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO clubs (id,name,token_hash,owner_id) VALUES (?,?,?,?)').bind(
      club.id,
      club.name,
      await hash(clubCode),
      member.id,
    ),
    c.env.DB.prepare(
      "INSERT INTO members (id,club_id,name,normalized_name,recovery_hash,role) VALUES (?,?,?,?,?,'owner')",
    ).bind(member.id, club.id, member.name, normalizeName(member.name), await hash(recoveryCode)),
    ...[
      { name: 'Filmes', color: 'lavender', icon: 'film' },
      { name: 'Animes', color: 'coral', icon: 'sparkles' },
      { name: 'Séries', color: 'sage', icon: 'tv' },
    ].map((list) =>
      c.env.DB.prepare(
        'INSERT INTO lists (id,club_id,name,normalized_name,color,icon,created_by) VALUES (?,?,?,?,?,?,?)',
      ).bind(id(), club.id, list.name, normalizeName(list.name), list.color, list.icon, member.id),
    ),
  ]);
  await issueSession(c, member.id);
  return c.json({ member, club, recoveryCode, clubToken: clubCode }, 201);
});

auth.post('/join', async (c) => {
  await rateLimit(c);
  const input = await body(c, identitySchema);
  const club = await findClub(c, input.token);
  if (
    await c.env.DB.prepare('SELECT id FROM members WHERE club_id=? AND normalized_name=?')
      .bind(club.id, normalizeName(input.name))
      .first()
  ) {
    throw new ApiError(
      409,
      'NAME_EXISTS',
      'Este nome já tem um perfil neste clube. Use seu código pessoal ou escolha outro nome.',
    );
  }
  const member: Member = { id: id(), name: input.name, role: 'member' };
  const recoveryCode = token();
  try {
    await c.env.DB.prepare(
      "INSERT INTO members (id,club_id,name,normalized_name,recovery_hash,role) VALUES (?,?,?,?,?,'member')",
    )
      .bind(member.id, club.id, member.name, normalizeName(member.name), await hash(recoveryCode))
      .run();
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      throw new ApiError(409, 'NAME_EXISTS', 'Este nome já tem um perfil neste clube.');
    throw error;
  }
  await issueSession(c, member.id);
  return c.json({ member, club: { id: club.id, name: club.name }, recoveryCode }, 201);
});

auth.post('/recover', async (c) => {
  await rateLimit(c);
  const input = await body(c, recoverySchema);
  const club = await findClub(c, input.token);
  const member = await c.env.DB.prepare(
    'SELECT id,name,role FROM members WHERE club_id=? AND normalized_name=? AND recovery_hash=? AND active=1',
  )
    .bind(club.id, normalizeName(input.name), await hash(input.recoveryCode))
    .first<Member>();
  if (!member)
    throw new ApiError(401, 'INVALID_RECOVERY', 'Confira o nome e o código pessoal deste clube.');
  await issueSession(c, member.id);
  return c.json({ member, club: { id: club.id, name: club.name } });
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
    await c.env.DB.prepare('UPDATE members SET name=?,normalized_name=? WHERE id=? AND club_id=?')
      .bind(input.name, normalizeName(input.name), c.get('member').id, c.get('club').id)
      .run();
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      throw new ApiError(409, 'NAME_EXISTS', 'Este nome já está em uso neste clube.');
    throw error;
  }
  return c.json({ ...c.get('member'), name: input.name });
});

auth.post('/recovery-code', async (c) => {
  if (!(await currentMember(c)))
    throw new ApiError(401, 'UNAUTHORIZED', 'Entre no clube para continuar.');
  const code = token();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE members SET recovery_hash=? WHERE id=? AND club_id=?').bind(
      await hash(code),
      c.get('member').id,
      c.get('club').id,
    ),
    c.env.DB.prepare('DELETE FROM sessions WHERE member_id=? AND token_hash<>?').bind(
      c.get('member').id,
      c.get('sessionHash'),
    ),
  ]);
  return c.json({ recoveryCode: code });
});
