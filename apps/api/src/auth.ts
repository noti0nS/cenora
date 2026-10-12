import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  identitySchema,
  recoverySchema,
  createClubSchema,
  emailStartSchema,
  emailVerifySchema,
  claimSchema,
  linkSchema,
  inviteJoinSchema,
  normalizeName,
  type Member,
  type Club,
  type ClubOption,
  type SessionUser,
} from '@cenora/shared';
import type { Context } from 'hono';
import {
  ApiError,
  body,
  hash,
  hmac,
  token,
  id,
  hit,
  constantTimeEqual,
  rateLimit,
  pepperFor,
  invitePasswordDigest,
  type AppEnv,
} from './lib';
import { mailerFor, accessCodeMail } from './mailer';

type ClubRow = Club & { owner_id: string; token_version: number };
type MembershipRow = {
  member_id: string;
  member_name: string;
  role: 'owner' | 'member';
  club_id: string;
  club_name: string;
  token_version: number;
  member_count?: number;
};
type SessionRow = {
  user_id: string | null;
  member_id: string | null;
  club_version: number | null;
  scope_member_id: string | null;
  created_at: number;
  expires_at: number;
  email: string | null;
  member_name: string | null;
  role: 'owner' | 'member' | null;
  active: number | null;
  member_user_id: string | null;
  member_user_email: string | null;
  club_id: string | null;
  club_name: string | null;
  owner_id: string | null;
  token_version: number | null;
};
export interface ResolvedSession {
  user: SessionUser | null;
  member: Member | null;
  club: Club | null;
  clubs: ClubOption[];
  scopedMemberId: string | null;
}

const SESSION_LIFETIME = 30 * 86400;
const SESSION_RENEW_AFTER = 15 * 86400;
const ACCOUNT_MAX_AGE = 365 * 86400;
const CODE_TTL = 600;

function sessionCookie(c: Context<AppEnv>, maxAge: number) {
  return {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax' as const,
    path: '/',
    maxAge,
  };
}

async function memberships(c: Context<AppEnv>, userId: string) {
  const rows = await c.env.DB.prepare(
    'SELECT m.id member_id,m.name member_name,m.role,c.id club_id,c.name club_name,c.token_version,(SELECT COUNT(*) FROM members x WHERE x.club_id=c.id AND x.active=1) member_count FROM members m JOIN clubs c ON c.id=m.club_id WHERE m.user_id=? AND m.active=1 ORDER BY m.created_at,m.name',
  )
    .bind(userId)
    .all<MembershipRow>();
  return rows.results;
}
const toClubOption = (row: MembershipRow): ClubOption => ({
  memberId: row.member_id,
  clubId: row.club_id,
  name: row.club_name,
  role: row.role,
  memberCount: row.member_count ?? 1,
});
const toMember = (row: MembershipRow): Member => ({
  id: row.member_id,
  name: row.member_name,
  role: row.role,
});
const toClub = (row: MembershipRow): Club => ({ id: row.club_id, name: row.club_name });

async function activate(
  c: Context<AppEnv>,
  tokenHash: string,
  userId: string,
  membership: MembershipRow,
) {
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE sessions SET member_id=?,club_version=? WHERE token_hash=?').bind(
      membership.member_id,
      membership.token_version,
      tokenHash,
    ),
    c.env.DB.prepare('UPDATE users SET last_member_id=? WHERE id=?').bind(
      membership.member_id,
      userId,
    ),
  ]);
}

function requireUnscoped(session: ResolvedSession | null) {
  if (session?.scopedMemberId)
    throw new ApiError(
      403,
      'SCOPED',
      'Este acesso está limitado a um clube. Entre com o e-mail já vinculado ou com seu código de recuperação da identidade para liberar os outros.',
    );
}

async function mergeIdentities(c: Context<AppEnv>, sourceId: string, targetId: string) {
  const conflicts = await c.env.DB.prepare(
    'SELECT c.name FROM members s JOIN clubs c ON c.id=s.club_id WHERE s.user_id=? AND s.active=1 AND s.club_id IN (SELECT club_id FROM members WHERE user_id=? AND active=1)',
  )
    .bind(sourceId, targetId)
    .all<{ name: string }>();
  if (conflicts.results.length)
    throw new ApiError(
      409,
      'MERGE_CONFLICT',
      `Você já tem perfil nestes clubes com as duas identidades: ${conflicts.results
        .map((row) => row.name)
        .join(', ')}. Peça para o dono remover um dos perfis e tente de novo.`,
    );
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE members SET user_id=? WHERE user_id=?').bind(targetId, sourceId),
    c.env.DB.prepare('UPDATE sessions SET user_id=? WHERE user_id=?').bind(targetId, sourceId),
    c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(sourceId),
  ]);
}

