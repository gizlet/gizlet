-- Handhelds people ask Gizlet OS to support (src/devices.ts): one want per account (Better Auth
-- user id) and handheld. The handhelds with the most wants are ported first.
CREATE TABLE wants (
  handheld TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (handheld, user_id)
);
CREATE INDEX wants_user ON wants (user_id, created_at DESC);
