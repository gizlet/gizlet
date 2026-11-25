-- The registry. A gizlet is keyed by its GitHub repository, lowercase: github.com/<owner>/<repo>.
CREATE TABLE gizlets (
  repo TEXT PRIMARY KEY,
  owner TEXT NOT NULL,           -- display casing from GitHub
  name_repo TEXT NOT NULL,       -- display casing from GitHub
  repository_id INTEGER,         -- from the OIDC token, survives renames
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  names TEXT NOT NULL DEFAULT '{}',
  description TEXT,
  descriptions TEXT NOT NULL DEFAULT '{}',
  category TEXT NOT NULL DEFAULT 'app',
  tags TEXT NOT NULL DEFAULT '[]',
  color TEXT,
  icon TEXT,                     -- asset names in latest_tag
  cover TEXT,
  screenshots TEXT NOT NULL DEFAULT '[]',
  about TEXT NOT NULL DEFAULT '{}',
  controls TEXT NOT NULL DEFAULT '[]',
  latest_tag TEXT,               -- newest release that passed its checks
  version TEXT,
  targets TEXT NOT NULL DEFAULT '[]',
  tiers TEXT NOT NULL DEFAULT '[]',
  downloads INTEGER NOT NULL DEFAULT 0,
  -- unlisted: installable by link only; listed: also in search and featured lists;
  -- blocked: not served at all.
  visibility TEXT NOT NULL DEFAULT 'unlisted',
  visibility_reason TEXT,
  -- 1 when an admin set the visibility; the checks then leave it alone.
  visibility_locked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);
CREATE INDEX gizlets_listed ON gizlets (visibility, updated_at DESC);
CREATE INDEX gizlets_category ON gizlets (visibility, category, updated_at DESC);
CREATE INDEX gizlets_owner ON gizlets (owner COLLATE NOCASE);

CREATE TABLE releases (
  repo TEXT NOT NULL,
  tag TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,          -- pending | mirroring | checking | ready | failed
  revision INTEGER NOT NULL DEFAULT 1, -- bumped on each re-index; mirror jobs carry it
  error TEXT,
  warnings TEXT NOT NULL DEFAULT '[]', -- check findings that keep the gizlet unlisted
  index_json TEXT NOT NULL,
  mirrored INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (repo, tag)
);
CREATE INDEX releases_recent ON releases (repo, published_at DESC);
CREATE INDEX releases_status ON releases (status, updated_at);

CREATE TABLE packages (
  repo TEXT NOT NULL,
  tag TEXT NOT NULL,
  file TEXT NOT NULL,
  target TEXT NOT NULL,
  tier TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (repo, tag, file)
);

-- Featured lists, picked by hand through /v1/admin. Only listed gizlets are shown.
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  titles TEXT NOT NULL DEFAULT '{}',
  layout TEXT NOT NULL DEFAULT 'row', -- hero | row | grid
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (collection_id, repo)
);

-- Repositories recently found to have no gizlet.json; avoids refetching on every request.
CREATE TABLE misses (
  repo TEXT PRIMARY KEY,
  checked_at INTEGER NOT NULL
);

INSERT INTO collections (id, title, titles, layout, position) VALUES
  ('hero', 'Featured', '{"zh-CN":"精选推荐"}', 'hero', 0),
  ('starter', 'Make your own', '{"zh-CN":"做一个自己的"}', 'row', 40);

INSERT INTO collection_items (collection_id, repo, position) VALUES
  ('hero', 'github.com/gizlet/app-template', 0),
  ('starter', 'github.com/gizlet/app-template', 0);
