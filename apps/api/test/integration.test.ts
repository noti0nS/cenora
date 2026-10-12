import { beforeAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  for (const migration of (await readdir('migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const statements = (await readFile(`migrations/${migration}`, 'utf8'))
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  }
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
    } finally {
      await legacy.dispose();
    }
  });
  it('restores the same profile using a personal recovery code, never a name alone', async () => {
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
    const row = (await db
      .prepare('SELECT recovery_hash FROM members WHERE id=?')
      .bind(ana.member.id)
      .first()) as any;
    expect(row.recovery_hash).toBe(digest(ana.recoveryCode));
    expect(row.recovery_hash).not.toBe(ana.recoveryCode);
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
