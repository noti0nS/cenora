CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  normalized_email TEXT UNIQUE,
  recovery_hash TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  last_member_id TEXT
);

ALTER TABLE members ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE INDEX members_user ON members(user_id);
CREATE UNIQUE INDEX members_user_club ON members(user_id, club_id) WHERE user_id IS NOT NULL;

CREATE TABLE sessions_new (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  club_version INTEGER,
  scope_member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  renewed_at INTEGER,
  user_agent TEXT,
  CHECK (user_id IS NOT NULL OR member_id IS NOT NULL)
);
INSERT INTO sessions_new (token_hash,user_id,member_id,club_version,scope_member_id,created_at,expires_at,renewed_at,user_agent)
  SELECT token_hash,NULL,member_id,club_version,NULL,CAST(strftime('%s','now') AS INTEGER)-2592000,expires_at,NULL,NULL FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_codes (
  id TEXT PRIMARY KEY,
  normalized_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash TEXT
);
CREATE INDEX login_codes_email ON login_codes(normalized_email, expires_at);

CREATE TABLE mail_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX mail_outbox_created ON mail_outbox(created_at);
