import { beforeAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { screenshotEntries } from '@cenora/shared/import';
import { AVATAR_UPLOAD_BYTES } from '@cenora/shared';

const avatarBytes = Buffer.from(
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoCAAIAAUAmJaQAA3AA/v02aAA=',
  'base64',
);
async function uploadAvatar(
  bytes = avatarBytes,
  revision = 0,
  cookie = ownerCookie,
  origin = 'http://localhost',
  contentType = 'image/webp',
) {
  return mf.dispatchFetch('http://localhost/api/auth/profile/avatar', {
    method: 'PUT',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': contentType,
      'If-Match': String(revision),
    },
    body: bytes,
  });
}

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
async function migrate(target: D1Database, before?: string) {
  for (const migration of (await readdir('migrations'))
    .filter((name) => name.endsWith('.sql') && (!before || name < before))
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
      d1Databases: {
        DB: '00000000-0000-0000-0000-000000000001',
        HISTORY: '00000000-0000-0000-0000-000000000002',
      },
      r2Buckets: { AVATARS: 'test-avatars' },
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
describe('private recommendations', () => {
  it('requires a session, validates kind and isolates club, member, shelf and mine', async () => {
    expect((await request('/media/recommendations', 'GET', undefined, '')).status).toBe(401);
    expect((await request('/media/recommendations?kind=other')).status).toBe(400);
    const movie = await manual('movie', 'Filme da fila');
    const show = await manual('tv', 'Série da fila');
    const listId = (await lists())[0].id;
    const animeResponse = await request('/media/manual', 'POST', {
      title: 'Anime da fila',
      kind: 'tv',
      isAnime: true,
      listId,
    });
    expect(animeResponse.status).toBe(201);
    const anime = (await animeResponse.json()) as any;
    expect(
      (
        await request(`/media/${movie.id}/personal`, 'PUT', {
          status: 'watched',
          rating: 9,
          season: null,
          episode: null,
          revision: 0,
        })
      ).status,
    ).toBe(200);
    const result = async (query = '', cookie = ownerCookie) => {
      const response = await request(`/media/recommendations${query}`, 'GET', undefined, cookie);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      return (await response.json()) as any;
    };
    expect(await result()).toMatchObject({ shelf: [], discover: [], catalogAvailable: false });
    const friend = await join('Amiga');
    expect((await result('', friend.cookie)).shelf.map((m: any) => m.id)).toEqual([movie.id]);
    expect((await result('?mine=true', friend.cookie)).shelf).toEqual([]);
    expect((await result('?kind=tv')).shelf.map((m: any) => m.id)).toEqual([show.id]);
    expect((await result('?kind=anime')).shelf.map((m: any) => m.id)).toEqual([anime.id]);
    const outside = await createClub('Outro clube');
    expect((await result('?kind=tv', outside.cookie)).shelf).toEqual([]);
    expect((await result('', outside.cookie)).shelf).toEqual([]);
    expect(
      (await request(`/media/${movie.id}/recommendations`, 'GET', undefined, outside.cookie))
        .status,
    ).toBe(404);
    expect((await request(`/media/${movie.id}/recommendations`, 'GET', undefined, '')).status).toBe(
      401,
    );
    const contextual = await request(`/media/${movie.id}/recommendations`);
    expect(contextual.status).toBe(200);
    expect(contextual.headers.get('cache-control')).toBe('no-store');
    expect(await contextual.json()).toMatchObject({ results: [], available: false });
  });
});
describe('private club ranking', () => {
  const personal = (
    id: string,
    revision: number,
    overrides: Record<string, unknown> = {},
    cookie = ownerCookie,
  ) =>
    request(
      `/media/${id}/personal`,
      'PUT',
      { status: 'watched', rating: null, season: null, episode: null, revision, ...overrides },
      cookie,
    );
  const ranking = async (kind = 'movie', period = 'month', cookie = ownerCookie) => {
    const response = await request(
      `/club/ranking?kind=${kind}&period=${period}`,
      'GET',
      undefined,
      cookie,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as any;
  };
  it('counts personal records, shares tied positions and distinct club titles, and never awards group progress', async () => {
    const friend = await join('Amiga');
    const movie = await manual();
    expect(
      (
        await request(`/media/${movie.id}/group`, 'PUT', {
          status: 'watched',
          season: null,
          episode: null,
          revision: 0,
        })
      ).status,
    ).toBe(200);
    expect((await ranking()).entries.every((e: any) => e.count === 0 && e.position === null)).toBe(
      true,
    );
    expect((await personal(movie.id, 0, { rating: 0.5 })).status).toBe(200);
    expect((await personal(movie.id, 0, { rating: 10 }, friend.cookie)).status).toBe(200);
    const result = await ranking();
    expect(result.clubTitles).toBe(1);
    expect(result.entries).toHaveLength(2);
    expect(
      result.entries.every((e: any) => e.count === 1 && e.position === 1 && e.rated === 1),
    ).toBe(true);
    expect(result.participation.badges).not.toContain('debut');
    expect(result.participation.achievements.find((a: any) => a.badge === 'debut')).toMatchObject({
      count: 1,
      tier: 0,
      nextTarget: 5,
    });
    expect((await personal(movie.id, 0)).status).toBe(409);
    expect((await ranking()).entries.find((e: any) => e.id === ownerId).count).toBe(1);
    expect(
      (await db.prepare('SELECT * FROM ranking_events WHERE member_id=?').bind(ownerId).all())
        .results,
    ).toHaveLength(1);
  });
  it('preserves original registration dates through corrections, retries and concurrent writes', async () => {
    const movie = await manual();
    const concurrent = await Promise.all([personal(movie.id, 0), personal(movie.id, 0)]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
    await db
      .prepare('UPDATE ranking_events SET recorded_at=1 WHERE media_id=?')
      .bind(movie.id)
      .run();
    expect((await ranking()).entries[0].count).toBe(0);
    expect((await ranking('movie', 'all')).entries[0].count).toBe(1);
    expect((await personal(movie.id, 1, { status: 'want' })).status).toBe(200);
    expect((await ranking('movie', 'all')).entries[0].count).toBe(0);
    expect((await personal(movie.id, 2)).status).toBe(200);
    expect((await ranking()).entries[0].count).toBe(0);
    expect((await ranking('movie', 'all')).entries[0].count).toBe(1);
    expect(
      (
        await db
          .prepare('SELECT recorded_at FROM ranking_events WHERE media_id=?')
          .bind(movie.id)
          .first()
      )?.recorded_at,
    ).toBe(1);
  });
  it('counts episode ranges, season completions and anime separately, including corrections across months', async () => {
    const show = await manual('tv', 'Série de teste');
    await db
      .prepare('UPDATE media SET metadata=? WHERE id=?')
      .bind(
        JSON.stringify({
          seasons: [
            { number: 1, name: 'T1', episodes: 3 },
            { number: 2, name: 'T2', episodes: 4 },
          ],
        }),
        show.id,
      )
      .run();
    expect((await personal(show.id, 0, { status: 'watching', season: 1, episode: 3 })).status).toBe(
      200,
    );
    expect((await ranking('tv')).entries[0]).toMatchObject({ count: 3, seasons: 1 });
    expect(
      (await ranking('tv')).participation.achievements.find((a: any) => a.badge === 'credits'),
    ).toMatchObject({ count: 1, tier: 0, nextTarget: 3 });
    await db
      .prepare('UPDATE ranking_events SET recorded_at=1 WHERE media_id=?')
      .bind(show.id)
      .run();
    expect((await personal(show.id, 1, { status: 'watching', season: 2, episode: 2 })).status).toBe(
      200,
    );
    expect((await ranking('tv')).entries[0]).toMatchObject({ count: 2, seasons: 0 });
    expect((await ranking('tv', 'all')).entries[0]).toMatchObject({ count: 5, seasons: 1 });
    expect((await personal(show.id, 2, { status: 'watching', season: 1, episode: 2 })).status).toBe(
      200,
    );
    expect((await ranking('tv')).entries[0]).toMatchObject({ count: 0, seasons: 0 });
    expect((await ranking('tv', 'all')).entries[0]).toMatchObject({ count: 2, seasons: 0 });
    expect((await personal(show.id, 3, { status: 'watched', season: 2, episode: 4 })).status).toBe(
      200,
    );
    expect((await ranking('tv')).entries[0]).toMatchObject({ count: 4, seasons: 1 });
    expect((await ranking('tv', 'all')).entries[0]).toMatchObject({ count: 7, seasons: 2 });
    await db.prepare('UPDATE media SET is_anime=1 WHERE id=?').bind(show.id).run();
    expect((await ranking('tv')).entries[0].count).toBe(0);
    expect((await ranking('anime')).entries[0].count).toBe(4);
    expect((await ranking()).entries[0].count).toBe(0);
  });
  it('supports manual episodes without guessing seasons and does not count imports', async () => {
    const show = await manual('tv', 'Manual');
    expect((await personal(show.id, 0, { status: 'watching', season: 4, episode: 2 })).status).toBe(
      200,
    );
    expect((await ranking('tv')).entries[0]).toMatchObject({ count: 2, seasons: 0 });
    expect((await personal(show.id, 1, { status: 'watching', season: 5, episode: 1 })).status).toBe(
      200,
    );
    expect((await ranking('tv')).entries[0]).toMatchObject({ count: 3, seasons: 0 });
    const imported = await request('/club/import', 'POST', {
      entries: [{ title: 'Importado', kind: 'movie', category: 'Filmes' }],
    });
    expect(imported.status).toBe(200);
    expect((await ranking()).entries[0].count).toBe(0);
  });
  it('keeps preferences and badges scoped to the current profile, and excludes opted-out and removed members', async () => {
    const a = await join('Amiga');
    const b = await join('Outra amiga');
    const movie = await manual();
    await personal(movie.id, 0);
    await personal(movie.id, 0, {}, a.cookie);
    await personal(movie.id, 0, {}, b.cookie);
    for (let i = 0; i < 4; i++) {
      const extra = await manual('movie', `Outra sessão ${i}`);
      await personal(extra.id, 0);
      if (i < 2) {
        await personal(extra.id, 0, {}, a.cookie);
        await personal(extra.id, 0, {}, b.cookie);
      }
    }
    expect((await ranking()).participation.badges).toContain('company');
    expect((await request('/club/ranking/participation', 'PATCH', { badge: 'debut' })).status).toBe(
      200,
    );
    expect((await ranking()).entries.find((e: any) => e.id === ownerId).badge).toBe('debut');
    expect(
      (await request('/club/ranking/participation', 'PATCH', { badge: 'critic' })).status,
    ).toBe(400);
    expect((await ranking()).entries.find((e: any) => e.id === ownerId).badge).toBe('debut');
    expect((await request('/club/ranking/participation', 'PATCH', { enabled: false })).status).toBe(
      200,
    );
    expect((await ranking()).entries).toHaveLength(2);
    expect((await ranking()).participation.enabled).toBe(false);
    expect((await ranking()).participation.badges).toContain('company');
    expect((await request(`/media/${movie.id}`)).status).toBe(200);
    const other = await createClub('Outro');
    expect((await ranking('movie', 'all', other.cookie)).entries).toHaveLength(1);
    expect((await ranking('movie', 'all', other.cookie)).clubTitles).toBe(0);
    await request('/club/ranking/participation', 'PATCH', { enabled: true });
    await request(`/club/members/${b.member.id}`, 'DELETE');
    expect((await ranking()).entries).toHaveLength(2);
    expect((await ranking()).participation.badges).toContain('company');
    expect((await request('/club/ranking', 'GET', undefined, '')).status).toBe(401);
    expect((await request('/club/ranking?kind=invalid')).status).toBe(400);
    expect(
      (
        await request(
          '/club/ranking/participation',
          'PATCH',
          { enabled: false },
          ownerCookie,
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
    expect((await request('/club/ranking/participation', 'PATCH', {})).status).toBe(400);
  });
  it('unlocks the critic badge for watched titles only, irrespective of rating value', async () => {
    for (let i = 0; i < 10; i++) {
      const movie = await manual('movie', `Filme ${i}`);
      await personal(movie.id, 0, {
        status: i === 9 ? 'want' : 'watched',
        rating: i % 2 ? 10 : 0.5,
      });
      if (i === 9) {
        expect((await ranking()).participation.badges).not.toContain('critic');
        await personal(movie.id, 1, { rating: 0.5 });
      }
    }
    expect((await ranking()).participation.badges).toContain('critic');
  });
  it('uses Brasília month boundaries and excludes the next month', async () => {
    const calendar = new Date(Date.now() - 3 * 3600000);
    const start = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), 1, 3) / 1000;
    const end = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, 1, 3) / 1000;
    for (const [i, date] of [start - 1, start, end - 1, end].entries()) {
      const movie = await manual('movie', `Data ${i}`);
      await personal(movie.id, 0);
      await db
        .prepare('UPDATE ranking_events SET recorded_at=? WHERE media_id=?')
        .bind(date, movie.id)
        .run();
    }
    expect((await ranking()).entries[0].count).toBe(2);
    expect((await ranking('movie', 'all')).entries[0].count).toBe(4);
  });
  it('backfills newly discovered catalog seasons without awarding old progress this month', async () => {
    const show = await manual('tv', 'Manual vinculado depois');
    await personal(show.id, 0, { status: 'watching', season: 2, episode: 2 });
    await db
      .prepare('UPDATE ranking_events SET recorded_at=1 WHERE media_id=?')
      .bind(show.id)
      .run();
    await db
      .prepare('UPDATE media SET metadata=? WHERE id=?')
      .bind(
        JSON.stringify({
          seasons: [
            { number: 1, name: 'T1', episodes: 4 },
            { number: 2, name: 'T2', episodes: 5 },
          ],
        }),
        show.id,
      )
      .run();
    expect(
      (await personal(show.id, 1, { status: 'watching', season: 2, episode: 2, rating: 8 })).status,
    ).toBe(200);
    expect((await ranking('tv')).entries[0]).toMatchObject({ count: 0, seasons: 0 });
    expect((await ranking('tv', 'all')).entries[0]).toMatchObject({ count: 6, seasons: 1 });
    await personal(show.id, 2, { status: 'watching', season: 2, episode: 3, rating: 8 });
    expect((await ranking('tv')).entries[0]).toMatchObject({ count: 1, seasons: 0 });
  });
  it('backfills legacy movie and episode checkpoints without inventing activity dates', async () => {
    const history = (await mf.getD1Database('HISTORY')) as unknown as D1Database;
    await migrate(history, '0011');
    await history.batch([
      history.prepare(
        "INSERT INTO clubs(id,name,token_hash,owner_id) VALUES ('c','Clube','token','m')",
      ),
      history.prepare(
        "INSERT INTO members(id,club_id,name,normalized_name,recovery_hash,role) VALUES ('m','c','Ana','ana','hash','owner')",
      ),
      history.prepare(
        "INSERT INTO media(id,club_id,title,normalized_title,kind,created_by) VALUES ('film','c','Filme','filme','movie','m')",
      ),
      history
        .prepare(
          'INSERT INTO media(id,club_id,title,normalized_title,kind,created_by,metadata) VALUES (?,?,?,?,?,?,?)',
        )
        .bind(
          'show',
          'c',
          'Série',
          'serie',
          'tv',
          'm',
          JSON.stringify({
            seasons: [
              { number: 1, name: 'T1', episodes: 3 },
              { number: 2, name: 'T2', episodes: 4 },
            ],
          }),
        ),
      history.prepare(
        "INSERT INTO media(id,club_id,title,normalized_title,kind,created_by) VALUES ('manual','c','Manual','manual','tv','m')",
      ),
      history.prepare(
        "INSERT INTO member_media(member_id,media_id,status) VALUES ('m','film','watched')",
      ),
      history.prepare(
        "INSERT INTO member_media(member_id,media_id,status,season,episode) VALUES ('m','show','watching',2,2),('m','manual','watching',4,3)",
      ),
    ]);
    const statements = (await readFile('migrations/0011_club_ranking.sql', 'utf8'))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    await history.batch(statements.map((s) => history.prepare(s)));
    expect(
      (
        await history
          .prepare("SELECT SUM(current_count) count FROM ranking_units WHERE unit='episode'")
          .first()
      )?.count,
    ).toBe(8);
    expect(
      (
        await history
          .prepare("SELECT SUM(current_count) count FROM ranking_units WHERE unit='season'")
          .first()
      )?.count,
    ).toBe(1);
    expect(
      (
        await history
          .prepare('SELECT COUNT(*) count FROM ranking_events WHERE recorded_at IS NOT NULL')
          .first()
      )?.count,
    ).toBe(0);
    const repair = (await readFile('migrations/0012_recover_current_month_ranking.sql', 'utf8'))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    await history.batch(repair.map((s) => history.prepare(s)));
    expect(
      (
        await history
          .prepare('SELECT COUNT(*) count FROM ranking_events WHERE recorded_at IS NULL')
          .first()
      )?.count,
    ).toBe(0);
    for (let i = 0; i < 4; i++) {
      await history.batch([
        history
          .prepare(
            "INSERT INTO media(id,club_id,title,normalized_title,kind,created_by) VALUES (?,'c',?,?,'movie','m')",
          )
          .bind(`f${i}`, `Filme ${i}`, `filme ${i}`),
        history
          .prepare("INSERT INTO member_media(member_id,media_id,status) VALUES ('m',?,'watched')")
          .bind(`f${i}`),
        history
          .prepare(
            "INSERT INTO ranking_units(member_id,media_id,unit,season,current_count,high_water) VALUES ('m',?,'movie',0,1,1)",
          )
          .bind(`f${i}`),
      ]);
    }
    const levels = (await readFile('migrations/0013_achievement_levels.sql', 'utf8'))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    await history.batch(levels.map((s) => history.prepare(s)));
    expect(
      (
        await history
          .prepare("SELECT badge,tier FROM ranking_achievements WHERE member_id='m'")
          .all()
      ).results,
    ).toEqual([{ badge: 'debut', tier: 1 }]);
    expect(
      (await history.prepare("SELECT ranking_badge FROM members WHERE id='m'").first())
        ?.ranking_badge,
    ).toBe('debut');
  });
  it('repairs undated history only with a proven current Brasília month and never replaces known dates', async () => {
    const movie = await manual();
    await personal(movie.id, 0);
    await db
      .prepare('UPDATE ranking_events SET recorded_at=NULL WHERE media_id=?')
      .bind(movie.id)
      .run();
    const other = await createClub('Clube antigo');
    const own = (await (
      await request('/club/lists', 'GET', undefined, other.cookie)
    ).json()) as any[];
    const old = (await (
      await request(
        '/media/manual',
        'POST',
        { title: 'Registro antigo', kind: 'movie', listId: own[0].id },
        other.cookie,
      )
    ).json()) as any;
    await personal(old.id, 0, {}, other.cookie);
    await db
      .prepare("UPDATE clubs SET created_at=datetime('now','-2 months') WHERE id=?")
      .bind(other.club.id)
      .run();
    await db
      .prepare("UPDATE members SET created_at=datetime('now','-2 months') WHERE club_id=?")
      .bind(other.club.id)
      .run();
    await db
      .prepare("UPDATE media SET created_at=datetime('now','-2 months') WHERE id=?")
      .bind(old.id)
      .run();
    await db
      .prepare('UPDATE ranking_events SET recorded_at=NULL WHERE media_id=?')
      .bind(old.id)
      .run();
    const known = await manual('movie', 'Data conhecida');
    await personal(known.id, 0);
    await db
      .prepare('UPDATE ranking_events SET recorded_at=1 WHERE media_id=?')
      .bind(known.id)
      .run();
    const repair = (await readFile('migrations/0012_recover_current_month_ranking.sql', 'utf8'))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(repair.map((s) => db.prepare(s)));
    expect((await ranking()).entries[0].count).toBe(1);
    expect((await ranking('movie', 'all')).entries[0].count).toBe(2);
    expect((await ranking('movie', 'month', other.cookie)).entries[0].count).toBe(0);
    expect((await ranking('movie', 'all', other.cookie)).entries[0].count).toBe(1);
    expect(
      (
        await db
          .prepare('SELECT recorded_at FROM ranking_events WHERE media_id=?')
          .bind(known.id)
          .first()
      )?.recorded_at,
    ).toBe(1);
    const once = await db
      .prepare('SELECT recorded_at FROM ranking_events WHERE media_id=?')
      .bind(movie.id)
      .first();
    await db.batch(repair.map((s) => db.prepare(s)));
    expect(
      await db
        .prepare('SELECT recorded_at FROM ranking_events WHERE media_id=?')
        .bind(movie.id)
        .first(),
    ).toEqual(once);
  });
  it('awards bronze, silver and gold exactly once, preserves earned milestones and exposes the profile badge', async () => {
    let first = '';
    for (let i = 0; i < 30; i++) {
      const movie = await manual('movie', `Marco ${i}`);
      if (i === 0) first = movie.id;
      const response = await personal(movie.id, 0);
      expect(response.status).toBe(200);
      const result = (await response.json()) as any;
      if ([4, 14, 29].includes(i)) expect(result.newAchievements).toHaveLength(1);
      else expect(result.newAchievements).toEqual([]);
    }
    const result = await ranking();
    expect(result.participation.achievements.find((a: any) => a.badge === 'debut')).toMatchObject({
      count: 30,
      tier: 3,
      nextTarget: null,
    });
    const featured = result.entries[0].featuredBadge;
    expect(featured).toMatchObject({ badge: 'debut', tier: 3 });
    expect(((await (await request('/club/members')).json()) as any[])[0].featuredBadge).toEqual(
      featured,
    );
    await personal(first, 1, { status: 'want' });
    expect(
      (await ranking()).participation.achievements.find((a: any) => a.badge === 'debut'),
    ).toMatchObject({ count: 29, tier: 3 });
    const remarked = await personal(first, 2);
    expect(((await remarked.json()) as any).newAchievements).toEqual([]);
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) count FROM ranking_achievements WHERE member_id=?')
          .bind(ownerId)
          .first()
      )?.count,
    ).toBe(3);
    await request('/club/ranking/participation', 'PATCH', { badge: null });
    const next = await manual('movie', 'Mais uma sessão');
    await personal(next.id, 0);
    expect((await ranking()).entries[0].featuredBadge).toBeNull();
  });
});
describe('private profile avatars on a real Worker + D1 + R2 runtime', () => {
  it('saves presets, preserves them when renaming, and returns them in sessions and rosters', async () => {
    const saved = await request('/auth/profile/avatar', 'PATCH', { preset: 'gato', revision: 0 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      id: ownerId,
      avatarUrl: '/avatars/gato.svg',
      avatarRevision: 1,
    });
    const renamed = await request('/auth/profile', 'PATCH', { name: 'Novo nome' });
    expect(await renamed.json()).toMatchObject({
      name: 'Novo nome',
      avatarUrl: '/avatars/gato.svg',
      avatarRevision: 1,
    });
    expect(await (await request('/auth/session')).json()).toMatchObject({
      member: { avatarUrl: '/avatars/gato.svg', avatarRevision: 1 },
    });
    const roster = (await (await request('/club/members')).json()) as any[];
    expect(roster.find((member) => member.id === ownerId)).toMatchObject({
      avatarUrl: '/avatars/gato.svg',
      avatarRevision: 1,
    });
    expect(roster[0]).not.toHaveProperty('avatar');
    expect((await mf.getR2Bucket('AVATARS').then((b) => b.list())).objects).toHaveLength(0);
  });
  it('stores normalized pictures privately and serves them only to the active club', async () => {
    const saved = await uploadAvatar();
    expect(saved.status).toBe(200);
    const profile = (await saved.json()) as any;
    expect(profile.avatarUrl).toBe(`/api/club/members/${ownerId}/avatar?v=1`);
    const path = profile.avatarUrl.replace('/api', '');
    const photo = await request(path);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('Content-Type')).toBe('image/webp');
    expect(photo.headers.get('Cache-Control')).toBe('no-store');
    expect(photo.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(Buffer.from(await photo.arrayBuffer())).toEqual(avatarBytes);
    const friend = await join('Amiga');
    expect((await request(path, 'GET', undefined, friend.cookie)).status).toBe(200);
    expect((await request(path, 'GET', undefined, '')).status).toBe(401);
    const other = await createClub('Outro clube');
    expect((await request(path, 'GET', undefined, other.cookie)).status).toBe(404);
    const removed = await request(`/club/members/${friend.member.id}`, 'DELETE');
    expect(removed.status).toBe(200);
    expect((await request(path, 'GET', undefined, friend.cookie)).status).toBe(401);
  });
  it('cleans replaced uploads, rejects stale revisions, and returns to the initial', async () => {
    expect((await uploadAvatar()).status).toBe(200);
    const bucket = await mf.getR2Bucket('AVATARS');
    const firstKey = (await bucket.list()).objects[0].key;
    const replacement = await uploadAvatar(avatarBytes, 1);
    expect(replacement.status).toBe(200);
    await expect.poll(() => bucket.get(firstKey)).toBeNull();
    expect((await bucket.list()).objects).toHaveLength(1);
    const stale = await uploadAvatar(avatarBytes, 1);
    expect(stale.status).toBe(409);
    await expect.poll(async () => (await bucket.list()).objects).toHaveLength(1);
    const preset = await request('/auth/profile/avatar', 'PATCH', { preset: 'robo', revision: 2 });
    expect(preset.status).toBe(200);
    await expect.poll(async () => (await bucket.list()).objects).toHaveLength(0);
    expect(
      (await request('/auth/profile/avatar', 'PATCH', { preset: null, revision: 2 })).status,
    ).toBe(409);
    const reset = await request('/auth/profile/avatar', 'PATCH', { preset: null, revision: 3 });
    expect(await reset.json()).toMatchObject({ avatarUrl: null, avatarRevision: 4 });
  });
  it('allows members to change only their own picture, including scoped re-access', async () => {
    const friend = await join('Ana');
    const saved = await request(
      '/auth/profile/avatar',
      'PATCH',
      { preset: 'alien', revision: 0, memberId: ownerId },
      friend.cookie,
    );
    expect(await saved.json()).toMatchObject({
      id: friend.member.id,
      avatarUrl: '/avatars/alien.svg',
    });
    expect(await (await request('/auth/session')).json()).toMatchObject({
      member: { avatarUrl: null },
    });
    const claim = (await (
      await request(`/club/members/${friend.member.id}/claim`, 'POST')
    ).json()) as any;
    const recovered = await request('/auth/claim', 'POST', { code: claim.claimCode }, '');
    expect(recovered.status).toBe(200);
    const scopedCookie = recovered.headers.get('set-cookie')!.split(';')[0];
    expect((await uploadAvatar(avatarBytes, 1, scopedCookie)).status).toBe(200);
  });
  it('rejects unknown presets, invalid bytes, animation, oversized dimensions and bodies', async () => {
    expect(
      (await request('/auth/profile/avatar', 'PATCH', { preset: '../../other', revision: 0 }))
        .status,
    ).toBe(400);
    expect((await uploadAvatar(Buffer.from('<svg onload="alert(1)"/>'))).status).toBe(400);
    expect(
      (await uploadAvatar(avatarBytes, 0, ownerCookie, 'http://localhost', 'image/png')).status,
    ).toBe(415);
    const large = Buffer.from(avatarBytes);
    large.writeUInt16LE(513, 26);
    large.writeUInt16LE(513, 28);
    expect((await uploadAvatar(large)).status).toBe(400);
    const animated = Buffer.from(avatarBytes);
    animated.write('ANIM', 12);
    expect((await uploadAvatar(animated)).status).toBe(400);
    expect((await uploadAvatar(Buffer.alloc(AVATAR_UPLOAD_BYTES + 1))).status).toBe(413);
    expect((await request('/club/lists', 'POST', { name: 'x'.repeat(128 * 1024) })).status).toBe(
      413,
    );
    expect((await mf.getR2Bucket('AVATARS').then((b) => b.list())).objects).toHaveLength(0);
  });
  it('lets only one concurrent upload win without leaving orphan objects', async () => {
    const results = await Promise.all([uploadAvatar(), uploadAvatar()]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    const bucket = await mf.getR2Bucket('AVATARS');
    await expect.poll(async () => (await bucket.list()).objects).toHaveLength(1);
    expect(await (await request('/auth/session')).json()).toMatchObject({
      member: { avatarRevision: 1 },
    });
  });
  it('requires authentication, same-origin mutations and rate-limits changes', async () => {
    expect((await uploadAvatar(avatarBytes, 0, '')).status).toBe(401);
    expect(
      (await uploadAvatar(avatarBytes, 0, ownerCookie, 'https://untrusted.example')).status,
    ).toBe(403);
    for (let revision = 0; revision < 30; revision++) {
      expect(
        (await request('/auth/profile/avatar', 'PATCH', { preset: 'gato', revision })).status,
      ).toBe(200);
    }
    expect(
      (await request('/auth/profile/avatar', 'PATCH', { preset: 'gato', revision: 30 })).status,
    ).toBe(429);
  });
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
  it('shares a club through a revocable invite link with an optional password', async () => {
    expect(await (await request('/club/invite')).json()).toEqual({ invite: null });
    // Sem convite, o clube segue privado.
    expect((await request('/auth/invite/nao-existe-123456', 'GET', undefined, '')).status).toBe(
      404,
    );
    const created = (await (await request('/club/invite', 'POST')).json()) as any;
    const inviteToken = created.invite.token;
    expect(inviteToken).toMatch(/^[a-f0-9]{48}$/);
    expect(created.invite.passwordProtected).toBe(false);
    const meta = (await (
      await request('/auth/invite/' + inviteToken, 'GET', undefined, '')
    ).json()) as any;
    expect(meta.clubName).toBeTruthy();
    expect(meta.passwordRequired).toBe(false);
    // Sem sessão, o link cria uma identidade e devolve o código de recuperação.
    const joined = await request('/auth/invite', 'POST', { name: 'Lia', token: inviteToken }, '');
    expect(joined.status).toBe(201);
    const joinedData = (await joined.json()) as any;
    expect(joinedData.member.name).toBe('Lia');
    expect(joinedData.recoveryCode).toBeTruthy();
    // Uma senha passa a ser exigida.
    expect((await request('/club/invite', 'PATCH', { password: 'segredo' })).status).toBe(200);
    expect(
      ((await (await request('/auth/invite/' + inviteToken, 'GET', undefined, '')).json()) as any)
        .passwordRequired,
    ).toBe(true);
    expect(
      (await request('/auth/invite', 'POST', { name: 'Sem senha', token: inviteToken }, '')).status,
    ).toBe(401);
    expect(
      (
        await request(
          '/auth/invite',
          'POST',
          { name: 'Senha errada', token: inviteToken, password: 'errada' },
          '',
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          '/auth/invite',
          'POST',
          { name: 'Com senha', token: inviteToken, password: 'segredo' },
          '',
        )
      ).status,
    ).toBe(201);
    // Girar o link derruba o antigo, mas a senha sobrevive.
    const rotated = (await (await request('/club/invite', 'POST')).json()) as any;
    expect(rotated.invite.token).not.toBe(inviteToken);
    expect(rotated.invite.passwordProtected).toBe(true);
    expect((await request('/auth/invite/' + inviteToken, 'GET', undefined, '')).status).toBe(404);
    expect(
      (
        await request(
          '/auth/invite',
          'POST',
          { name: 'De volta', token: rotated.invite.token, password: 'segredo' },
          '',
        )
      ).status,
    ).toBe(201);
    // Revogar devolve o clube ao estado privado.
    expect((await request('/club/invite', 'DELETE')).status).toBe(200);
    expect(
      (await request('/auth/invite/' + rotated.invite.token, 'GET', undefined, '')).status,
    ).toBe(404);
    expect((await (await request('/club/invite')).json()) as any).toEqual({ invite: null });
    // Só o dono administra o convite.
    const outsider = await join('Fora');
    expect((await request('/club/invite', 'GET', undefined, outsider.cookie)).status).toBe(403);
    expect((await request('/club/invite', 'POST', undefined, outsider.cookie)).status).toBe(403);
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
      for (const name of (await readdir('migrations'))
        .filter((name) => name.endsWith('.sql') && name > '0006_member_claims.sql')
        .sort()) {
        const statements = (await readFile(`migrations/${name}`, 'utf8'))
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean);
        await previous.batch(statements.map((s) => previous.prepare(s)));
      }
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
    expect(await (await request('/media/counts')).json()).toEqual({ movie: 1, tv: 1, anime: 0 });
    const other = await createClub('Outro');
    expect(await (await request('/media/counts', 'GET', undefined, other.cookie)).json()).toEqual({
      movie: 0,
      tv: 0,
      anime: 0,
    });
  });
  it('separates anime series while keeping anime movies in Filmes and preserving episode tracking', async () => {
    const listId = (await lists())[0].id;
    const add = async (title: string, kind: string, isAnime: boolean) => {
      const response = await request('/media/manual', 'POST', { title, kind, isAnime, listId });
      expect(response.status).toBe(201);
      return (await response.json()) as any;
    };
    const anime = await add('Fullmetal', 'tv', true);
    const movie = await add('Princesa Mononoke', 'movie', true);
    await add('Dark', 'tv', false);
    expect(anime.isAnime).toBe(true);
    expect(movie.isAnime).toBe(false);
    expect(await (await request('/media/counts')).json()).toEqual({ movie: 1, tv: 1, anime: 1 });
    for (const [kind, title] of [
      ['anime', 'Fullmetal'],
      ['movie', 'Princesa Mononoke'],
      ['tv', 'Dark'],
    ]) {
      const shelf = (await (await request(`/media?kind=${kind}`)).json()) as any;
      expect(shelf.items.map((item: any) => item.title)).toEqual([title]);
      const spin = (await (await request(`/media/spin?kind=${kind}`)).json()) as any;
      expect(spin.items.map((item: any) => item.title)).toEqual([title]);
    }
    expect(
      (
        await request(`/media/${anime.id}/personal`, 'PUT', {
          status: 'watching',
          rating: null,
          season: 1,
          episode: 3,
          revision: 0,
        })
      ).status,
    ).toBe(200);
    const mine = (await (
      await request('/media?kind=anime&mine=true&status=watching')
    ).json()) as any;
    expect(mine.items[0]).toMatchObject({
      kind: 'tv',
      isAnime: true,
      personal: { season: 1, episode: 3 },
    });
    const other = await createClub('Outro clube');
    const outside = (await (
      await request('/media?kind=anime', 'GET', undefined, other.cookie)
    ).json()) as any;
    expect(outside.items).toEqual([]);
    expect((await add('Fullmetal', 'tv', false)).id).toBe(anime.id);
    expect(await (await request('/media/counts')).json()).toEqual({ movie: 1, tv: 1, anime: 1 });
  });
  it('classifies catalog anime series, never anime films, and backfills existing imported anime', async () => {
    const listId = (await lists())[0].id;
    for (const kind of ['tv', 'movie']) {
      await db
        .prepare('INSERT INTO provider_cache (key,payload,expires_at) VALUES (?,?,?)')
        .bind(
          `details:${kind}:123`,
          JSON.stringify({
            name: 'Anime do catálogo',
            title: 'Filme de anime',
            genres: [{ id: 16, name: 'Animação' }],
            origin_country: ['JP'],
            credits: { cast: [] },
          }),
          Date.now() + 86400000,
        )
        .run();
      const response = await request('/media/catalog', 'POST', { tmdbId: 123, kind, listId });
      expect(response.status).toBe(201);
      expect((await response.json()) as any).toMatchObject({ isAnime: kind === 'tv' });
    }
    const imported = await request('/club/import', 'POST', {
      entries: [
        { title: 'Anime antigo', kind: 'tv', category: 'Animes' },
        { title: 'Filme antigo', kind: 'movie', category: 'Animes' },
      ],
    });
    expect(imported.status).toBe(200);
    await db.prepare('UPDATE media SET is_anime=0').run();
    const backfill = (await readFile('migrations/0010_anime_shelf.sql', 'utf8'))
      .split(';')
      .slice(1)
      .map((statement) => statement.trim())
      .filter(Boolean);
    await db.batch(backfill.map((statement) => db.prepare(statement)));
    expect(await (await request('/media/counts')).json()).toEqual({ movie: 2, tv: 0, anime: 2 });
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
  it('removes movies and shows with their ratings, list items, and import aliases', async () => {
    for (const kind of ['movie', 'tv']) {
      const title = await manual(kind);
      const ana = await join(`Ana ${kind}`);
      expect(
        (
          await request(
            `/media/${title.id}/personal`,
            'PUT',
            {
              status: 'watched',
              rating: 9,
              season: null,
              episode: null,
              revision: 0,
            },
            ana.cookie,
          )
        ).status,
      ).toBe(200);
      await db
        .prepare(
          'INSERT INTO import_aliases (club_id,source_key,variant_key,media_id) VALUES (?,?,?,?)',
        )
        .bind(
          ((await (await request('/auth/session')).json()) as any).club.id,
          kind,
          'original',
          title.id,
        )
        .run();

      expect((await request(`/media/${title.id}`, 'DELETE', { revision: 0 })).status).toBe(200);
      expect((await request(`/media/${title.id}`)).status).toBe(404);
      for (const table of ['member_media', 'list_items', 'import_aliases']) {
        expect(
          await db
            .prepare(`SELECT COUNT(*) count FROM ${table} WHERE media_id=?`)
            .bind(title.id)
            .first('count'),
        ).toBe(0);
      }
    }
    expect(await (await request('/media/counts')).json()).toEqual({ movie: 0, tv: 0, anime: 0 });
  });
  it('restricts title removal to the club owner and the active club', async () => {
    const title = await manual();
    const ana = await join('Ana');
    const other = await createClub('Outro dono');
    expect(
      (await request(`/media/${title.id}`, 'DELETE', { revision: 0 }, ana.cookie)).status,
    ).toBe(403);
    expect(
      (await request(`/media/${title.id}`, 'DELETE', { revision: 0 }, other.cookie)).status,
    ).toBe(404);
    expect((await request(`/media/${title.id}`, 'DELETE', { revision: 0 }, '')).status).toBe(401);
    expect(
      (
        await request(
          `/media/${title.id}`,
          'DELETE',
          { revision: 0 },
          ownerCookie,
          'https://other.example',
        )
      ).status,
    ).toBe(403);
    expect((await request(`/media/${title.id}`)).status).toBe(200);
  });
  it('requires a current revision before removing a title', async () => {
    const title = await manual();
    expect((await request(`/media/${title.id}`, 'DELETE', {})).status).toBe(400);
    expect(
      (
        await request(`/media/${title.id}/group`, 'PUT', {
          status: 'watched',
          season: null,
          episode: null,
          revision: 0,
        })
      ).status,
    ).toBe(200);
    expect((await request(`/media/${title.id}`, 'DELETE', { revision: 0 })).status).toBe(409);
    expect((await request(`/media/${title.id}`)).status).toBe(200);
    expect((await request(`/media/${title.id}`, 'DELETE', { revision: 1 })).status).toBe(200);
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
    expect(await (await request('/media/counts')).json()).toEqual({ movie: 29, tv: 8, anime: 3 });
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
  it('keeps profile and guest sessions alive without a hard cap', async () => {
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
    // Identidade de convidado (sem e-mail) também não expira por teto.
    const guestToken = ownerCookie.split('=')[1];
    await db
      .prepare('UPDATE sessions SET created_at=?, expires_at=? WHERE token_hash=?')
      .bind(now - 400 * 86400, now + 86400, digest(guestToken))
      .run();
    const guest = await request('/club/lists');
    expect(guest.status).toBe(200);
    expect(guest.headers.get('set-cookie')).toBeTruthy();
    const guestRow = (await db
      .prepare('SELECT expires_at FROM sessions WHERE token_hash=?')
      .bind(digest(guestToken))
      .first()) as any;
    expect(guestRow.expires_at).toBeGreaterThan(now + 20 * 86400);
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
    // Anexar o e-mail reinicia o relógio do teto de 12 meses.
    const attached = (await db
      .prepare('SELECT created_at,scope_member_id FROM sessions WHERE member_id=?')
      .bind(ana.member.id)
      .first()) as any;
    expect(attached.created_at).toBeGreaterThan(Math.floor(Date.now() / 1000) - 60);
    expect(attached.scope_member_id).toBeNull();
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
  it('keeps promoted legacy profile sessions scoped to their original club', async () => {
    const ana = await createClub('Ana');
    const other = (await (
      await request('/auth/create', 'POST', { name: 'Outro clube' }, ana.cookie)
    ).json()) as any;
    await request('/auth/club', 'POST', { memberId: ana.member.id }, ana.cookie);
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
    expect(after.scoped).toBe(true);
    expect(after.clubs[0].memberId).toBe(ana.member.id);
    expect(
      (await request('/auth/club', 'POST', { memberId: other.member.id }, ana.cookie)).status,
    ).toBe(403);
    expect((await request('/auth/recovery-code', 'POST', undefined, ana.cookie)).status).toBe(403);
    const row = (await db
      .prepare('SELECT user_id,scope_member_id FROM sessions WHERE member_id=?')
      .bind(ana.member.id)
      .first()) as any;
    expect(row.user_id).toBe(identity.id);
    expect(row.scope_member_id).toBe(ana.member.id);
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
  it('lists active participants to every member and exposes account state only to the owner', async () => {
    const owner = await createClub('Chefe');
    const friend = await request(
      '/auth/join',
      'POST',
      { name: 'Amigo', token: owner.clubToken },
      '',
    );
    const friendCookie = friend.headers.get('set-cookie')!.split(';')[0];
    const asOwner = (await (
      await request('/club/members', 'GET', undefined, owner.cookie)
    ).json()) as any[];
    expect(asOwner.map((row) => row.name).sort()).toEqual(['Amigo', 'Chefe']);
    expect(asOwner.every((row) => 'linked' in row)).toBe(true);
    const asFriend = await request('/club/members', 'GET', undefined, friendCookie);
    expect(asFriend.status).toBe(200);
    const rows = (await asFriend.json()) as any[];
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => 'linked' in row)).toBe(false);
  });
  it('lets a signed-in account claim a profile without identity', async () => {
    const owner = await createClub('Dona');
    const guest = await request(
      '/auth/join',
      'POST',
      { name: 'Visitante', token: owner.clubToken },
      '',
    );
    expect(guest.status).toBe(201);
    const guestId = ((await guest.json()) as any).member.id;
    const issue = () =>
      request('/club/members/' + guestId + '/claim', 'POST', undefined, owner.cookie).then(
        async (r) => ((await r.json()) as any).claimCode as string,
      );
    const account = await loginByEmail('visitante.claim@example.com');
    const claimed = await request('/auth/claim', 'POST', { code: await issue() }, account.cookie);
    expect(claimed.status).toBe(200);
    const data = (await claimed.json()) as any;
    expect(data.scoped).toBe(false);
    expect(data.member.id).toBe(guestId);
    const session = (await (
      await request('/auth/session', 'GET', undefined, account.cookie)
    ).json()) as any;
    expect(session.member.id).toBe(guestId);
    expect(session.clubs.map((option: any) => option.memberId)).toContain(guestId);
    // A mesma conta não pode ter dois perfis ativos no clube.
    const second = await request(
      '/auth/join',
      'POST',
      { name: 'Outro', token: owner.clubToken },
      '',
    );
    const secondId = ((await second.json()) as any).member.id;
    const again = await request(
      '/club/members/' + secondId + '/claim',
      'POST',
      undefined,
      owner.cookie,
    );
    const conflict = await request(
      '/auth/claim',
      'POST',
      { code: ((await again.json()) as any).claimCode },
      account.cookie,
    );
    expect(conflict.status).toBe(409);
  });
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
    expect((await request('/auth/create', 'POST', { name: 'Novo clube' }, cookie)).status).toBe(
      403,
    );
    expect(
      (await request('/auth/join', 'POST', { name: 'Ana', token: ana.clubToken }, cookie)).status,
    ).toBe(403);
    expect(
      (await request('/auth/link', 'POST', { recoveryCode: ana.recoveryCode }, cookie)).status,
    ).toBe(403);
    const refusedStart = await request(
      '/auth/email/start',
      'POST',
      { email: 'ana.claim@example.com', mode: 'attach' },
      cookie,
    );
    expect(refusedStart.status).toBe(403);
    expect(((await refusedStart.json()) as any).error.code).toBe('SCOPED');
    // Mesmo um código válido de um e-mail controlado pelo dono não prova a identidade da Ana.
    await request('/auth/email/start', 'POST', { email: 'ana.claim@example.com' }, '');
    const refusedVerify = await request(
      '/auth/email/verify',
      'POST',
      {
        email: 'ana.claim@example.com',
        code: await outboxCode('ana.claim@example.com'),
        mode: 'attach',
      },
      cookie,
    );
    expect(refusedVerify.status).toBe(403);
    expect(((await refusedVerify.json()) as any).error.code).toBe('SCOPED');
    const stillScoped = (await (
      await request('/auth/session', 'GET', undefined, cookie)
    ).json()) as any;
    expect(stillScoped.scoped).toBe(true);
    expect(stillScoped.user.email).toBeNull();
    expect(stillScoped.clubs.map((option: any) => option.memberId)).toEqual([anaInBeto]);
    const recovered = await request(
      '/auth/recover',
      'POST',
      { token: ana.clubToken, recoveryCode: ana.recoveryCode },
      '',
    );
    const recoveryCookie = recovered.headers.get('set-cookie')!.split(';')[0];
    const unlocked = (await (
      await request('/auth/session', 'GET', undefined, recoveryCookie)
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
  it('keeps linked legacy credentials scoped and revokes them on identity recovery rotation', async () => {
    const clubId = (
      (await db.prepare('SELECT id FROM clubs ORDER BY rowid LIMIT 1').first()) as any
    ).id;
    const account = await loginByEmail('lia@example.com');
    const own = (await (
      await request('/auth/create', 'POST', { name: 'Lia' }, account.cookie)
    ).json()) as any;
    const legacyId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO members (id,club_id,name,normalized_name,recovery_hash,role) VALUES (?,?,?,?,?,'member')",
      )
      .bind(legacyId, clubId, 'Lia antiga', 'lia antiga', digest('codigo-da-lia-123456'))
      .run();
    const recoverLegacy = () =>
      request(
        '/auth/recover',
        'POST',
        { name: 'Lia antiga', token: clubToken, recoveryCode: 'codigo-da-lia-123456' },
        '',
      );
    const oldSession = await recoverLegacy();
    const oldCookie = oldSession.headers.get('set-cookie')!.split(';')[0];
    const unpromotedSession = await recoverLegacy();
    const unpromotedCookie = unpromotedSession.headers.get('set-cookie')!.split(';')[0];
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
    expect(session.clubs).toHaveLength(2);
    expect(session.scoped).toBe(false);
    const recovered = await recoverLegacy();
    expect(recovered.status).toBe(200);
    const recoveredData = (await recovered.json()) as any;
    expect(recoveredData.user.id).toBe(account.user.id);
    expect(recoveredData.scoped).toBe(true);
    const recoveredCookie = recovered.headers.get('set-cookie')!.split(';')[0];
    for (const cookie of [oldCookie, recoveredCookie]) {
      const scoped = (await (
        await request('/auth/session', 'GET', undefined, cookie)
      ).json()) as any;
      expect(scoped.scoped).toBe(true);
      expect(scoped.clubs.map((option: any) => option.memberId)).toEqual([legacyId]);
      expect(
        (await request('/auth/club', 'POST', { memberId: own.member.id }, cookie)).status,
      ).toBe(403);
      expect((await request('/auth/recovery-code', 'POST', undefined, cookie)).status).toBe(403);
      expect((await request('/club/lists', 'GET', undefined, cookie)).status).toBe(200);
    }
    const rotated = await request('/auth/recovery-code', 'POST', undefined, account.cookie);
    expect(rotated.status).toBe(200);
    expect((await recoverLegacy()).status).toBe(401);
    for (const cookie of [oldCookie, unpromotedCookie, recoveredCookie])
      expect((await request('/club/lists', 'GET', undefined, cookie)).status).toBe(401);
    expect((await request('/club/lists', 'GET', undefined, account.cookie)).status).toBe(200);
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
    // Ana tem identidade sem e-mail: ela só seria fundida sem conflito de clubes.
    expect(((await linkedElsewhere.json()) as any).error.code).toBe('MERGE_CONFLICT');
  });
  it('links a profile by its code alone', async () => {
    const owner = await createClub('Dona do código');
    const guest = await request('/auth/join', 'POST', { name: 'Solo', token: owner.clubToken }, '');
    const guestData = (await guest.json()) as any;
    const account = await loginByEmail('solo.code@example.com');
    const linked = await request(
      '/auth/link',
      'POST',
      { recoveryCode: guestData.recoveryCode },
      account.cookie,
    );
    expect(linked.status).toBe(200);
    const session = (await (
      await request('/auth/session', 'GET', undefined, account.cookie)
    ).json()) as any;
    expect(session.clubs.map((option: any) => option.memberId)).toContain(guestData.member.id);
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
  it.each(['source', 'target'])(
    'merges after the owner removes the %s conflicting profile',
    async (removed) => {
      const guest = await createClub('Convidado');
      const account = await loginByEmail('removed-conflict@example.com');
      const own = (await (
        await request('/auth/create', 'POST', { name: 'Conta' }, account.cookie)
      ).json()) as any;
      const guestJoined = (await (
        await request('/auth/join', 'POST', { name: 'Convidado', token: clubToken }, guest.cookie)
      ).json()) as any;
      const accountJoined = (await (
        await request('/auth/join', 'POST', { name: 'Conta', token: clubToken }, account.cookie)
      ).json()) as any;
      await request('/auth/club', 'POST', { memberId: own.member.id }, account.cookie);
      await request('/auth/club', 'POST', { memberId: guest.member.id }, guest.cookie);
      const payload = { recoveryCode: guest.recoveryCode };
      expect((await request('/auth/link', 'POST', payload, account.cookie)).status).toBe(409);
      const removedId = removed === 'source' ? guestJoined.member.id : accountJoined.member.id;
      const retainedId = removed === 'source' ? accountJoined.member.id : guestJoined.member.id;
      expect((await request('/club/members/' + removedId, 'DELETE')).status).toBe(200);
      const merged = await request('/auth/link', 'POST', payload, account.cookie);
      expect(merged.status).toBe(200);
      const data = (await merged.json()) as any;
      expect(data.clubs).toHaveLength(3);
      expect(data.clubs.some((option: any) => option.memberId === retainedId)).toBe(true);
      expect(data.clubs.some((option: any) => option.memberId === removedId)).toBe(false);
      const archived = (await db
        .prepare('SELECT active,user_id FROM members WHERE id=?')
        .bind(removedId)
        .first()) as any;
      expect(archived).toEqual({ active: 0, user_id: account.user.id });
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    },
  );
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
    const code = await outboxCode('merge@example.com');
    const taken = await request(
      '/auth/email/verify',
      'POST',
      { email: 'merge@example.com', code, mode: 'attach' },
      ana.cookie,
    );
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as any).error.code).toBe('EMAIL_TAKEN');
    const merged = await request(
      '/auth/email/verify',
      'POST',
      { email: 'merge@example.com', code, mode: 'attach', merge: true },
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
