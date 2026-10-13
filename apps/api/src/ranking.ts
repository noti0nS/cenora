import { Hono } from 'hono';
import { z } from 'zod';
import {
  type ClubRanking,
  type RankingBadge,
  type RankingEntry,
  type Season,
  type Personal,
} from '@cenora/shared';
import { ApiError, avatarFields, body, type AppEnv } from './lib';

type Unit = { unit: 'movie' | 'episode' | 'season'; season: number; count: number };
export function progressUnits(
  kind: 'movie' | 'tv',
  personal: Pick<Personal, 'status' | 'season' | 'episode'>,
  seasons: Season[],
  previous: Unit[] = [],
): Unit[] {
  if (kind === 'movie')
    return [{ unit: 'movie', season: 0, count: personal.status === 'watched' ? 1 : 0 }];
  if (!personal.season || !personal.episode) return [];
  const units: Unit[] = [];
  for (const s of seasons) {
    if (s.number > personal.season) continue;
    const count = s.number < personal.season ? s.episodes : Math.min(personal.episode, s.episodes);
    units.push({ unit: 'episode', season: s.number, count });
    units.push({ unit: 'season', season: s.number, count: count >= s.episodes ? 1 : 0 });
  }
  // Manual titles still count known episodes, never invented earlier seasons.
  if (!seasons.some((s) => s.number === personal.season)) {
    units.push({ unit: 'episode', season: personal.season, count: personal.episode });
  }
  for (const old of previous) {
    if (
      old.season < personal.season &&
      !units.some((u) => u.unit === old.unit && u.season === old.season)
    )
      units.push(old);
  }
  return units;
}

export function metadataSeasons(metadata: string | null): Season[] {
  try {
    const value = JSON.parse(metadata || '{}');
    return z
      .array(
        z.object({
          number: z.number().int().min(1).max(999),
          name: z.string(),
          episodes: z.number().int().min(1).max(9999),
        }),
      )
      .parse(value.seasons ?? []);
  } catch {
    return [];
  }
}

/** All statements are guarded by a unique successful tracking-write token, not just a revision. */
export function recordProgress(
  db: D1Database,
  memberId: string,
  mediaId: string,
  write: string,
  units: Unit[],
  recordedAt: number | null = Math.floor(Date.now() / 1000),
) {
  const guard =
    'EXISTS(SELECT 1 FROM member_media WHERE member_id=? AND media_id=? AND ranking_write=?)';
  const data = JSON.stringify(units);
  return [
    db
      .prepare(
        `UPDATE ranking_units SET current_count=0 WHERE member_id=? AND media_id=? AND ${guard}`,
      )
      .bind(memberId, mediaId, memberId, mediaId, write),
    db
      .prepare(
        `INSERT INTO ranking_units(member_id,media_id,unit,season,current_count,high_water)
      SELECT ?,?,json_extract(value,'$.unit'),json_extract(value,'$.season'),0,0 FROM json_each(?)
      WHERE ${guard} ON CONFLICT DO NOTHING`,
      )
      .bind(memberId, mediaId, data, memberId, mediaId, write),
    db
      .prepare(
        `INSERT INTO ranking_events(member_id,media_id,unit,season,first_unit,last_unit,recorded_at)
      SELECT u.member_id,u.media_id,u.unit,u.season,u.high_water+1,json_extract(j.value,'$.count'),?
      FROM ranking_units u JOIN json_each(?) j ON u.unit=json_extract(j.value,'$.unit') AND u.season=json_extract(j.value,'$.season')
      WHERE u.member_id=? AND u.media_id=? AND u.high_water<json_extract(j.value,'$.count') AND ${guard}`,
      )
      .bind(recordedAt, data, memberId, mediaId, memberId, mediaId, write),
    db
      .prepare(
        `UPDATE ranking_units SET current_count=json_extract(j.value,'$.count'),high_water=MAX(high_water,json_extract(j.value,'$.count'))
      FROM json_each(?) j WHERE member_id=? AND media_id=? AND unit=json_extract(j.value,'$.unit') AND season=json_extract(j.value,'$.season') AND ${guard}`,
      )
      .bind(data, memberId, mediaId, memberId, mediaId, write),
  ];
}

type RosterRow = {
  id: string;
  name: string;
  role: 'owner' | 'member';
  avatar: string | null;
  avatar_revision: number;
  ranking_enabled: number;
  ranking_badge: RankingBadge | null;
};
type ProgressRow = {
  member_id: string;
  media_id: string;
  unit: string;
  total: number;
  monthly: number;
  rated: number;
};
export const rankingRoutes = new Hono<AppEnv>();

