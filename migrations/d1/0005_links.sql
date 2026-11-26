-- Short links, gizlet.io/<id> (src/links.ts). A gizlet has one current id (expires_at NULL); a
-- replaced or removed id keeps pointing at it until expires_at. `gizlet` is the gizlet it belongs
-- to: `id:<GitHub repository id>` (so a link follows a renamed repository), or `repo:<repository>`
-- where the id is unknown. user_id is the account that set it; NULL when an admin did.
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  gizlet TEXT NOT NULL,
  repo TEXT NOT NULL,
  repository_id INTEGER,
  user_id TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX links_current ON links (gizlet) WHERE expires_at IS NULL;
CREATE INDEX links_gizlet ON links (gizlet, expires_at);
