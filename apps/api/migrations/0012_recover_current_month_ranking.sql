-- Registrations cannot predate their club, member or title. If any was created
-- during this Brasília month, recover that proven month only, leaving older
-- history undated.
-- This is a recovery timestamp, not an invented viewing date.
UPDATE ranking_events AS e
SET recorded_at = unixepoch('now')
WHERE e.recorded_at IS NULL
  AND EXISTS (
    SELECT 1 FROM media m
    JOIN members member ON member.id=e.member_id AND member.club_id=m.club_id
    JOIN clubs club ON club.id=m.club_id
    WHERE m.id=e.media_id
      AND MAX(unixepoch(club.created_at),unixepoch(member.created_at),unixepoch(m.created_at)) >= unixepoch('now','-3 hours','start of month','+3 hours')
      AND MAX(unixepoch(club.created_at),unixepoch(member.created_at),unixepoch(m.created_at)) <= unixepoch('now')
  );
