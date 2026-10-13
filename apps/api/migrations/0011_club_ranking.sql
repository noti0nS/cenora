ALTER TABLE members ADD COLUMN ranking_enabled INTEGER NOT NULL DEFAULT 1 CHECK(ranking_enabled IN (0,1));
ALTER TABLE members ADD COLUMN ranking_badge TEXT CHECK(ranking_badge IN ('debut','credits','critic','company'));
ALTER TABLE member_media ADD COLUMN ranking_write TEXT;

-- Compact first-registration ledger. Episode ranges avoid one row per episode.
CREATE TABLE ranking_units (
  member_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  unit TEXT NOT NULL CHECK(unit IN ('movie','episode','season')),
  season INTEGER NOT NULL,
  current_count INTEGER NOT NULL CHECK(current_count >= 0),
  high_water INTEGER NOT NULL CHECK(high_water >= current_count),
  PRIMARY KEY(member_id,media_id,unit,season),
  FOREIGN KEY(member_id,media_id) REFERENCES member_media(member_id,media_id) ON DELETE CASCADE
);
CREATE TABLE ranking_events (
  member_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  unit TEXT NOT NULL,
  season INTEGER NOT NULL,
  first_unit INTEGER NOT NULL CHECK(first_unit > 0),
  last_unit INTEGER NOT NULL CHECK(last_unit >= first_unit),
  recorded_at INTEGER,
  PRIMARY KEY(member_id,media_id,unit,season,first_unit),
  FOREIGN KEY(member_id,media_id,unit,season) REFERENCES ranking_units(member_id,media_id,unit,season) ON DELETE CASCADE
);
CREATE INDEX ranking_events_period ON ranking_events(recorded_at,member_id);

-- Existing progress has no watch date. It belongs only to the all-time ranking.
INSERT INTO ranking_units
SELECT p.member_id,p.media_id,'movie',0,1,1 FROM member_media p JOIN media m ON m.id=p.media_id
WHERE m.kind='movie' AND p.status='watched';

INSERT INTO ranking_units
SELECT p.member_id,p.media_id,'episode',CAST(json_extract(s.value,'$.number') AS INTEGER),
  CASE WHEN json_extract(s.value,'$.number') < p.season THEN CAST(json_extract(s.value,'$.episodes') AS INTEGER)
    ELSE MIN(p.episode,CAST(json_extract(s.value,'$.episodes') AS INTEGER)) END,
  CASE WHEN json_extract(s.value,'$.number') < p.season THEN CAST(json_extract(s.value,'$.episodes') AS INTEGER)
    ELSE MIN(p.episode,CAST(json_extract(s.value,'$.episodes') AS INTEGER)) END
FROM member_media p JOIN media m ON m.id=p.media_id,
  json_each(CASE WHEN json_valid(m.metadata) THEN m.metadata ELSE '{}' END,'$.seasons') s
WHERE m.kind='tv' AND p.season IS NOT NULL
  AND json_extract(s.value,'$.number') BETWEEN 1 AND p.season
  AND json_extract(s.value,'$.episodes') BETWEEN 1 AND 9999;

INSERT OR IGNORE INTO ranking_units
SELECT p.member_id,p.media_id,'episode',p.season,p.episode,p.episode
FROM member_media p JOIN media m ON m.id=p.media_id
WHERE m.kind='tv' AND p.season IS NOT NULL;

INSERT INTO ranking_units
SELECT p.member_id,p.media_id,'season',CAST(json_extract(s.value,'$.number') AS INTEGER),1,1
FROM member_media p JOIN media m ON m.id=p.media_id,
  json_each(CASE WHEN json_valid(m.metadata) THEN m.metadata ELSE '{}' END,'$.seasons') s
WHERE m.kind='tv' AND json_extract(s.value,'$.number') BETWEEN 1 AND p.season
  AND json_extract(s.value,'$.episodes') BETWEEN 1 AND 9999
  AND (json_extract(s.value,'$.number') < p.season OR p.episode >= json_extract(s.value,'$.episodes'));

INSERT INTO ranking_events
SELECT member_id,media_id,unit,season,1,high_water,NULL FROM ranking_units WHERE high_water > 0;