export async function resolveSession(
  c: Context<AppEnv>,
  withClubs = false,
): Promise<ResolvedSession | null> {
  const raw = getCookie(c, 'watchlist_session');
  if (!raw || raw.length > 128) return null;
  const digest = await hash(raw);
  const now = Math.floor(Date.now() / 1000);
  const row = await c.env.DB.prepare(
    'SELECT s.user_id,s.member_id,s.club_version,s.scope_member_id,s.created_at,s.expires_at,u.email,m.name member_name,m.role,m.active,m.user_id member_user_id,mu.email member_user_email,c2.id club_id,c2.name club_name,c2.owner_id,c2.token_version FROM sessions s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN members m ON m.id=s.member_id LEFT JOIN users mu ON mu.id=m.user_id LEFT JOIN clubs c2 ON c2.id=m.club_id WHERE s.token_hash=? AND s.expires_at>?',
  )
    .bind(digest, now)
    .first<SessionRow>();
  if (!row) return null;

  // Uma credencial antiga prova acesso ao perfil, não à identidade inteira.
  if (!row.user_id && row.member_user_id) {
    await c.env.DB.prepare('UPDATE sessions SET user_id=?,scope_member_id=? WHERE token_hash=?')
      .bind(row.member_user_id, row.member_id, digest)
      .run();
    row.user_id = row.member_user_id;
    row.email = row.member_user_email;
    row.scope_member_id = row.member_id;
  }
  const user: SessionUser | null = row.user_id ? { id: row.user_id, email: row.email } : null;
  let member: Member | null = null;
  let club: Club | null = null;
  if (row.member_id) {
    const ready =
      row.active === 1 &&
      row.club_version === row.token_version &&
      (!row.scope_member_id || row.scope_member_id === row.member_id);
    if (ready) {
      member = { id: row.member_id, name: row.member_name!, role: row.role! };
      club = { id: row.club_id!, name: row.club_name! };
    } else if (!user) {
      return null;
    } else {
      // A identidade continua; o clube ativo é que não vale mais.
      await c.env.DB.prepare(
        'UPDATE sessions SET member_id=NULL,club_version=NULL WHERE token_hash=?',
      )
        .bind(digest)
        .run();
    }
  }
  if (row.expires_at - now < SESSION_RENEW_AFTER) {
    const capped = Boolean(user?.email) && row.created_at + ACCOUNT_MAX_AGE <= now;
    if (!capped) {
      await c.env.DB.prepare('UPDATE sessions SET expires_at=?,renewed_at=? WHERE token_hash=?')
        .bind(now + SESSION_LIFETIME, now, digest)
        .run();
      setCookie(c, 'watchlist_session', raw, sessionCookie(c, SESSION_LIFETIME));
    }
  }
  c.set('sessionHash', digest);
  if (member && club) {
    c.set('member', member);
    c.set('club', club);
    c.set('clubOwnerId', row.owner_id!);
  }
  let clubs: ClubOption[] = [];
  if (withClubs && user) {
    clubs = (await memberships(c, user.id)).map(toClubOption);
    if (row.scope_member_id)
      clubs = clubs.filter((option) => option.memberId === row.scope_member_id);
  }
  return { user, member, club, clubs, scopedMemberId: row.scope_member_id };
}

export async function currentMember(c: Context<AppEnv>): Promise<Member | null> {
  const session = await resolveSession(c);
  return session?.member ?? null;
}

export async function issueSession(
  c: Context<AppEnv>,
  memberId: string | null,
  userId: string | null,
  scopeMemberId: string | null = null,
) {
  let clubVersion: number | null = null;
  if (memberId) {
    const membership = await c.env.DB.prepare(
      'SELECT c.token_version FROM members m JOIN clubs c ON c.id=m.club_id WHERE m.id=? AND m.active=1',
    )
      .bind(memberId)
      .first<{ token_version: number }>();
    if (!membership) throw new ApiError(401, 'UNAUTHORIZED', 'Este perfil não está disponível.');
    clubVersion = membership.token_version;
  }
  const value = token();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'INSERT INTO sessions (token_hash,user_id,member_id,club_version,scope_member_id,created_at,expires_at,renewed_at,user_agent) VALUES (?,?,?,?,?,?,?,NULL,?)',
  )
    .bind(
      await hash(value),
      userId,
      memberId,
      clubVersion,
      scopeMemberId,
      now,
      now + SESSION_LIFETIME,
      c.req.header('User-Agent')?.slice(0, 200) || null,
    )
    .run();
  setCookie(c, 'watchlist_session', value, sessionCookie(c, SESSION_LIFETIME));
  return value;
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

