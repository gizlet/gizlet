-- Short links, gizlet.io/<id> (src/links.ts). A gizlet has one current id (expires_at NULL); a
-- replaced or removed id keeps pointing at it until expires_at. repository_id is GitHub's, so a
-- link follows a renamed repository. user_id is the account that set it; NULL when an admin did.
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  repository_id INTEGER,
  user_id TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX links_repo ON links (repo, expires_at);
CREATE INDEX links_repository ON links (repository_id, expires_at);
