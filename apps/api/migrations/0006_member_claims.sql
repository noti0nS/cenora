CREATE TABLE member_claims (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX member_claims_member ON member_claims(member_id);
CREATE INDEX member_claims_code ON member_claims(code_hash);
