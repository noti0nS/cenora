ALTER TABLE members ADD COLUMN ranking_badge_auto INTEGER NOT NULL DEFAULT 1 CHECK(ranking_badge_auto IN (0,1));
CREATE TABLE ranking_achievements (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  badge TEXT NOT NULL CHECK(badge IN ('debut','credits','critic','company')),
  tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 3),
  earned_at INTEGER NOT NULL,
  PRIMARY KEY(member_id,badge,tier)
);

-- Award existing milestones once. Future tracking writes award the same levels.
WITH viewed AS (
  SELECT DISTINCT u.member_id,u.media_id,u.unit,p.half_points,
    member.club_id,member.ranking_enabled
  FROM ranking_units u JOIN member_media p USING(member_id,media_id)
  JOIN media m ON m.id=u.media_id
  JOIN members member ON member.id=u.member_id AND member.club_id=m.club_id
  WHERE member.active=1 AND u.current_count>0 AND u.unit<>'season'
), company AS (
  SELECT club_id,media_id FROM viewed WHERE ranking_enabled=1
  GROUP BY club_id,media_id HAVING COUNT(DISTINCT member_id)>=3
), metrics AS (
  SELECT member.id member_id,'debut' badge,COUNT(DISTINCT v.media_id) amount FROM members member
    LEFT JOIN viewed v ON v.member_id=member.id AND v.unit='movie' WHERE member.active=1 GROUP BY member.id
  UNION ALL
  SELECT member.id,'credits',COALESCE(SUM(u.current_count),0) FROM members member
    LEFT JOIN ranking_units u ON u.member_id=member.id AND u.unit='season'
    WHERE member.active=1 GROUP BY member.id
  UNION ALL
  SELECT member.id,'critic',COUNT(DISTINCT v.media_id) FROM members member
    LEFT JOIN viewed v ON v.member_id=member.id AND v.half_points IS NOT NULL WHERE member.active=1 GROUP BY member.id
  UNION ALL
  SELECT v.member_id,'company',COUNT(DISTINCT v.media_id) FROM viewed v
    JOIN company c ON c.club_id=v.club_id AND c.media_id=v.media_id
    WHERE v.ranking_enabled=1 GROUP BY v.member_id
), levels(badge,tier,target) AS (
  VALUES ('debut',1,5),('debut',2,15),('debut',3,30),
    ('credits',1,3),('credits',2,10),('credits',3,25),
    ('critic',1,10),('critic',2,25),('critic',3,50),
    ('company',1,3),('company',2,8),('company',3,15)
)
INSERT INTO ranking_achievements(member_id,badge,tier,earned_at)
SELECT m.member_id,m.badge,l.tier,unixepoch('now') FROM metrics m JOIN levels l ON l.badge=m.badge
WHERE m.amount>=l.target;

-- Keep a previously selected badge only if it meets the new challenge threshold.
UPDATE members SET ranking_badge_auto=0
WHERE EXISTS(SELECT 1 FROM ranking_achievements a WHERE a.member_id=members.id AND a.badge=members.ranking_badge);
UPDATE members SET ranking_badge=NULL
WHERE NOT EXISTS(SELECT 1 FROM ranking_achievements a WHERE a.member_id=members.id AND a.badge=members.ranking_badge);
UPDATE members SET ranking_badge=(
  SELECT a.badge FROM ranking_achievements a WHERE a.member_id=members.id ORDER BY a.tier DESC,a.badge LIMIT 1
) WHERE ranking_badge_auto=1;
