import { rankingBadges, type EarnedBadge } from '@cenora/shared';

const levels = Object.entries(rankingBadges)
  .flatMap(([badge, definition]) =>
    definition.targets.map((target, i) => `('${badge}',${i + 1},${target})`),
  )
  .join(',');

/** Award milestones in the same transaction as the successful personal write. */
export function awardAchievements(db: D1Database, clubId: string, memberId: string, write: string) {
  const guard = 'EXISTS(SELECT 1 FROM member_media WHERE member_id=? AND ranking_write=?)';
  return [
    db
      .prepare(
        `WITH viewed AS (
      SELECT DISTINCT u.member_id,u.media_id,u.unit,p.half_points
      FROM ranking_units u JOIN member_media p USING(member_id,media_id)
      JOIN media m ON m.id=u.media_id JOIN members member ON member.id=u.member_id AND member.club_id=m.club_id
      WHERE member.club_id=? AND member.active=1 AND u.current_count>0 AND u.unit<>'season'
    ), company AS (
      SELECT media_id FROM viewed GROUP BY media_id HAVING COUNT(DISTINCT member_id)>=3
    ), metrics AS (
      SELECT member_id,'debut' badge,COUNT(DISTINCT media_id) amount FROM viewed WHERE unit='movie' GROUP BY member_id
      UNION ALL
      SELECT u.member_id,'credits',SUM(u.current_count) FROM ranking_units u JOIN media m ON m.id=u.media_id
        JOIN members member ON member.id=u.member_id AND member.club_id=m.club_id
        WHERE member.club_id=? AND member.active=1 AND u.unit='season' GROUP BY u.member_id
      UNION ALL
      SELECT member_id,'critic',COUNT(DISTINCT media_id) FROM viewed WHERE half_points IS NOT NULL GROUP BY member_id
      UNION ALL
      SELECT v.member_id,'company',COUNT(DISTINCT v.media_id) FROM viewed v JOIN company c ON c.media_id=v.media_id
        GROUP BY v.member_id
    ), levels(badge,tier,target) AS (VALUES ${levels})
    INSERT OR IGNORE INTO ranking_achievements(member_id,badge,tier,earned_at)
    SELECT m.member_id,m.badge,l.tier,? FROM metrics m JOIN levels l ON l.badge=m.badge
    WHERE m.amount>=l.target AND ${guard}`,
      )
      .bind(clubId, clubId, Math.floor(Date.now() / 1000), memberId, write),
    db
      .prepare(
        `UPDATE members SET ranking_badge=(SELECT a.badge FROM ranking_achievements a
      WHERE a.member_id=members.id ORDER BY a.tier DESC,a.badge LIMIT 1)
      WHERE club_id=? AND active=1 AND ranking_badge_auto=1 AND ${guard}`,
      )
      .bind(clubId, memberId, write),
  ];
}

export async function clubAchievements(db: D1Database, clubId: string) {
  const result = await db
    .prepare(
      `SELECT a.member_id,a.badge,a.tier,a.earned_at
    FROM ranking_achievements a JOIN members member ON member.id=a.member_id
    WHERE member.club_id=? AND member.active=1 ORDER BY a.tier DESC,a.badge`,
    )
    .bind(clubId)
    .all<{ member_id: string; badge: EarnedBadge['badge']; tier: number; earned_at: number }>();
  const badges = new Map<string, EarnedBadge[]>();
  for (const row of result.results) {
    const own = badges.get(row.member_id) ?? [];
    if (!own.some((badge) => badge.badge === row.badge))
      own.push({ badge: row.badge, tier: row.tier, earnedAt: row.earned_at });
    badges.set(row.member_id, own);
  }
  return badges;
}