async function sixDigitCode() {
  const size = 1_000_000;
  const limit = Math.floor(0x100000000 / size) * size;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return String(value % size).padStart(6, '0');
}

async function validateTurnstile(c: Context<AppEnv>, tokenValue?: string) {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) return;
  if (!tokenValue)
    throw new ApiError(400, 'TURNSTILE', 'Confirme que você é humano para continuar.');
  const payload = new URLSearchParams({ secret, response: tokenValue });
  const ip = c.req.header('CF-Connecting-IP');
  if (ip) payload.set('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: payload,
  });
  const outcome = (await response.json().catch(() => null)) as { success?: boolean } | null;
  if (!outcome?.success)
    throw new ApiError(403, 'TURNSTILE', 'Não foi possível confirmar seu acesso. Tente novamente.');
}

export const auth = new Hono<AppEnv>();

auth.get('/session', async (c) => {
  const session = await resolveSession(c, true);
  return c.json({
    user: session?.user ?? null,
    member: session?.member ?? null,
    club: session?.club ?? null,
    clubs: session?.clubs ?? [],
    scoped: Boolean(session?.scopedMemberId),
    catalogAvailable: Boolean(c.env.TMDB_TOKEN),
  });
});

auth.post('/email/start', async (c) => {
  await rateLimit(c);
  const input = await body(c, emailStartSchema);
  if (input.mode === 'attach') {
    const session = await resolveSession(c);
    if (!session?.user)
      throw new ApiError(401, 'UNAUTHORIZED', 'Entre na sua conta para vincular o e-mail.');
    requireUnscoped(session);
    if (session.user.email)
      throw new ApiError(409, 'ALREADY_LINKED', 'Sua conta já tem um e-mail vinculado.');
  }
  await validateTurnstile(c, input.turnstileToken);
  const mailer = mailerFor(c);
  const pepper = pepperFor(c);
  await hit(c, `otp:${input.email}`, 900, 3);
  await hit(
    c,
    `otp-cooldown:${input.email}`,
    60,
    1,
    'Aguarde um instante antes de pedir outro código.',
  );
  await hit(c, 'otp-day', 86400, 200);
  const code = await sixDigitCode();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM login_codes WHERE normalized_email=?').bind(input.email),
    c.env.DB.prepare(
      'INSERT INTO login_codes (id,normalized_email,code_hash,attempts,expires_at,created_at,ip_hash) VALUES (?,?,?,0,?,?,?)',
    ).bind(
      id(),
      input.email,
      await hmac(pepper, `${input.email}:${code}`),
      now + CODE_TTL,
      now,
      await hash(c.req.header('CF-Connecting-IP') || 'local'),
    ),
  ]);
  try {
    await mailer.send({ to: input.email, ...accessCodeMail(code) });
  } catch (error) {
    await c.env.DB.prepare('DELETE FROM login_codes WHERE normalized_email=?')
      .bind(input.email)
      .run();
    console.error('mail_failed', { name: error instanceof Error ? error.name : 'unknown' });
    throw new ApiError(
      502,
      'MAIL_FAILED',
      'Não foi possível enviar o e-mail agora. Tente de novo em instantes.',
    );
  }
  return c.json({ ok: true, resendInSeconds: 60 });
});

