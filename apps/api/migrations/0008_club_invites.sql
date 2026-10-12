-- Link de convite por clube. Diferente do código do clube (token_hash), este token é
-- guardado em claro porque o dono precisa poder copiar o link a qualquer momento. O
-- token é revogável (DELETE) e a senha opcional é guardada como hash (HMAC do pepper).
-- O hash da senha usa o club_id como contexto para sobreviver à rotação do link.
CREATE TABLE club_invites (
  club_id TEXT PRIMARY KEY REFERENCES clubs(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
