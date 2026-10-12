PRAGMA defer_foreign_keys = ON;

CREATE TABLE clubs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_version INTEGER NOT NULL DEFAULT 1,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO clubs (id, name, token_hash, token_version, owner_id, created_at)
SELECT 'legacy-club', 'Nosso clube', token_hash, token_version, owner_id, created_at
FROM club WHERE owner_id IS NOT NULL;

CREATE TABLE members_new (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id),
  name TEXT NOT NULL, normalized_name TEXT NOT NULL,
  recovery_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(club_id, normalized_name)
);
CREATE TABLE lists_new (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id),
  name TEXT NOT NULL, normalized_name TEXT NOT NULL, color TEXT NOT NULL, icon TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL REFERENCES members_new(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(club_id, normalized_name)
);
CREATE TABLE media_new (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id),
  title TEXT NOT NULL, normalized_title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('movie','tv')), year INTEGER,
  synopsis TEXT NOT NULL DEFAULT '', poster_url TEXT, tmdb_id INTEGER, tmdb_rating REAL,
  metadata TEXT, group_status TEXT NOT NULL DEFAULT 'planned' CHECK(group_status IN ('planned','watching','watched')),
  group_season INTEGER, group_episode INTEGER, revision INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES members_new(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(club_id, tmdb_id, kind), CHECK((group_season IS NULL) = (group_episode IS NULL)),
  CHECK(kind = 'tv' OR group_season IS NULL)
);
CREATE TABLE sessions_new (
  token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members_new(id) ON DELETE CASCADE,
  club_version INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE list_items_new (
  list_id TEXT NOT NULL REFERENCES lists_new(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media_new(id) ON DELETE CASCADE,
  added_by TEXT NOT NULL REFERENCES members_new(id), position INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(list_id, media_id)
);
CREATE TABLE member_media_new (
  member_id TEXT NOT NULL REFERENCES members_new(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media_new(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'want' CHECK(status IN ('want','watching','watched','dropped')),
  half_points INTEGER CHECK(half_points BETWEEN 1 AND 20), season INTEGER, episode INTEGER,
  revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(member_id, media_id),
  CHECK((season IS NULL) = (episode IS NULL))
);
CREATE TABLE import_aliases_new (
  club_id TEXT NOT NULL REFERENCES clubs(id), source_key TEXT NOT NULL, variant_key TEXT NOT NULL,
  media_id TEXT NOT NULL REFERENCES media_new(id) ON DELETE CASCADE,
  PRIMARY KEY(club_id, source_key, variant_key)
);

INSERT INTO members_new SELECT id, 'legacy-club', name, normalized_name, recovery_hash, role, active, created_at FROM members;
INSERT INTO lists_new SELECT id, 'legacy-club', name, normalized_name, color, icon, revision, created_by, created_at FROM lists;
INSERT INTO media_new SELECT id, 'legacy-club', title, normalized_title, kind, year, synopsis, poster_url, tmdb_id, tmdb_rating, metadata, group_status, group_season, group_episode, revision, created_by, created_at FROM media;
INSERT INTO sessions_new SELECT * FROM sessions;
INSERT INTO list_items_new SELECT * FROM list_items;
INSERT INTO member_media_new SELECT * FROM member_media;
INSERT INTO import_aliases_new SELECT 'legacy-club', source_key, variant_key, media_id FROM import_aliases;

-- Copies reference the new parents, so dropping old parents cannot cascade into preserved data.
DROP TABLE import_aliases;
DROP TABLE list_items;
DROP TABLE member_media;
DROP TABLE sessions;
DROP TABLE media;
DROP TABLE lists;
DROP TABLE members;
DROP TABLE club;

ALTER TABLE members_new RENAME TO members;
ALTER TABLE lists_new RENAME TO lists;
ALTER TABLE media_new RENAME TO media;
ALTER TABLE sessions_new RENAME TO sessions;
ALTER TABLE list_items_new RENAME TO list_items;
ALTER TABLE member_media_new RENAME TO member_media;
ALTER TABLE import_aliases_new RENAME TO import_aliases;

CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX media_manual_lookup ON media(club_id, normalized_title, kind);
CREATE UNIQUE INDEX media_manual_identity ON media(club_id, normalized_title, kind, COALESCE(year, 0)) WHERE tmdb_id IS NULL;
CREATE INDEX list_items_media ON list_items(media_id);
CREATE INDEX member_media_media ON member_media(media_id);
CREATE INDEX import_aliases_media ON import_aliases(media_id);
PRAGMA defer_foreign_keys = OFF;