auth.post('/email/verify', async (c) => {
  await rateLimit(c);
  const input = await body(c, emailVerifySchema);
  const pepper = pepperFor(c);
  const now = Math.floor(Date.now() / 1000);
  const row = await c.env.DB.prepare(
    'SELECT id,code_hash,attempts,expires_at FROM login_codes WHERE normalized_email=? ORDER BY created_at DESC,rowid DESC LIMIT 1',
  )
    .bind(input.email)
    .first<{ id: string; code_hash: string; attempts: number; expires_at: number }>();
  const invalid = () =>
    new ApiError(400, 'CODE_INVALID', 'Código inválido. Confira os números e tente de novo.');
  const exhausted = () =>
    new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas com este código. Peça um novo.');
  const clear = () =>
    c.env.DB.prepare('DELETE FROM login_codes WHERE normalized_email=?').bind(input.email).run();
  if (!row) throw invalid();
  if (row.attempts >= 5) {
    await clear();
    throw exhausted();
  }
  if (row.expires_at < now) {
    await clear();
    throw new ApiError(400, 'CODE_EXPIRED', 'O código expirou. Peça um novo.');
  }
  if (!constantTimeEqual(row.code_hash, await hmac(pepper, `${input.email}:${input.code}`))) {
    const attempts = row.attempts + 1;
    if (attempts >= 5) {
      await clear();
      throw exhausted();
    }
    await c.env.DB.prepare('UPDATE login_codes SET attempts=? WHERE id=?')
      .bind(attempts, row.id)
      .run();
    throw invalid();
  }
  if (input.mode === 'attach') {
    const session = await resolveSession(c);
    if (!session?.user)
      throw new ApiError(401, 'UNAUTHORIZED', 'Entre na sua conta para vincular o e-mail.');
    requireUnscoped(session);
    if (session.user.email)
      throw new ApiError(409, 'ALREADY_LINKED', 'Sua conta já tem um e-mail vinculado.');
    const owner = await c.env.DB.prepare('SELECT id,email FROM users WHERE normalized_email=?')
      .bind(input.email)
      .first<{ id: string; email: string | null }>();
    if (owner && owner.id !== session.user.id) {
      // Sem merge, o código continua valendo para tentar de novo com merge=true.
      if (!input.merge)
        throw new ApiError(409, 'EMAIL_TAKEN', 'Este e-mail já está vinculado a outra conta.');
      await mergeIdentities(c, session.user.id, owner.id);
      await clear();
      const options = await memberships(c, owner.id);
      return c.json({
        user: owner,
        member: session.member,
        club: session.club,
        clubs: options.map(toClubOption),
      });
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE users SET email=?,normalized_email=?,last_login_at=? WHERE id=?',
      ).bind(input.email, input.email, now, session.user.id),
      c.env.DB.prepare(
        'UPDATE sessions SET created_at=?,scope_member_id=NULL WHERE token_hash=?',
      ).bind(now, c.get('sessionHash')),
    ]);
    await clear();
    const options = await memberships(c, session.user.id);
    return c.json({
      user: { id: session.user.id, email: input.email },
      member: session.member,
      club: session.club,
      clubs: options.map(toClubOption),
    });
  }
  await clear();
  let user = await c.env.DB.prepare('SELECT id,email FROM users WHERE normalized_email=?')
    .bind(input.email)
    .first<{ id: string; email: string | null }>();
  const isNewUser = !user;
  if (user) {
    await c.env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now, user.id).run();
  } else {
    const userId = id();
    try {
      await c.env.DB.prepare(
        'INSERT INTO users (id,email,normalized_email,created_at,last_login_at) VALUES (?,?,?,?,?)',
      )
        .bind(userId, input.email, input.email, now, now)
        .run();
      user = { id: userId, email: input.email };
    } catch (error) {
      user = await c.env.DB.prepare('SELECT id,email FROM users WHERE normalized_email=?')
        .bind(input.email)
        .first<{ id: string; email: string | null }>();
      if (!user) throw error;
    }
  }
  const options = await memberships(c, user.id);
  const last = await c.env.DB.prepare('SELECT last_member_id FROM users WHERE id=?')
    .bind(user.id)
    .first<{ last_member_id: string | null }>();
  const preferred =
    options.find((option) => option.member_id === last?.last_member_id) ??
    (options.length === 1 ? options[0] : null);
  if (preferred) {
    await c.env.DB.prepare('UPDATE users SET last_member_id=? WHERE id=?')
      .bind(preferred.member_id, user.id)
      .run();
  }
  await issueSession(c, preferred?.member_id ?? null, user.id);
  return c.json({
    user,
    member: preferred ? toMember(preferred) : null,
    club: preferred ? toClub(preferred) : null,
    clubs: options.map(toClubOption),
    isNewUser,
  });
});

auth.post('/club', async (c) => {
  const session = await resolveSession(c);
  if (!session?.user) throw new ApiError(401, 'UNAUTHORIZED', 'Entre no clube para continuar.');
  const input = await body(c, z.object({ memberId: z.string().min(1).max(100) }));
  const membership = await c.env.DB.prepare(
    'SELECT m.id member_id,m.name member_name,m.role,c.id club_id,c.name club_name,c.token_version FROM members m JOIN clubs c ON c.id=m.club_id WHERE m.id=? AND m.user_id=? AND m.active=1',
  )
    .bind(input.memberId, session.user.id)
    .first<MembershipRow>();
  if (!membership) throw new ApiError(404, 'NOT_FOUND', 'Este clube não está na sua conta.');
  if (session.scopedMemberId && session.scopedMemberId !== membership.member_id)
    throw new ApiError(403, 'SCOPED', 'Este acesso está limitado a um clube.');
  await activate(c, c.get('sessionHash'), session.user.id, membership);
  return c.json({ member: toMember(membership), club: toClub(membership) });
});

