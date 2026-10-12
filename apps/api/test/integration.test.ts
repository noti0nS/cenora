import { beforeAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { screenshotEntries } from '@cenora/shared/import';

let mf: Miniflare, db: D1Database, ownerCookie: string, clubToken: string, ownerId: string;
let ip = 1;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
async function request(
  path: string,
  method = 'GET',
  data?: unknown,
  cookie = ownerCookie,
  origin = 'http://localhost',
) {
  return mf.dispatchFetch(`http://localhost/api${path}`, {
    method,
    headers: {
      Origin: origin,
      'CF-Connecting-IP': `192.0.2.${ip++}`,
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
async function join(name: string) {
  const r = await request('/auth/join', 'POST', { name, token: clubToken }, '');
  expect(r.status).toBe(201);
  return { cookie: r.headers.get('set-cookie')!.split(';')[0], ...((await r.json()) as any) };
}
async function createClub(name: string) {
  const response = await request('/auth/create', 'POST', { name }, '');
  expect(response.status).toBe(201);
  return {
    cookie: response.headers.get('set-cookie')!.split(';')[0],
    ...((await response.json()) as any),
  };
}
async function lists() {
  return (await (await request('/club/lists')).json()) as any[];
}
async function manual(kind = 'movie', title = 'A Origem') {
  const list = (await lists())[0];
  const res = await request('/media/manual', 'POST', { title, kind, listId: list.id });
  expect(res.status).toBe(201);
  return { id: ((await res.json()) as any).id, listId: list.id };
}
async function migrate(target: D1Database) {
  for (const migration of (await readdir('migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const statements = (await readFile(`migrations/${migration}`, 'utf8'))
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    await target.batch(statements.map((statement) => target.prepare(statement)));
  }
}
async function outboxCode(email: string) {
  const row = (await db
    .prepare('SELECT text FROM mail_outbox WHERE to_email=? ORDER BY rowid DESC LIMIT 1')
    .bind(email)
    .first()) as { text: string } | null;
  expect(row).not.toBeNull();
  return row!.text.match(/(\d{6})/)![1];
}
async function loginByEmail(email: string) {
  const address = email.trim().toLowerCase();
  const started = await request('/auth/email/start', 'POST', { email: address }, '');
  expect(started.status).toBe(200);
  const verified = await request(
    '/auth/email/verify',
    'POST',
    { email: address, code: await outboxCode(address) },
    '',
  );
  expect(verified.status).toBe(200);
  return {
    cookie: verified.headers.get('set-cookie')!.split(';')[0],
    ...((await verified.json()) as any),
  };
}
beforeAll(async () => {
  await mkdir('.test', { recursive: true });
  await build({
    entryPoints: ['src/index.ts'],
    outfile: '.test/worker.mjs',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
});
beforeEach(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: resolve('.test/worker.mjs'),
      compatibilityDate: '2026-10-11',
      d1Databases: { DB: '00000000-0000-0000-0000-000000000001' },
      bindings: { ENVIRONMENT: 'development' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  await migrate(db);
  const res = await request('/auth/create', 'POST', { name: 'Dono' }, '');
  expect(res.status).toBe(201);
  ownerCookie = res.headers.get('set-cookie')!.split(';')[0];
  const data = (await res.json()) as any;
  clubToken = data.clubToken;
  ownerId = data.member.id;
});
afterEach(async () => {
  await mf?.dispose();
});
describe('private club on a real Worker + D1 runtime', () => {
  it('creates private clubs freely with unique invitation codes and default lists', async () => {
    expect((await lists()).map((l) => l.name)).toEqual(['Filmes', 'Animes', 'Séries']);
    const second = await request('/auth/create', 'POST', { name: 'Dono' }, '');
    expect(second.status).toBe(201);
    const created = (await second.json()) as any;
    expect(created.clubToken).toMatch(/^[a-f0-9]{48}$/);
    expect(created.clubToken).not.toBe(clubToken);
    expect(created.member.id).not.toBe(ownerId);
    expect(((await db.prepare('SELECT COUNT(*) count FROM clubs').first()) as any).count).toBe(2);
    expect((await lists()).map((list) => list.name)).toEqual(['Filmes', 'Animes', 'Séries']);
  });
  it('requires a session for operational data and rejects cross-origin mutations', async () => {
    expect((await request('/club/lists', 'GET', undefined, '')).status).toBe(401);
    expect(
      (
        await request(
          '/club/lists',
          'POST',
          { name: 'X' },
          ownerCookie,
          'https://untrusted.example',
        )
      ).status,
    ).toBe(403);
  });
  it('isolates lists, media, member administration, and exports between freely created clubs', async () => {
    const title = await manual();
    const other = await createClub('Outro responsável');
    const ownLists = (await (
      await request('/club/lists', 'GET', undefined, other.cookie)
    ).json()) as any[];
    const otherList = ownLists[0].id;
    expect(ownLists.some((list) => list.id === title.listId)).toBe(false);
    expect((await request('/media/' + title.id, 'GET', undefined, other.cookie)).status).toBe(404);
    expect(
      (await request('/media?list=' + title.listId, 'GET', undefined, other.cookie)).status,
    ).toBe(404);
    expect(
      (await request('/club/lists/' + title.listId, 'DELETE', undefined, other.cookie)).status,
    ).toBe(404);
    expect(
      (
        await request(
          '/club/lists/' + title.listId,
          'PATCH',
          { name: 'Invadida', revision: 0 },
          other.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          '/club/lists/' + otherList + '/items',
          'POST',
          { mediaId: title.id },
          other.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          '/media/manual',
          'POST',
          { title: 'Outro filme', kind: 'movie', listId: title.listId },
          other.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          '/media/' + title.id + '/group',
          'PUT',
          { status: 'watched', season: null, episode: null, revision: 0 },
          other.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          '/media/' + title.id + '/personal',
          'PUT',
          { status: 'watched', rating: 10, season: null, episode: null, revision: 0 },
          other.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (await request('/club/members/' + ownerId + '/recovery', 'POST', undefined, other.cookie))
        .status,
    ).toBe(404);
    expect(
      (await request('/club/members/' + ownerId, 'DELETE', undefined, other.cookie)).status,
    ).toBe(404);
    const exported = (await (
      await request('/club/export', 'GET', undefined, other.cookie)
    ).json()) as any;
    expect(exported.club.id).toBe(other.club.id);
    expect(exported.members.map((member: any) => member.id)).toEqual([other.member.id]);
    expect(exported.media).toEqual([]);
    expect(exported.lists).toHaveLength(3);
    expect((await request('/media/' + title.id)).status).toBe(200);
  });
  it('keeps identical titles, import mappings, ratings, and invite rotation private to their club', async () => {
    const entry = { title: 'A Origem', kind: 'movie', category: 'Filmes' };
    const first = (await (
      await request('/club/import', 'POST', { entries: [entry] })
    ).json()) as any;
    await request('/media/' + first.ids[0] + '/personal', 'PUT', {
      status: 'watched',
      rating: 9,
      season: null,
      episode: null,
      revision: 0,
    });
    const other = await createClub('Dono');
    const second = (await (
      await request('/club/import', 'POST', { entries: [entry] }, other.cookie)
    ).json()) as any;
    expect(second.ids[0]).not.toBe(first.ids[0]);
    const details = (await (
      await request('/media/' + second.ids[0], 'GET', undefined, other.cookie)
    ).json()) as any;
    expect(details.average).toBeNull();
    expect(details.personal).toBeNull();
    const otherFriendResponse = await request(
      '/auth/join',
      'POST',
      { name: 'Ana', token: other.clubToken },
      '',
    );
    const otherFriendCookie = otherFriendResponse.headers.get('set-cookie')!.split(';')[0];
    expect(otherFriendResponse.status).toBe(201);
    await request('/club/token', 'POST');
    expect((await request('/club/lists', 'GET', undefined, other.cookie)).status).toBe(200);
    expect((await request('/club/lists', 'GET', undefined, otherFriendCookie)).status).toBe(200);
    expect(
      (await request('/auth/join', 'POST', { name: 'Beto', token: other.clubToken }, '')).status,
    ).toBe(201);
  });
  it('migrates an existing club without losing its invite, sessions, lists, ratings, or import mappings', async () => {
    const legacy = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        scriptPath: resolve('.test/worker.mjs'),
        compatibilityDate: '2026-10-11',
        d1Databases: { DB: '33333333-3333-4333-8333-333333333333' },
        bindings: { ENVIRONMENT: 'development' },
      }),
    );
    try {
      const previous = (await legacy.getD1Database('DB')) as unknown as D1Database;
      for (const migration of [
        '0001_initial.sql',
        '0002_import_aliases.sql',
        '0003_manual_identity.sql',
      ]) {
        const statements = (await readFile('migrations/' + migration, 'utf8'))
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean);
        await previous.batch(statements.map((s) => previous.prepare(s)));
      }
      const oldOwner = crypto.randomUUID(),
        oldList = crypto.randomUUID(),
        oldMedia = crypto.randomUUID();
      const oldInvite = 'legacy-private-invite-123456789';
      const oldSession = 'legacy-session-token-123456789';
      await previous.batch([
        previous
          .prepare('INSERT INTO club (id,token_hash,token_version,owner_id) VALUES (1,?,3,?)')
          .bind(digest(oldInvite), oldOwner),
        previous
          .prepare(
            "INSERT INTO members (id,name,normalized_name,recovery_hash,role) VALUES (?,'Pessoa','pessoa',?,'owner')",
          )
          .bind(oldOwner, digest('old-recovery-code')),
        previous
          .prepare(
            "INSERT INTO lists (id,name,normalized_name,color,icon,created_by) VALUES (?,'Filmes','filmes','lavender','film',?)",
          )
          .bind(oldList, oldOwner),
        previous
          .prepare(
            "INSERT INTO media (id,title,normalized_title,kind,created_by) VALUES (?,'A Origem','a origem','movie',?)",
          )
          .bind(oldMedia, oldOwner),
        previous
          .prepare(
            'INSERT INTO sessions (token_hash,member_id,club_version,expires_at) VALUES (?,?,3,?)',
          )
          .bind(digest(oldSession), oldOwner, Math.floor(Date.now() / 1000) + 86400),
        previous
          .prepare('INSERT INTO list_items (list_id,media_id,added_by,position) VALUES (?,?,?,0)')
          .bind(oldList, oldMedia, oldOwner),
        previous
          .prepare(
            "INSERT INTO member_media (member_id,media_id,status,half_points) VALUES (?,?,'watched',17)",
          )
          .bind(oldOwner, oldMedia),
        previous
          .prepare('INSERT INTO import_aliases (source_key,variant_key,media_id) VALUES (?,?,?)')
          .bind(JSON.stringify(['filmes', 'a origem']), 'a origem', oldMedia),
      ]);
      const migration = (await readFile('migrations/0004_self_service_clubs.sql', 'utf8'))
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      await previous.batch(migration.map((s) => previous.prepare(s)));
      const accounts = (await readFile('migrations/0005_email_accounts.sql', 'utf8'))
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      await previous.batch(accounts.map((s) => previous.prepare(s)));
      const claims = (await readFile('migrations/0006_member_claims.sql', 'utf8'))
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      await previous.batch(claims.map((s) => previous.prepare(s)));
      const session = await legacy.dispatchFetch('http://localhost/api/auth/session', {
        headers: { Cookie: 'watchlist_session=' + oldSession },
      });
      expect(((await session.json()) as any).member.id).toBe(oldOwner);
      const media = await legacy.dispatchFetch('http://localhost/api/media/' + oldMedia, {
        headers: { Cookie: 'watchlist_session=' + oldSession },
      });
      expect(((await media.json()) as any).personal.rating).toBe(8.5);
      expect(
        ((await previous.prepare('SELECT COUNT(*) count FROM list_items').first()) as any).count,
      ).toBe(1);
      expect(
        ((await previous.prepare('SELECT COUNT(*) count FROM import_aliases').first()) as any)
          .count,
      ).toBe(1);
      expect((await previous.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
      const joined = await legacy.dispatchFetch('http://localhost/api/auth/join', {
        method: 'POST',
        headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Amigo', token: oldInvite }),
      });
      expect(joined.status).toBe(201);
      const recovered = await legacy.dispatchFetch('http://localhost/api/auth/recover', {
        method: 'POST',
        headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Pessoa',
          token: oldInvite,
          recoveryCode: 'old-recovery-code',
        }),
      });
      expect(recovered.status).toBe(200);
      expect(((await recovered.json()) as any).user).toBeNull();
    } finally {
      await legacy.dispose();
    }
  });
  it('restores the same profile using the recovery code, never a name alone', async () => {
    const ana = await join('Ana');
    const duplicate = await request('/auth/join', 'POST', { name: 'ÁNA', token: clubToken }, '');
    expect(duplicate.status).toBe(409);
    expect(
      (
        await request(
          '/auth/recover',
          'POST',
          { name: 'Ana', token: clubToken, recoveryCode: 'incorrect-recovery-123' },
          '',
        )
      ).status,
    ).toBe(401);
    const recovered = await request(
      '/auth/recover',
      'POST',
      { name: 'Ana', token: clubToken, recoveryCode: ana.recoveryCode },
      '',
    );
    expect(recovered.status).toBe(200);
    expect(((await recovered.json()) as any).member.id).toBe(ana.member.id);
    // O código agora é da identidade; o perfil guarda um hash inutilizável.
    const identity = (await db
      .prepare('SELECT id FROM users WHERE recovery_hash=?')
      .bind(digest(ana.recoveryCode))
      .first()) as any;
    expect(identity).toBeTruthy();
    const profile = (await db
      .prepare('SELECT user_id,recovery_hash FROM members WHERE id=?')
      .bind(ana.member.id)
      .first()) as any;
    expect(profile.user_id).toBe(identity.id);
    expect(profile.recovery_hash).not.toBe(digest(ana.recoveryCode));
    // Perfil sem identidade continua recuperável com nome + código,
    // e o dono pode regerar o código desse perfil.
    const clubId = ((await db.prepare('SELECT id FROM clubs LIMIT 1').first()) as any).id;
    const legacyId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO members (id,club_id,name,normalized_name,recovery_hash,role) VALUES (?,?,?,?,?,'member')",
      )
      .bind(legacyId, clubId, 'Nino', 'nino', digest('codigo-legado-123456'))
      .run();
    const issued = (await (
      await request('/club/members/' + legacyId + '/recovery', 'POST')
    ).json()) as any;
    expect(issued.recoveryCode).toBeTruthy();
    const legacy = await request(
      '/auth/recover',
      'POST',
      { name: 'Nino', token: clubToken, recoveryCode: issued.recoveryCode },
      '',
    );
    expect(legacy.status).toBe(200);
    expect(((await legacy.json()) as any).user).toBeNull();
    // Quem tem identidade entra pelo próprio acesso; o dono não regera o código.
    expect((await request('/club/members/' + ana.member.id + '/recovery', 'POST')).status).toBe(
      409,
    );
  });
  it('keeps ratings independent, aggregates half points, and prevents impersonation', async () => {
    const title = await manual(),
      ana = await join('Ana'),
      bob = await join('Beto');
    expect(
      (
        await request(
          `/media/${title.id}/personal`,
          'PUT',
          {
            status: 'watched',
            rating: 8.5,
            season: null,
            episode: null,
            revision: 0,
            memberId: ownerId,
          },
          ana.cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/media/${title.id}/personal`,
          'PUT',
          { status: 'watching', rating: 7, season: null, episode: null, revision: 0 },
          bob.cookie,
        )
      ).status,
    ).toBe(200);
    const d = (await (await request(`/media/${title.id}`)).json()) as any;
    expect(d.average).toBe(7.75);
    expect(d.ratingCount).toBe(2);
    expect(d.personal).toBeNull();
    expect(d.groupStatus).toBe('planned');
    const mine = (await (
      await request(`/media/${title.id}`, 'GET', undefined, ana.cookie)
    ).json()) as any;
    expect(mine.personal.rating).toBe(8.5);
  });
  it('filters the unified library by kind and counts movies and shows per club', async () => {
    await manual('movie', 'Filme da turma');
    await manual('tv', 'Série da turma');
    const read = async (query: string, cookie?: string) =>
      ((await (await request(`/media${query}`, 'GET', undefined, cookie)).json()) as any).items.map(
        (item: any) => item.title,
      );
    expect(await read('?kind=movie')).toEqual(['Filme da turma']);
    expect(await read('?kind=tv')).toEqual(['Série da turma']);
    expect((await read('')).sort()).toEqual(['Filme da turma', 'Série da turma']);
    expect(await (await request('/media/counts')).json()).toEqual({ movie: 1, tv: 1 });
    const other = await createClub('Outro');
    expect(await (await request('/media/counts', 'GET', undefined, other.cookie)).json()).toEqual({
      movie: 0,
      tv: 0,
    });
  });
  it('spins only unfinished titles of the requested kind from the caller club', async () => {
    const open = await manual('movie', 'Ainda não vimos');
    const seen = await manual('movie', 'Já vimos');
    const closed = await manual('movie', 'Já vi sozinho');
    await manual('tv', 'Uma série');
    const group = (await (await request(`/media/${seen.id}`)).json()) as any;
    expect(
      (
        await request(`/media/${seen.id}/group`, 'PUT', {
          status: 'watched',
          season: null,
          episode: null,
          revision: group.revision,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/media/${closed.id}/personal`, 'PUT', {
          status: 'watched',
          rating: 8,
          season: null,
          episode: null,
          revision: 0,
        })
      ).status,
    ).toBe(200);
    const spin = async (query: string, cookie?: string) =>
      ((await (await request(`/media/spin${query}`, 'GET', undefined, cookie)).json()) as any)
        .items;
    expect((await spin('?kind=movie')).map((item: any) => item.id)).toEqual([open.id]);
    expect((await spin('?kind=tv')).map((item: any) => item.title)).toEqual(['Uma série']);
    expect(await spin('?kind=movie&mine=true')).toEqual([]);
    const other = await createClub('Outro');
    expect(await spin('?kind=movie', other.cookie)).toEqual([]);
    expect((await request('/media/spin', 'GET', undefined, '')).status).toBe(401);
  });
  it('validates rating increments and rejects movie checkpoints', async () => {
    const title = await manual();
    expect(
      (
        await request(`/media/${title.id}/personal`, 'PUT', {
          status: 'watched',
          rating: 8.3,
          season: null,
          episode: null,
          revision: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/media/${title.id}/personal`, 'PUT', {
          status: 'watching',
          rating: null,
          season: 1,
          episode: 2,
          revision: 0,
        })
      ).status,
    ).toBe(400);
  });
  it('stores personal and group TV checkpoints independently', async () => {
    const title = await manual('tv', 'Dark');
    expect(
      (
        await request(`/media/${title.id}/personal`, 'PUT', {
          status: 'watching',
          rating: 9,
          season: 2,
          episode: 3,
          revision: 0,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/media/${title.id}/group`, 'PUT', {
          status: 'watching',
          season: 1,
          episode: 4,
          revision: 0,
        })
      ).status,
    ).toBe(200);
    const d = (await (await request(`/media/${title.id}`)).json()) as any;
    expect(d.personal.season).toBe(2);
    expect(d.personal.episode).toBe(3);
    expect(d.groupSeason).toBe(1);
    expect(d.groupEpisode).toBe(4);
  });
  it('detects stale personal and shared revisions', async () => {
    const title = await manual();
    const value = { status: 'watching', season: null, episode: null, revision: 0 };
    expect((await request(`/media/${title.id}/group`, 'PUT', value)).status).toBe(200);
    expect((await request(`/media/${title.id}/group`, 'PUT', value)).status).toBe(409);
    expect(
      (await request(`/media/${title.id}/personal`, 'PUT', { ...value, rating: 8 })).status,
    ).toBe(200);
    expect(
      (await request(`/media/${title.id}/personal`, 'PUT', { ...value, rating: 9 })).status,
    ).toBe(409);
  });
  it('preserves one rating when a title belongs to several lists', async () => {
    const title = await manual();
    const another = (await lists())[1];
    await request(`/media/${title.id}/personal`, 'PUT', {
      status: 'watched',
      rating: 9,
      season: null,
      episode: null,
      revision: 0,
    });
    await request(`/club/lists/${another.id}/items`, 'POST', { mediaId: title.id });
    await request(`/club/lists/${another.id}/items`, 'POST', { mediaId: title.id });
    const d = (await (await request(`/media/${title.id}`)).json()) as any;
    expect(d.ratingCount).toBe(1);
    expect(d.lists).toHaveLength(2);
    await request(`/club/lists/${title.listId}/items/${title.id}`, 'DELETE');
    expect(((await (await request(`/media/${title.id}`)).json()) as any).personal.rating).toBe(9);
  });
  it('imports screenshots idempotently and retains manual titles and order', async () => {
    expect(screenshotEntries).toHaveLength(40);
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < screenshotEntries.length; i += 3)
        expect(
          (await request('/club/import', 'POST', { entries: screenshotEntries.slice(i, i + 3) }))
            .status,
        ).toBe(200);
    const rows = (await db.prepare('SELECT COUNT(*) count FROM media').first()) as any;
    expect(rows.count).toBe(40);
    expect((await lists()).map((l) => l.count)).toEqual([29, 3, 8]);
    const gallery = (await (await request(`/media?list=${(await lists())[0].id}`)).json()) as any;
    expect(gallery.items[0].title).toBe('Seven - os 7 pecados capitais');
    expect(
      gallery.items.every((m: any) => m.groupStatus === 'planned' && m.personal === null),
    ).toBe(true);
  });
  it('allows manual entries without API credentials and clearly reports catalog availability', async () => {
    const title = await manual();
    const d = (await (await request(`/media/${title.id}`)).json()) as any;
    expect(d.imdbRating).toBeNull();
    expect(d.cast).toEqual([]);
    const search = (await (await request('/media/search?q=Alien')).json()) as any;
    expect(search.available).toBe(false);
  });
  it('keeps import identity and personal tracking after a manual title is linked to TMDB', async () => {
    const entry = screenshotEntries[0];
    const imported = (await (
      await request('/club/import', 'POST', { entries: [entry] })
    ).json()) as any;
    const mediaId = imported.ids[0];
    await request(`/media/${mediaId}/personal`, 'PUT', {
      status: 'watched',
      rating: 9.5,
      season: null,
      episode: null,
      revision: 0,
    });
    await db
      .prepare('INSERT INTO provider_cache (key,payload,expires_at) VALUES (?,?,?)')
      .bind(
        'details:movie:807',
        JSON.stringify({
          title: 'Seven',
          release_date: '1995-09-22',
          overview: 'Uma investigação.',
          poster_path: null,
          vote_count: 100,
          vote_average: 8.4,
          runtime: 127,
          genres: [],
          credits: { cast: [] },
        }),
        Date.now() + 86400000,
      )
      .run();
    expect(
      (await request(`/media/${mediaId}/link`, 'POST', { tmdbId: 807, kind: 'movie', revision: 0 }))
        .status,
    ).toBe(200);
    const repeated = (await (
      await request('/club/import', 'POST', { entries: [entry] })
    ).json()) as any;
    expect(repeated.ids).toEqual([mediaId]);
    expect(((await db.prepare('SELECT COUNT(*) count FROM media').first()) as any).count).toBe(1);
    const details = (await (await request(`/media/${mediaId}`)).json()) as any;
    expect(details.title).toBe('Seven');
    expect(details.personal.rating).toBe(9.5);
  });
  it('remembers compound imports without recreating the original placeholder', async () => {
    const originalTitle = 'Zootopia 1 e 2';
    const entries = ['Zootopia', 'Zootopia 2'].map((title) => ({
      title,
      originalTitle,
      kind: 'movie',
      category: 'Filmes',
    }));
    expect((await request('/club/import', 'POST', { entries })).status).toBe(200);
    expect(
      (
        await request('/club/import', 'POST', {
          entries: [{ title: originalTitle, kind: 'movie', category: 'Filmes' }],
        })
      ).status,
    ).toBe(200);
    expect(((await db.prepare('SELECT COUNT(*) count FROM media').first()) as any).count).toBe(2);
    expect((await lists())[0].count).toBe(2);
  });
  it('deduplicates concurrent manual registration while keeping remakes with different years distinct', async () => {
    const listId = (await lists())[0].id;
    const input = { title: 'Anaconda', kind: 'movie', year: 1997, listId };
    const responses = await Promise.all([
      request('/media/manual', 'POST', input),
      request('/media/manual', 'POST', input),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const records = await Promise.all(responses.map((r) => r.json() as Promise<any>));
    expect(records[0].id).toBe(records[1].id);
    const remake = await request('/media/manual', 'POST', { ...input, year: 2025 });
    expect(remake.status).toBe(201);
    expect(((await remake.json()) as any).id).not.toBe(records[0].id);
  });
  it('limits destructive administration to the owner', async () => {
    const friend = await join('Amigo'),
      list = (await lists())[0];
    expect(
      (await request(`/club/lists/${list.id}`, 'DELETE', undefined, friend.cookie)).status,
    ).toBe(403);
    expect((await request('/club/token', 'POST', undefined, friend.cookie)).status).toBe(403);
    expect(
      (
        await request(
          '/club/import',
          'POST',
          { entries: screenshotEntries.slice(0, 1) },
          friend.cookie,
        )
      ).status,
    ).toBe(403);
  });
  it('rotates the club token and invalidates other sessions', async () => {
    const ana = await join('Ana');
    const r = await request('/club/token', 'POST');
    expect(r.status).toBe(200);
    const fresh = ((await r.json()) as any).clubToken;
    expect((await request('/club/lists', 'GET', undefined, ana.cookie)).status).toBe(401);
    expect((await request('/club/lists')).status).toBe(200);
    expect(
      (
        await request(
          '/auth/recover',
          'POST',
          { name: 'Ana', token: clubToken, recoveryCode: ana.recoveryCode },
          '',
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          '/auth/recover',
          'POST',
          { name: 'Ana', token: fresh, recoveryCode: ana.recoveryCode },
          '',
        )
      ).status,
    ).toBe(200);
  });
  it('revokes removed members and excludes their ratings from the club average', async () => {
    const title = await manual(),
      ana = await join('Ana');
    await request(
      `/media/${title.id}/personal`,
      'PUT',
      { status: 'watched', rating: 9, season: null, episode: null, revision: 0 },
      ana.cookie,
    );
    expect((await request(`/club/members/${ana.member.id}`, 'DELETE')).status).toBe(200);
    expect((await request('/club/lists', 'GET', undefined, ana.cookie)).status).toBe(401);
    const d = (await (await request(`/media/${title.id}`)).json()) as any;
    expect(d.ratingCount).toBe(0);
    expect(d.average).toBeNull();
  });
  it('exports operational data without recovery, access, or session secrets', async () => {
    await join('Ana');
    const r = await request('/club/export');
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain('recovery_hash');
    expect(text).not.toContain('token_hash');
    expect(text).not.toContain(clubToken);
  });
  it('rate-limits repeated authentication attempts', async () => {
    let last = 0;
    for (let i = 0; i < 13; i++) {
      const r = await mf.dispatchFetch('http://localhost/api/auth/join', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '198.51.100.7',
        },
        body: JSON.stringify({ name: 'Tentativa', token: 'invalid-token-123456' }),
      });
      last = r.status;
    }
    expect(last).toBe(429);
  });
});
describe('email access on the same runtime', () => {
  it('creates a passwordless account, normalizes the address, and reuses it later', async () => {
    const started = await request('/auth/email/start', 'POST', { email: '  ANA@Example.COM ' }, '');
    expect(started.status).toBe(200);
    const verified = await request(
      '/auth/email/verify',
      'POST',
      { email: 'ANA@example.com', code: await outboxCode('ana@example.com') },
      '',
    );
    expect(verified.status).toBe(200);
    const first = (await verified.json()) as any;
    expect(first.user.email).toBe('ana@example.com');
    expect(first.isNewUser).toBe(true);
    expect(first.member).toBeNull();
    expect(first.club).toBeNull();
    expect(first.clubs).toEqual([]);
    const cookie = verified.headers.get('set-cookie')!.split(';')[0];
    const session = (await (
      await request('/auth/session', 'GET', undefined, cookie)
    ).json()) as any;
    expect(session.user.email).toBe('ana@example.com');
    expect(session.member).toBeNull();
    expect(session.scoped).toBe(false);
    expect(session.clubs).toEqual([]);
    const addresses = async () =>
      (
        (await db
          .prepare("SELECT COUNT(*) count FROM users WHERE normalized_email='ana@example.com'")
          .first()) as any
      ).count;
    expect(await addresses()).toBe(1);
    await db.prepare('DELETE FROM auth_attempts').run();
    const again = await loginByEmail('ana@example.com');
    expect(again.user.id).toBe(first.user.id);
    expect(again.isNewUser).toBe(false);
    expect(await addresses()).toBe(1);
  });
  it('reports guest identities without an email', async () => {
    const session = (await (await request('/auth/session')).json()) as any;
    expect(session.user.id).toBeTruthy();
    expect(session.user.email).toBeNull();
    expect(session.clubs).toHaveLength(1);
    expect(session.member.id).toBe(ownerId);
  });
  it('stores only a peppered hash of the six-digit code', async () => {
    const email = 'heitor@example.com';
    await request('/auth/email/start', 'POST', { email }, '');
    const code = await outboxCode(email);
    const row = (await db
      .prepare('SELECT code_hash FROM login_codes WHERE normalized_email=?')
      .bind(email)
      .first()) as any;
    expect(row.code_hash).not.toContain(code);
    expect(row.code_hash).toBe(
      createHmac('sha256', 'development-pepper').update(`${email}:${code}`).digest('hex'),
    );
  });
  it('blocks after five wrong codes and clears the code', async () => {
    const email = 'beto@example.com';
    await request('/auth/email/start', 'POST', { email }, '');
    const code = await outboxCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await request('/auth/email/verify', 'POST', { email, code: wrong }, '');
      expect(response.status).toBe(400);
    }
    const blocked = await request('/auth/email/verify', 'POST', { email, code: wrong }, '');
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as any).error.code).toBe('TOO_MANY_ATTEMPTS');
    expect((await request('/auth/email/verify', 'POST', { email, code }, '')).status).toBe(400);
    expect(
      ((await db.prepare('SELECT COUNT(*) count FROM login_codes').first()) as any).count,
    ).toBe(0);
  });
  it('expires codes and clears them', async () => {
    const email = 'caio@example.com';
    await request('/auth/email/start', 'POST', { email }, '');
    const code = await outboxCode(email);
    await db
      .prepare('UPDATE login_codes SET expires_at=0 WHERE normalized_email=?')
      .bind(email)
      .run();
    const expired = await request('/auth/email/verify', 'POST', { email, code }, '');
    expect(expired.status).toBe(400);
    expect(((await expired.json()) as any).error.code).toBe('CODE_EXPIRED');
    expect(
      ((await db.prepare('SELECT COUNT(*) count FROM login_codes').first()) as any).count,
    ).toBe(0);
  });
  it('cools down repeated code requests per address and validates the address', async () => {
    const email = 'dora@example.com';
    expect((await request('/auth/email/start', 'POST', { email }, '')).status).toBe(200);
    const second = await request('/auth/email/start', 'POST', { email }, '');
    expect(second.status).toBe(429);
    expect(((await second.json()) as any).error.code).toBe('RATE_LIMIT');
    expect(
      (await request('/auth/email/start', 'POST', { email: 'eva@example.com' }, '')).status,
    ).toBe(200);
    expect((await request('/auth/email/start', 'POST', { email: 'não-é-email' }, '')).status).toBe(
      400,
    );
  });
  it('renews sessions with use and stops at the account cap', async () => {
    const account = await loginByEmail('fabi@example.com');
    const tokenHash = digest(account.cookie.split('=')[1]);
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?')
      .bind(now + 86400, tokenHash)
      .run();
    const renewed = await request('/auth/session', 'GET', undefined, account.cookie);
    expect(renewed.status).toBe(200);
    expect(renewed.headers.get('set-cookie')).toBeTruthy();
    const row = (await db
      .prepare('SELECT expires_at FROM sessions WHERE token_hash=?')
      .bind(tokenHash)
      .first()) as any;
    expect(row.expires_at).toBeGreaterThan(now + 20 * 86400);
    await db
      .prepare('UPDATE sessions SET created_at=?, expires_at=? WHERE token_hash=?')
      .bind(now - 366 * 86400, now + 86400, tokenHash)
      .run();
    const capped = await request('/auth/session', 'GET', undefined, account.cookie);
    expect(capped.status).toBe(200);
    expect(capped.headers.get('set-cookie')).toBeNull();
    const cappedRow = (await db
      .prepare('SELECT expires_at FROM sessions WHERE token_hash=?')
      .bind(tokenHash)
      .first()) as any;
    expect(cappedRow.expires_at).toBe(now + 86400);
  });
  it('keeps profile sessions alive without a hard cap', async () => {
    const clubId = ((await db.prepare('SELECT id FROM clubs LIMIT 1').first()) as any).id;
    const memberId = crypto.randomUUID();
    const token = 'perfil-antigo-token-123456';
    const now = Math.floor(Date.now() / 1000);
    await db.batch([
      db
        .prepare(
          "INSERT INTO members (id,club_id,name,normalized_name,recovery_hash,role) VALUES (?,?,?,?,?,'member')",
        )
        .bind(memberId, clubId, 'Perfil antigo', 'perfil antigo', digest('codigo-antigo-123456')),
      db
        .prepare(
          'INSERT INTO sessions (token_hash,user_id,member_id,club_version,scope_member_id,created_at,expires_at,renewed_at,user_agent) VALUES (?,NULL,?,1,NULL,?,?,NULL,NULL)',
        )
        .bind(digest(token), memberId, now - 400 * 86400, now + 86400),
    ]);
    const response = await request('/club/lists', 'GET', undefined, 'watchlist_session=' + token);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeTruthy();
    const row = (await db
      .prepare('SELECT expires_at FROM sessions WHERE token_hash=?')
      .bind(digest(token))
      .first()) as any;
    expect(row.expires_at).toBeGreaterThan(now + 20 * 86400);
  });
  it('switches between clubs and signs out of every device', async () => {
    const account = await loginByEmail('gabi@example.com');
    const created = await request('/auth/create', 'POST', { name: 'Gabi' }, account.cookie);
    expect(created.status).toBe(201);
    const own = (await created.json()) as any;
    expect(own.recoveryCode).toBeUndefined();
    const other = await createClub('Outra pessoa');
    const joined = await request(
      '/auth/join',
      'POST',
      { name: 'Gabi', token: other.clubToken },
      account.cookie,
    );
    expect(joined.status).toBe(201);
    const joinedData = (await joined.json()) as any;
    expect(joinedData.recoveryCode).toBeUndefined();
    const session = (await (
      await request('/auth/session', 'GET', undefined, account.cookie)
    ).json()) as any;
    expect(session.clubs.map((option: any) => option.memberId).sort()).toEqual(
      [own.member.id, joinedData.member.id].sort(),
    );
    expect(session.member.id).toBe(joinedData.member.id);
    const switched = await request(
      '/auth/club',
      'POST',
      { memberId: own.member.id },
      account.cookie,
    );
    expect(switched.status).toBe(200);
    expect(((await switched.json()) as any).club.id).toBe(own.club.id);
    const active = (await (
      await request('/auth/session', 'GET', undefined, account.cookie)
    ).json()) as any;
    expect(active.member.id).toBe(own.member.id);
    expect(active.club.id).toBe(own.club.id);
    expect((await request('/club/lists', 'GET', undefined, account.cookie)).status).toBe(200);
    expect(
      (await request('/auth/club', 'POST', { memberId: 'outro-perfil' }, account.cookie)).status,
    ).toBe(404);
    const out = await request('/auth/logout-all', 'POST', undefined, account.cookie);
    expect(out.status).toBe(200);
    const after = (await (
      await request('/auth/session', 'GET', undefined, account.cookie)
    ).json()) as any;
    expect(after.user).toBeNull();
    expect(
      (await request('/auth/club', 'POST', { memberId: own.member.id }, account.cookie)).status,
    ).toBe(401);
  });
  it('never exposes the development outbox outside development', async () => {
    const production = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        scriptPath: resolve('.test/worker.mjs'),
        compatibilityDate: '2026-10-11',
        d1Databases: { DB: '44444444-4444-4444-8444-444444444444' },
        bindings: { ENVIRONMENT: 'production' },
      }),
    );
    try {
      await migrate((await production.getD1Database('DB')) as unknown as D1Database);
      expect((await production.dispatchFetch('http://localhost/api/dev/outbox')).status).toBe(404);
      const start = await production.dispatchFetch('http://localhost/api/auth/email/start', {
        method: 'POST',
        headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'sem-provedor@example.com' }),
      });
      expect(start.status).toBe(503);
      expect(((await start.json()) as any).error.code).toBe('MAIL_UNAVAILABLE');
    } finally {
      await production.dispose();
    }
  });
});
describe('guest identities on the same runtime', () => {
  it('gives the club creator an identity and joins a second club with the same session', async () => {
    const ana = await createClub('Ana');
    expect(ana.recoveryCode).toMatch(/^[a-f0-9]{48}$/);
    const identity = (await db
      .prepare('SELECT id,email FROM users WHERE recovery_hash=?')
      .bind(digest(ana.recoveryCode))
      .first()) as any;
    expect(identity).toBeTruthy();
    expect(identity.email).toBeNull();
    const profile = (await db
      .prepare('SELECT user_id,recovery_hash FROM members WHERE id=?')
      .bind(ana.member.id)
      .first()) as any;
    expect(profile.user_id).toBe(identity.id);
    expect(profile.recovery_hash).not.toBe(digest(ana.recoveryCode));
    const session = (await (
      await request('/auth/session', 'GET', undefined, ana.cookie)
    ).json()) as any;
    expect(session.user.id).toBe(identity.id);
    expect(session.clubs).toHaveLength(1);
    const other = await createClub('Beto');
    const joined = await request(
      '/auth/join',
      'POST',
      { name: 'Ana', token: other.clubToken },
      ana.cookie,
    );
    expect(joined.status).toBe(201);
    const joinedData = (await joined.json()) as any;
    expect(joinedData.recoveryCode).toBeUndefined();
    const after = (await (
      await request('/auth/session', 'GET', undefined, ana.cookie)
    ).json()) as any;
    expect(after.clubs).toHaveLength(2);
    expect(
      (
        (await db
          .prepare('SELECT COUNT(*) count FROM members WHERE user_id=?')
          .bind(identity.id)
          .first()) as any
      ).count,
    ).toBe(2);
    const again = await request(
      '/auth/join',
      'POST',
      { name: 'Ana', token: other.clubToken },
      ana.cookie,
    );
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).member.id).toBe(joinedData.member.id);
  });
  it('recovers the guest identity on another device with the identity code', async () => {
    const ana = await createClub('Ana');
    const identity = (await db
      .prepare('SELECT id FROM users WHERE recovery_hash=?')
      .bind(digest(ana.recoveryCode))
      .first()) as any;
    const recovered = await request(
      '/auth/recover',
      'POST',
      { token: ana.clubToken, recoveryCode: ana.recoveryCode },
      '',
    );
    expect(recovered.status).toBe(200);
    const data = (await recovered.json()) as any;
    expect(data.user.id).toBe(identity.id);
    expect(data.member.id).toBe(ana.member.id);
    const cookie = recovered.headers.get('set-cookie')!.split(';')[0];
    const session = (await (
      await request('/auth/session', 'GET', undefined, cookie)
    ).json()) as any;
    expect(session.user.id).toBe(identity.id);
    expect(session.clubs).toHaveLength(1);
    const other = await createClub('Beto');
    expect(
      (
        await request(
          '/auth/recover',
          'POST',
          { token: other.clubToken, recoveryCode: ana.recoveryCode },
          '',
        )
      ).status,
    ).toBe(401);
  });
  it('attaches an email to the guest identity and signs in with it elsewhere', async () => {
    const ana = await createClub('Ana');
    const started = await request(
      '/auth/email/start',
      'POST',
      { email: 'ana@example.com', mode: 'attach' },
      ana.cookie,
    );
    expect(started.status).toBe(200);
    const verified = await request(
      '/auth/email/verify',
      'POST',
      { email: 'ana@example.com', code: await outboxCode('ana@example.com'), mode: 'attach' },
      ana.cookie,
    );
    expect(verified.status).toBe(200);
    expect(((await verified.json()) as any).user.email).toBe('ana@example.com');
    await db.prepare('DELETE FROM auth_attempts').run();
    const fresh = await loginByEmail('ana@example.com');
    expect(fresh.user.email).toBe('ana@example.com');
    expect(fresh.clubs).toHaveLength(1);
    expect(fresh.member.id).toBe(ana.member.id);
    expect(
      (await request('/auth/email/start', 'POST', { email: 'x@example.com', mode: 'attach' }, ''))
        .status,
    ).toBe(401);
    const other = await createClub('Beto');
    await db.prepare('DELETE FROM auth_attempts').run();
    const second = await request(
      '/auth/email/start',
      'POST',
      { email: 'ana@example.com', mode: 'attach' },
      other.cookie,
    );
    expect(second.status).toBe(200);
    const conflict = await request(
      '/auth/email/verify',
      'POST',
      { email: 'ana@example.com', code: await outboxCode('ana@example.com'), mode: 'attach' },
      other.cookie,
    );
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as any).error.code).toBe('EMAIL_TAKEN');
  });
  it('promotes profile sessions once the member gains an identity', async () => {
    const ana = await createClub('Ana');
    const identity = (await db
      .prepare('SELECT id FROM users WHERE recovery_hash=?')
      .bind(digest(ana.recoveryCode))
      .first()) as any;
    await db.batch([
      db.prepare('UPDATE members SET user_id=NULL WHERE id=?').bind(ana.member.id),
      db.prepare('UPDATE sessions SET user_id=NULL WHERE member_id=?').bind(ana.member.id),
    ]);
    const before = (await (
      await request('/auth/session', 'GET', undefined, ana.cookie)
    ).json()) as any;
    expect(before.user).toBeNull();
    expect(before.clubs).toEqual([]);
    await db
      .prepare('UPDATE members SET user_id=? WHERE id=?')
      .bind(identity.id, ana.member.id)
      .run();
    const after = (await (
      await request('/auth/session', 'GET', undefined, ana.cookie)
    ).json()) as any;
    expect(after.user.id).toBe(identity.id);
    expect(after.clubs).toHaveLength(1);
    const row = (await db
      .prepare('SELECT user_id FROM sessions WHERE member_id=?')
      .bind(ana.member.id)
      .first()) as any;
    expect(row.user_id).toBe(identity.id);
  });
  it('rotates the identity recovery code and keeps the current device', async () => {
    const ana = await createClub('Ana');
    const second = await request(
      '/auth/recover',
      'POST',
      { token: ana.clubToken, recoveryCode: ana.recoveryCode },
      '',
    );
    expect(second.status).toBe(200);
    const secondCookie = second.headers.get('set-cookie')!.split(';')[0];
    const rotated = await request('/auth/recovery-code', 'POST', undefined, ana.cookie);
    expect(rotated.status).toBe(200);
    const fresh = ((await rotated.json()) as any).recoveryCode;
    expect(fresh).not.toBe(ana.recoveryCode);
    expect((await request('/club/lists', 'GET', undefined, secondCookie)).status).toBe(401);
    expect((await request('/club/lists', 'GET', undefined, ana.cookie)).status).toBe(200);
    expect(
      (
        await request(
          '/auth/recover',
          'POST',
          { token: ana.clubToken, recoveryCode: ana.recoveryCode },
          '',
        )
      ).status,
    ).toBe(401);
    expect(
      (await request('/auth/recover', 'POST', { token: ana.clubToken, recoveryCode: fresh }, ''))
        .status,
    ).toBe(200);
  });
});
describe('scoped re-access and identity linking', () => {
  it('grants the owner claim code as a session locked to one club', async () => {
    const ana = await createClub('Ana');
    const beto = await createClub('Beto');
    const joined = await request(
      '/auth/join',
      'POST',
      { name: 'Ana', token: beto.clubToken },
      ana.cookie,
    );
    const anaInBeto = ((await joined.json()) as any).member.id;
    const issued = await request(
      '/club/members/' + anaInBeto + '/claim',
      'POST',
      undefined,
      beto.cookie,
    );
    expect(issued.status).toBe(200);
    const claim = ((await issued.json()) as any).claimCode;
    const claimed = await request('/auth/claim', 'POST', { code: claim }, '');
    expect(claimed.status).toBe(200);
    const claimedData = (await claimed.json()) as any;
    expect(claimedData.scoped).toBe(true);
    expect(claimedData.member.id).toBe(anaInBeto);
    const cookie = claimed.headers.get('set-cookie')!.split(';')[0];
    const session = (await (
      await request('/auth/session', 'GET', undefined, cookie)
    ).json()) as any;
    expect(session.scoped).toBe(true);
    expect(session.clubs.map((option: any) => option.memberId)).toEqual([anaInBeto]);
    expect((await request('/auth/club', 'POST', { memberId: ana.member.id }, cookie)).status).toBe(
      403,
    );
    expect((await request('/auth/recovery-code', 'POST', undefined, cookie)).status).toBe(403);
    expect((await request('/auth/logout-all', 'POST', undefined, cookie)).status).toBe(403);
    await request(
      '/auth/email/start',
      'POST',
      { email: 'ana.claim@example.com', mode: 'attach' },
      cookie,
    );
    const attached = await request(
      '/auth/email/verify',
      'POST',
      {
        email: 'ana.claim@example.com',
        code: await outboxCode('ana.claim@example.com'),
        mode: 'attach',
      },
      cookie,
    );
    expect(attached.status).toBe(200);
    const unlocked = (await (
      await request('/auth/session', 'GET', undefined, cookie)
    ).json()) as any;
    expect(unlocked.scoped).toBe(false);
    expect(unlocked.clubs).toHaveLength(2);
    expect((await request('/auth/claim', 'POST', { code: claim }, '')).status).toBe(401);
  });
  it('issues single-use claim codes, only for the owner, and invalidates the previous one', async () => {
    const ana = await join('Ana');
    const first = await request('/club/members/' + ana.member.id + '/claim', 'POST');
    expect(first.status).toBe(200);
    const firstCode = ((await first.json()) as any).claimCode;
    const again = await request('/club/members/' + ana.member.id + '/claim', 'POST');
    const againCode = ((await again.json()) as any).claimCode;
    expect((await request('/auth/claim', 'POST', { code: firstCode }, '')).status).toBe(401);
    await db
      .prepare('UPDATE member_claims SET expires_at=0 WHERE member_id=?')
      .bind(ana.member.id)
      .run();
    expect((await request('/auth/claim', 'POST', { code: againCode }, '')).status).toBe(401);
    const other = await createClub('Outro');
    expect(
      (await request('/club/members/' + ana.member.id + '/claim', 'POST', undefined, other.cookie))
        .status,
    ).toBe(404);
    expect(
      (await request('/club/members/' + ana.member.id + '/claim', 'POST', undefined, ana.cookie))
        .status,
    ).toBe(403);
    expect(
      (await request('/club/members/' + ana.member.id + '/claim', 'POST', undefined, '')).status,
    ).toBe(401);
  });
  it('adopts an old profile into an account and keeps its recovery code useful', async () => {
    const clubId = (
      (await db.prepare('SELECT id FROM clubs ORDER BY rowid LIMIT 1').first()) as any
    ).id;
    const account = await loginByEmail('lia@example.com');
    const legacyId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO members (id,club_id,name,normalized_name,recovery_hash,role) VALUES (?,?,?,?,?,'member')",
      )
      .bind(legacyId, clubId, 'Lia antiga', 'lia antiga', digest('codigo-da-lia-123456'))
      .run();
    const linked = await request(
      '/auth/link',
      'POST',
      { name: 'Lia antiga', token: clubToken, recoveryCode: 'codigo-da-lia-123456' },
      account.cookie,
    );
    expect(linked.status).toBe(200);
    const linkedData = (await linked.json()) as any;
    expect(linkedData.member.id).toBe(legacyId);
    expect(linkedData.club.id).toBe(clubId);
    const profile = (await db
      .prepare('SELECT user_id FROM members WHERE id=?')
      .bind(legacyId)
      .first()) as any;
    expect(profile.user_id).toBe(account.user.id);
    const session = (await (
      await request('/auth/session', 'GET', undefined, account.cookie)
    ).json()) as any;
    expect(session.member.id).toBe(legacyId);
    expect(session.clubs).toHaveLength(1);
    const recovered = await request(
      '/auth/recover',
      'POST',
      { name: 'Lia antiga', token: clubToken, recoveryCode: 'codigo-da-lia-123456' },
      '',
    );
    expect(recovered.status).toBe(200);
    expect(((await recovered.json()) as any).user.id).toBe(account.user.id);
  });
  it('refuses adoption when the account already has a profile in the club or the profile is taken', async () => {
    const clubId = (
      (await db.prepare('SELECT id FROM clubs ORDER BY rowid LIMIT 1').first()) as any
    ).id;
    const account = await loginByEmail('lia2@example.com');
    const joined = await request(
      '/auth/join',
      'POST',
      { name: 'Lia nova', token: clubToken },
      account.cookie,
    );
    expect(joined.status).toBe(201);
    const legacyId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO members (id,club_id,name,normalized_name,recovery_hash,role) VALUES (?,?,?,?,?,'member')",
      )
      .bind(legacyId, clubId, 'Lia antiga', 'lia antiga', digest('codigo-da-lia-123456'))
      .run();
    const conflict = await request(
      '/auth/link',
      'POST',
      { name: 'Lia antiga', token: clubToken, recoveryCode: 'codigo-da-lia-123456' },
      account.cookie,
    );
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as any).error.code).toBe('MERGE_CONFLICT');
    const ana = await join('Ana');
    await db
      .prepare('UPDATE members SET recovery_hash=? WHERE id=?')
      .bind(digest('codigo-de-outra-123456'), ana.member.id)
      .run();
    const linkedElsewhere = await request(
      '/auth/link',
      'POST',
      { name: 'Ana', token: clubToken, recoveryCode: 'codigo-de-outra-123456' },
      account.cookie,
    );
    expect(linkedElsewhere.status).toBe(409);
    expect(((await linkedElsewhere.json()) as any).error.code).toBe('LINKED');
  });
  it('fuses a guest identity into an account, moving clubs and sessions', async () => {
    const ana = await createClub('Ana');
    const beto = await createClub('Beto');
    await request('/auth/join', 'POST', { name: 'Ana', token: beto.clubToken }, ana.cookie);
    const source = (await db
      .prepare('SELECT id FROM users WHERE recovery_hash=?')
      .bind(digest(ana.recoveryCode))
      .first()) as any;
    const account = await loginByEmail('conta@example.com');
    const fused = await request(
      '/auth/link',
      'POST',
      { recoveryCode: ana.recoveryCode },
      account.cookie,
    );
    expect(fused.status).toBe(200);
    expect(((await fused.json()) as any).clubs).toHaveLength(2);
    expect(
      (
        (await db
          .prepare('SELECT COUNT(*) count FROM members WHERE user_id=?')
          .bind(account.user.id)
          .first()) as any
      ).count,
    ).toBe(2);
    expect(
      (
        (await db
          .prepare('SELECT COUNT(*) count FROM users WHERE id=?')
          .bind(source.id)
          .first()) as any
      ).count,
    ).toBe(0);
    const migrated = (await db
      .prepare('SELECT COUNT(*) count FROM sessions WHERE user_id=?')
      .bind(account.user.id)
      .first()) as any;
    expect(migrated.count).toBeGreaterThan(0);
    const orphan = (await db
      .prepare('SELECT COUNT(*) count FROM sessions WHERE user_id=?')
      .bind(source.id)
      .first()) as any;
    expect(orphan.count).toBe(0);
    const session = (await (
      await request('/auth/session', 'GET', undefined, ana.cookie)
    ).json()) as any;
    expect(session.user.id).toBe(account.user.id);
  });
  it('refuses fusion on conflicting clubs or identities that already use email', async () => {
    const ana = await createClub('Ana');
    const beto = await createClub('Beto');
    const account = await loginByEmail('conta2@example.com');
    await request('/auth/join', 'POST', { name: 'Conta', token: beto.clubToken }, account.cookie);
    await request('/auth/join', 'POST', { name: 'Ana', token: beto.clubToken }, ana.cookie);
    const conflict = await request(
      '/auth/link',
      'POST',
      { recoveryCode: ana.recoveryCode },
      account.cookie,
    );
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as any).error.code).toBe('MERGE_CONFLICT');
    expect(
      (
        (await db
          .prepare('SELECT COUNT(*) count FROM members WHERE user_id=?')
          .bind(account.user.id)
          .first()) as any
      ).count,
    ).toBe(1);
    const gina = await createClub('Gina');
    await request(
      '/auth/email/start',
      'POST',
      { email: 'gina@example.com', mode: 'attach' },
      gina.cookie,
    );
    const attached = await request(
      '/auth/email/verify',
      'POST',
      { email: 'gina@example.com', code: await outboxCode('gina@example.com'), mode: 'attach' },
      gina.cookie,
    );
    expect(attached.status).toBe(200);
    const refused = await request(
      '/auth/link',
      'POST',
      { recoveryCode: gina.recoveryCode },
      account.cookie,
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as any).error.code).toBe('LINKED');
  });
  it('merges the current guest identity into an existing account when attaching its email', async () => {
    const ana = await createClub('Ana');
    const source = (await db
      .prepare('SELECT id FROM users WHERE recovery_hash=?')
      .bind(digest(ana.recoveryCode))
      .first()) as any;
    const account = await loginByEmail('merge@example.com');
    await db.prepare('DELETE FROM auth_attempts').run();
    const started = await request(
      '/auth/email/start',
      'POST',
      { email: 'merge@example.com', mode: 'attach' },
      ana.cookie,
    );
    expect(started.status).toBe(200);
    const merged = await request(
      '/auth/email/verify',
      'POST',
      {
        email: 'merge@example.com',
        code: await outboxCode('merge@example.com'),
        mode: 'attach',
        merge: true,
      },
      ana.cookie,
    );
    expect(merged.status).toBe(200);
    const data = (await merged.json()) as any;
    expect(data.user.id).toBe(account.user.id);
    expect(data.clubs).toHaveLength(1);
    expect(
      (
        (await db
          .prepare('SELECT COUNT(*) count FROM users WHERE id=?')
          .bind(source.id)
          .first()) as any
      ).count,
    ).toBe(0);
    const session = (await (
      await request('/auth/session', 'GET', undefined, ana.cookie)
    ).json()) as any;
    expect(session.user.id).toBe(account.user.id);
    expect(session.clubs).toHaveLength(1);
  });
});