rankingRoutes.get('/', async (c) => {
  const input = z
    .object({
      kind: z.enum(['movie', 'tv', 'anime']).default('movie'),
      period: z.enum(['month', 'all']).default('month'),
    })
    .safeParse(c.req.query());
  if (!input.success)
    throw new ApiError(400, 'VALIDATION', 'Escolha uma categoria e um período válidos.');
  const { kind, period } = input.data;
  const clubId = c.get('club').id;
  // All clubs use Brasília's calendar, independent of device timezone.
  const calendar = new Date(Date.now() - 3 * 3600000);
  const start = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), 1, 3) / 1000;
  const end = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, 1, 3) / 1000;
  const month = calendar.toISOString().slice(0, 7);
  const [rosterResult, progressResult, allResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      'SELECT id,name,role,avatar,avatar_revision,ranking_enabled,ranking_badge FROM members WHERE club_id=? AND active=1 ORDER BY normalized_name,id',
    ).bind(clubId),
    c.env.DB.prepare(
      `SELECT u.member_id,u.media_id,u.unit,SUM(u.current_count) total,
      SUM(COALESCE(e.monthly,0)) monthly,MAX(p.half_points IS NOT NULL) rated
      FROM ranking_units u JOIN media m ON m.id=u.media_id
      JOIN members r ON r.id=u.member_id AND r.club_id=m.club_id
      JOIN member_media p ON p.member_id=u.member_id AND p.media_id=u.media_id
      LEFT JOIN (SELECT e.member_id,e.media_id,e.unit,e.season,
        SUM(MAX(0,MIN(u.current_count,e.last_unit)-e.first_unit+1)) monthly
        FROM ranking_events e JOIN ranking_units u USING(member_id,media_id,unit,season)
        JOIN media scoped ON scoped.id=e.media_id JOIN members participant ON participant.id=e.member_id AND participant.club_id=scoped.club_id
        WHERE e.recorded_at>=? AND e.recorded_at<? AND scoped.club_id=? AND participant.active=1 GROUP BY e.member_id,e.media_id,e.unit,e.season) e
        USING(member_id,media_id,unit,season)
      WHERE m.club_id=? AND r.active=1 AND m.kind=? AND m.is_anime=?
      GROUP BY u.member_id,u.media_id,u.unit`,
    ).bind(start, end, clubId, clubId, kind === 'movie' ? 'movie' : 'tv', kind === 'anime' ? 1 : 0),
    c.env.DB.prepare(
      `SELECT u.member_id,u.media_id,u.unit,SUM(u.current_count) total,0 monthly,MAX(p.half_points IS NOT NULL) rated
      FROM ranking_units u JOIN media m ON m.id=u.media_id JOIN members r ON r.id=u.member_id AND r.club_id=m.club_id
      JOIN member_media p ON p.member_id=u.member_id AND p.media_id=u.media_id
      WHERE m.club_id=? AND r.active=1 GROUP BY u.member_id,u.media_id,u.unit`,
    ).bind(clubId),
  ]);
  const roster = rosterResult.results as unknown as RosterRow[];
  const progress = progressResult.results as unknown as ProgressRow[];
  const all = allResult.results as unknown as ProgressRow[];
  const participating = new Set(roster.filter((r) => r.ranking_enabled).map((r) => r.id));
  const viewed = all.filter((p) => p.unit !== 'season' && p.total > 0);
  const badgesFor = (memberId: string): RankingBadge[] => {
    const own = all.filter((p) => p.member_id === memberId && p.total > 0);
    const badges: RankingBadge[] = [];
    if (own.some((p) => p.unit === 'movie')) badges.push('debut');
    if (own.some((p) => p.unit === 'season')) badges.push('credits');
    if (new Set(own.filter((p) => p.unit !== 'season' && p.rated).map((p) => p.media_id)).size >= 5)
      badges.push('critic');
    if (
      own.some(
        (p) =>
          p.unit !== 'season' &&
          new Set(
            viewed
              .filter((v) => v.media_id === p.media_id && participating.has(v.member_id))
              .map((v) => v.member_id),
          ).size >= 3,
      )
    )
      badges.push('company');
    return badges;
  };
  const entries: RankingEntry[] = roster
    .filter((r) => r.ranking_enabled)
    .map((r) => {
      const rows = progress.filter((p) => p.member_id === r.id);
      const measure = (p: ProgressRow) => (period === 'month' ? p.monthly : p.total);
      const badges = badgesFor(r.id);
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        ...avatarFields(r.id, r.avatar, r.avatar_revision),
        position: null,
        count: rows.filter((p) => p.unit !== 'season').reduce((n, p) => n + measure(p), 0),
        seasons: rows.filter((p) => p.unit === 'season').reduce((n, p) => n + measure(p), 0),
        rated: rows.filter((p) => p.unit !== 'season' && measure(p) > 0 && p.rated).length,
        badges,
        badge: r.ranking_badge && badges.includes(r.ranking_badge) ? r.ranking_badge : null,
      };
    });
  entries.sort(
    (a, b) =>
      b.count - a.count || a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id),
  );
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].count > 0)
      entries[i].position =
        i > 0 && entries[i - 1].count === entries[i].count ? entries[i - 1].position : i + 1;
  }
  const me = roster.find((r) => r.id === c.get('member').id)!;
  const badges = badgesFor(me.id);
  const response: ClubRanking = {
    kind,
    period,
    month,
    entries,
    clubTitles: new Set(
      progress
        .filter(
          (p) =>
            participating.has(p.member_id) &&
            p.unit !== 'season' &&
            (period === 'month' ? p.monthly : p.total) > 0,
        )
        .map((p) => p.media_id),
    ).size,
    participation: {
      enabled: Boolean(me.ranking_enabled),
      badge: me.ranking_badge && badges.includes(me.ranking_badge) ? me.ranking_badge : null,
      badges,
    },
  };
  return c.json(response);
});

rankingRoutes.patch('/participation', async (c) => {
  const input = await body(
    c,
    z
      .object({
        enabled: z.boolean().optional(),
        badge: z.enum(['debut', 'credits', 'critic', 'company']).nullable().optional(),
      })
      .refine((v) => v.enabled !== undefined || v.badge !== undefined),
  );
  // Selection is only displayed while its achievement is unlocked. Never trust a client unlock.
  await c.env.DB.prepare(
    'UPDATE members SET ranking_enabled=COALESCE(?,ranking_enabled),ranking_badge=CASE WHEN ? THEN ? ELSE ranking_badge END WHERE id=? AND club_id=? AND active=1',
  )
    .bind(
      input.enabled === undefined ? null : Number(input.enabled),
      Number(input.badge !== undefined),
      input.badge ?? null,
      c.get('member').id,
      c.get('club').id,
    )
    .run();
  return c.json({ ok: true });
});