auth.post('/create', async (c) => {
  await rateLimit(c);
  const input = await body(c, createClubSchema);
  const session = await resolveSession(c);
  requireUnscoped(session);
  const userId = session?.user?.id ?? id();
  const club: Club = { id: id(), name: 'Clube de ' + input.name };
  const member: Member = { id: id(), name: input.name, role: 'owner' };
  const recoveryCode = token();
  const clubCode = token();
  const now = Math.floor(Date.now() / 1000);
  const membership: MembershipRow = {
    member_id: member.id,
    member_name: member.name,
    role: 'owner',
    club_id: club.id,
    club_name: club.name,
    token_version: 1,
  };
  await c.env.DB.batch([
    ...(session?.user
      ? []
      : [
          c.env.DB.prepare(
            'INSERT INTO users (id,email,normalized_email,recovery_hash,created_at,last_login_at,last_member_id) VALUES (?,NULL,NULL,?,?,?,?)',
          ).bind(userId, await hash(recoveryCode), now, now, member.id),
        ]),
    c.env.DB.prepare('INSERT INTO clubs (id,name,token_hash,owner_id) VALUES (?,?,?,?)').bind(
      club.id,
      club.name,
      await hash(clubCode),
      member.id,
    ),
    c.env.DB.prepare(
      "INSERT INTO members (id,club_id,name,normalized_name,recovery_hash,role,user_id) VALUES (?,?,?,?,?,'owner',?)",
    ).bind(
      member.id,
      club.id,
      member.name,
      normalizeName(member.name),
      await hash(token()),
      userId,
    ),
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
  if (session?.user) {
    await activate(c, c.get('sessionHash'), session.user.id, membership);
    return c.json({ member, club, clubToken: clubCode }, 201);
  }
  await issueSession(c, member.id, userId);
  return c.json({ member, club, recoveryCode, clubToken: clubCode }, 201);
});

// Entrar num clube cria ou reaproveita o perfil da identidade atual. Serve tanto ao
// código do clube quanto ao link de convite.
async function joinClub(
  c: Context<AppEnv>,
  club: { id: string; name: string; token_version: number },
  name: string,
) {
  const session = await resolveSession(c);
  requireUnscoped(session);
  const nameTaken = async () =>
    Boolean(
      await c.env.DB.prepare('SELECT id FROM members WHERE club_id=? AND normalized_name=?')
        .bind(club.id, normalizeName(name))
        .first(),
    );
  if (session?.user) {
    const existing = await c.env.DB.prepare(
      'SELECT m.id member_id,m.name member_name,m.role,c.id club_id,c.name club_name,c.token_version FROM members m JOIN clubs c ON c.id=m.club_id WHERE m.club_id=? AND m.user_id=? AND m.active=1',
    )
      .bind(club.id, session.user.id)
      .first<MembershipRow>();
    if (existing) {
      await activate(c, c.get('sessionHash'), session.user.id, existing);
      return c.json({ member: toMember(existing), club: toClub(existing) });
    }
    if (await nameTaken())
      throw new ApiError(
        409,
        'NAME_EXISTS',
        'Este nome já tem um perfil neste clube. Escolha outro nome.',
      );
    const member: Member = { id: id(), name, role: 'member' };
    try {
      await c.env.DB.prepare(
        "INSERT INTO members (id,club_id,name,normalized_name,recovery_hash,role,user_id) VALUES (?,?,?,?,?,'member',?)",
      )
        .bind(
          member.id,
          club.id,
          member.name,
          normalizeName(member.name),
          await hash(token()),
          session.user.id,
        )
        .run();
    } catch (error) {
      if (String(error).includes('UNIQUE'))
        throw new ApiError(409, 'NAME_EXISTS', 'Este nome já tem um perfil neste clube.');
      throw error;
    }
    await activate(c, c.get('sessionHash'), session.user.id, {
      member_id: member.id,
      member_name: member.name,
      role: 'member',
      club_id: club.id,
      club_name: club.name,
      token_version: club.token_version,
    });
    return c.json({ member, club: { id: club.id, name: club.name } }, 201);
  }
  if (await nameTaken()) {
    throw new ApiError(
      409,
      'NAME_EXISTS',
      'Este nome já tem um perfil neste clube. Use seu código pessoal ou escolha outro nome.',
    );
  }
  const userId = id();
  const recoveryCode = token();
  const member: Member = { id: id(), name, role: 'member' };
  const now = Math.floor(Date.now() / 1000);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO users (id,email,normalized_email,recovery_hash,created_at,last_login_at,last_member_id) VALUES (?,NULL,NULL,?,?,?,?)',
      ).bind(userId, await hash(recoveryCode), now, now, member.id),
      c.env.DB.prepare(
        "INSERT INTO members (id,club_id,name,normalized_name,recovery_hash,role,user_id) VALUES (?,?,?,?,?,'member',?)",
      ).bind(
        member.id,
        club.id,
        member.name,
        normalizeName(member.name),
        await hash(token()),
        userId,
      ),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      throw new ApiError(409, 'NAME_EXISTS', 'Este nome já tem um perfil neste clube.');
    throw error;
  }
  await issueSession(c, member.id, userId);
  return c.json({ member, club: { id: club.id, name: club.name }, recoveryCode }, 201);
}

