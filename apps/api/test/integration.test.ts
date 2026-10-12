import { beforeAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { screenshotEntries } from '@watchlist/shared/import';

let mf: Miniflare, db: D1Database, ownerCookie: string, clubToken: string, ownerId: string;
let ip = 1;
const setupCode = 'integration-owner-setup-code-123456789';
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
    await db.exec(await readFile(`migrations/${migration}`, 'utf8'));
  }
  await db.prepare('INSERT INTO club (id,setup_hash) VALUES (1,?)').bind(digest(setupCode)).run();
  const res = await request('/auth/setup', 'POST', { name: 'Dono', setupCode }, '');
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
  it('creates default lists and consumes setup exactly once', async () => {
    expect((await lists()).map((l) => l.name)).toEqual(['Filmes', 'Animes', 'Séries']);
    expect((await request('/auth/setup', 'POST', { name: 'Outro', setupCode }, '')).status).toBe(
      401,
    );
    expect(((await db.prepare('SELECT COUNT(*) count FROM members').first()) as any).count).toBe(1);
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
    expect((await request('/club/import-preset', 'GET', undefined, friend.cookie)).status).toBe(
      403,
    );
    expect((await request('/club/import-preset', 'GET', undefined, '')).status).toBe(401);
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