auth.post('/join', async (c) => {
  await rateLimit(c);
  const input = await body(c, identitySchema);
  const club = await findClub(c, input.token);
  return joinClub(c, club, input.name);
});

type InviteRow = {
  club_id: string;
  token: string;
  password_hash: string | null;
  name: string;
  token_version: number;
};

async function findInvite(c: Context<AppEnv>, value: string) {
  return c.env.DB.prepare(
    'SELECT i.club_id,i.token,i.password_hash,c.name,c.token_version FROM club_invites i JOIN clubs c ON c.id=i.club_id WHERE i.token=?',
  )
    .bind(value)
    .first<InviteRow>();
}

auth.get('/invite/:token', async (c) => {
  const value = c.req.param('token');
  const row = value.length >= 12 && value.length <= 128 ? await findInvite(c, value) : null;
  if (!row)
    throw new ApiError(404, 'INVITE_NOT_FOUND', 'Este link de convite não está mais ativo.');
  return c.json({ clubName: row.name, passwordRequired: Boolean(row.password_hash) });
});

auth.post('/invite', async (c) => {
  await rateLimit(c);
  const input = await body(c, inviteJoinSchema);
  const row = await findInvite(c, input.token);
  if (!row)
    throw new ApiError(404, 'INVITE_NOT_FOUND', 'Este link de convite não está mais ativo.');
  if (row.password_hash) {
    if (!input.password)
      throw new ApiError(401, 'INVITE_PASSWORD', 'Informe a senha deste convite.');
    await hit(c, `invite:${row.club_id}`, 900, 20, 'Muitas tentativas de senha. Aguarde um pouco.');
    const digest = await invitePasswordDigest(pepperFor(c), row.club_id, input.password);
    if (!constantTimeEqual(row.password_hash, digest))
      throw new ApiError(401, 'INVITE_PASSWORD', 'Senha incorreta para este convite.');
  }
  return joinClub(
    c,
    { id: row.club_id, name: row.name, token_version: row.token_version },
    input.name,
  );
});

auth.post('/recover', async (c) => {
  await rateLimit(c);
  const input = await body(c, recoverySchema);
  const club = await findClub(c, input.token);
  const digest = await hash(input.recoveryCode);
  const identity = await c.env.DB.prepare('SELECT id,email FROM users WHERE recovery_hash=?')
    .bind(digest)
    .first<{ id: string; email: string | null }>();
  if (identity) {
    const membership = await c.env.DB.prepare(
      'SELECT m.id member_id,m.name member_name,m.role,c.id club_id,c.name club_name,c.token_version FROM members m JOIN clubs c ON c.id=m.club_id WHERE m.club_id=? AND m.user_id=? AND m.active=1',
    )
      .bind(club.id, identity.id)
      .first<MembershipRow>();
    if (!membership)
      throw new ApiError(401, 'INVALID_RECOVERY', 'Este código não abre um perfil neste clube.');
    await c.env.DB.prepare('UPDATE users SET last_member_id=? WHERE id=?')
      .bind(membership.member_id, identity.id)
      .run();
    await issueSession(c, membership.member_id, identity.id);
    return c.json({ user: identity, member: toMember(membership), club: toClub(membership) });
  }
  if (!input.name)
    throw new ApiError(401, 'INVALID_RECOVERY', 'Confira o nome e o código pessoal deste clube.');
  const member = await c.env.DB.prepare(
    'SELECT id,name,role,user_id FROM members WHERE club_id=? AND normalized_name=? AND recovery_hash=? AND active=1',
  )
    .bind(club.id, normalizeName(input.name), digest)
    .first<Member & { user_id: string | null }>();
  if (!member)
    throw new ApiError(401, 'INVALID_RECOVERY', 'Confira o nome e o código pessoal deste clube.');
  const profile: Member = { id: member.id, name: member.name, role: member.role };
  const user = member.user_id
    ? await c.env.DB.prepare('SELECT id,email FROM users WHERE id=?')
        .bind(member.user_id)
        .first<{ id: string; email: string | null }>()
    : null;
  if (user) {
    await issueSession(c, member.id, user.id, member.id);
    return c.json({ user, member: profile, club: { id: club.id, name: club.name }, scoped: true });
  }
  await issueSession(c, member.id, null);
  return c.json({ user: null, member: profile, club: { id: club.id, name: club.name } });
});

auth.post('/claim', async (c) => {
  await rateLimit(c);
  const input = await body(c, claimSchema);
  const now = Math.floor(Date.now() / 1000);
  const claim = await c.env.DB.prepare(
    'SELECT id,member_id FROM member_claims WHERE code_hash=? AND used_at IS NULL AND expires_at>?',
  )
    .bind(await hash(input.code), now)
    .first<{ id: string; member_id: string }>();
  if (!claim)
    throw new ApiError(401, 'INVALID_CLAIM', 'Este código de reacesso não é válido ou expirou.');
  const member = await c.env.DB.prepare(
    'SELECT m.id member_id,m.name member_name,m.role,m.active,m.user_id,c.id club_id,c.name club_name,c.token_version FROM members m JOIN clubs c ON c.id=m.club_id WHERE m.id=?',
  )
    .bind(claim.member_id)
    .first<MembershipRow & { active: number; user_id: string | null }>();
  if (!member || member.active !== 1)
    throw new ApiError(401, 'INVALID_CLAIM', 'Este código de reacesso não é válido ou expirou.');
  // Quem já está numa conta completa traz o perfil para ela, em vez de trocar de sessão.
  const current = await resolveSession(c);
  if (current?.user && !current.scopedMemberId) {
    const holder = member.user_id
      ? await c.env.DB.prepare('SELECT email FROM users WHERE id=?')
          .bind(member.user_id)
          .first<{ email: string | null }>()
      : null;
    if (!holder?.email || member.user_id === current.user.id) {
      const linked = await linkProfile(c, current.user, member, member.user_id);
      await c.env.DB.prepare('UPDATE member_claims SET used_at=? WHERE id=?')
        .bind(now, claim.id)
        .run();
      return linked;
    }
  }
  await c.env.DB.prepare('UPDATE member_claims SET used_at=? WHERE id=?').bind(now, claim.id).run();
  const user = member.user_id
    ? await c.env.DB.prepare('SELECT id,email FROM users WHERE id=?')
        .bind(member.user_id)
        .first<{ id: string; email: string | null }>()
    : null;
  await issueSession(c, member.member_id, user?.id ?? null, user ? member.member_id : null);
  return c.json({
    user: user ?? null,
    member: toMember(member),
    club: toClub(member),
    scoped: Boolean(user),
  });
});

// Traz um perfil para a conta já logada. Um perfil sem e-mail pode ter uma identidade própria
// (criada ao entrar sem conta): ela é fundida, o que traz os demais clubes dela junto.
async function linkProfile(
  c: Context<AppEnv>,
  user: SessionUser,
  membership: MembershipRow,
  profileUserId: string | null,
) {
  if (profileUserId && profileUserId !== user.id) {
    const owner = await c.env.DB.prepare('SELECT email FROM users WHERE id=?')
      .bind(profileUserId)
      .first<{ email: string | null }>();
    if (owner?.email) throw new ApiError(409, 'LINKED', 'Este perfil já está em outra conta.');
    await mergeIdentities(c, profileUserId, user.id);
  } else if (!profileUserId) {
    const taken = await c.env.DB.prepare(
      'SELECT id FROM members WHERE club_id=? AND user_id=? AND active=1',
    )
      .bind(membership.club_id, user.id)
      .first();
    if (taken)
      throw new ApiError(
        409,
        'MERGE_CONFLICT',
        'Sua conta já tem um perfil neste clube. Peça ao dono para remover um dos perfis.',
      );
    await c.env.DB.prepare('UPDATE members SET user_id=? WHERE id=?')
      .bind(user.id, membership.member_id)
      .run();
  }
  await activate(c, c.get('sessionHash'), user.id, membership);
  return c.json({ user, member: toMember(membership), club: toClub(membership), scoped: false });
}

auth.post('/link', async (c) => {
  await rateLimit(c);
  const session = await resolveSession(c);
  if (!session?.user) throw new ApiError(401, 'UNAUTHORIZED', 'Entre para vincular.');
  requireUnscoped(session);
  const input = await body(c, linkSchema);
  const digest = await hash(input.recoveryCode);
  if (input.token) {
    if (!input.name) throw new ApiError(400, 'VALIDATION', 'Informe o nome do perfil antigo.');
    const club = await findClub(c, input.token);
    const member = await c.env.DB.prepare(
      'SELECT id,name,role,user_id FROM members WHERE club_id=? AND normalized_name=? AND recovery_hash=? AND active=1',
    )
      .bind(club.id, normalizeName(input.name), digest)
      .first<{ id: string; name: string; role: 'owner' | 'member'; user_id: string | null }>();
    if (!member)
      throw new ApiError(401, 'INVALID_RECOVERY', 'Confira o nome e o código deste perfil.');
    return linkProfile(
      c,
      session.user,
      {
        member_id: member.id,
        member_name: member.name,
        role: member.role,
        club_id: club.id,
        club_name: club.name,
        token_version: club.token_version,
      },
      member.user_id,
    );
  }
  const source = await c.env.DB.prepare('SELECT id,email FROM users WHERE recovery_hash=?')
    .bind(digest)
    .first<{ id: string; email: string | null }>();
  if (!source) {
    // Só o código basta: ele é longo e aleatório, então identifica o perfil antigo sozinho.
    const legacy = await c.env.DB.prepare(
      'SELECT m.id member_id,m.name member_name,m.role,m.user_id,c.id club_id,c.name club_name,c.token_version FROM members m JOIN clubs c ON c.id=m.club_id WHERE m.recovery_hash=? AND m.active=1',
    )
      .bind(digest)
      .first<MembershipRow & { user_id: string | null }>();
    if (!legacy) throw new ApiError(401, 'INVALID_RECOVERY', 'Código de recuperação inválido.');
    return linkProfile(c, session.user, legacy, legacy.user_id);
  }
  if (source.id === session.user.id)
    throw new ApiError(409, 'LINKED', 'Este código é da identidade que você já está usando.');
  if (source.email)
    throw new ApiError(
      409,
      'LINKED',
      'Esta identidade já usa e-mail; fusão de contas não é suportada.',
    );
  await mergeIdentities(c, source.id, session.user.id);
  const options = await memberships(c, session.user.id);
  return c.json({
    user: session.user,
    member: session.member,
    club: session.club,
    clubs: options.map(toClubOption),
  });
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

auth.post('/logout-all', async (c) => {
  const session = await resolveSession(c);
  if (!session?.user) throw new ApiError(401, 'UNAUTHORIZED', 'Entre no clube para continuar.');
  requireUnscoped(session);
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(session.user.id).run();
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
  const session = await resolveSession(c);
  if (!session?.member) throw new ApiError(401, 'UNAUTHORIZED', 'Entre no clube para continuar.');
  requireUnscoped(session);
  const code = token();
  if (session.user) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET recovery_hash=? WHERE id=?').bind(
        await hash(code),
        session.user.id,
      ),
      c.env.DB.prepare('UPDATE members SET recovery_hash=? WHERE user_id=?').bind(
        await hash(token()),
        session.user.id,
      ),
      c.env.DB.prepare(
        'DELETE FROM sessions WHERE (user_id=? OR member_id IN (SELECT id FROM members WHERE user_id=?)) AND token_hash<>?',
      ).bind(session.user.id, session.user.id, c.get('sessionHash')),
    ]);
    return c.json({ recoveryCode: code, scope: 'identity' });
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE members SET recovery_hash=? WHERE id=? AND club_id=?').bind(
      await hash(code),
      session.member.id,
      c.get('club').id,
    ),
    c.env.DB.prepare('DELETE FROM sessions WHERE member_id=? AND token_hash<>?').bind(
      session.member.id,
      c.get('sessionHash'),
    ),
  ]);
  return c.json({ recoveryCode: code, scope: 'profile' });
});
