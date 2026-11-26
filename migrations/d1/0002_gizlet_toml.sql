-- Gizlets are described by the repository's gizlet.toml at the release tag, not by a gizlet.json
-- release asset, and a package's size and sha256 are learnt while mirroring it. Releases indexed
-- from gizlet.json are dropped: every gizlet is indexed again from its gizlet.toml on first sight.
-- Collections are kept; they only show gizlets that are listed.
DROP TABLE packages;
DROP TABLE releases;
DROP TABLE gizlets;
DELETE FROM misses;

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
  license TEXT,
  links TEXT NOT NULL DEFAULT '{}', -- the developer's site and social accounts
  icon TEXT,                     -- repository paths at latest_tag
  cover TEXT,
  pattern TEXT,                  -- a tile repeated across the top of the gizlet's page
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
  spec_json TEXT NOT NULL,       -- the release's gizlet.toml, parsed (src/schema.ts)
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
  file TEXT NOT NULL,            -- <id>-<version>-<target>-<tier>.gzl
  target TEXT NOT NULL,
  tier TEXT NOT NULL,
  entry TEXT NOT NULL,
  size INTEGER,                  -- known once mirrored
  sha256 TEXT,                   -- known once mirrored
  revision INTEGER NOT NULL,     -- the release revision this row belongs to
  PRIMARY KEY (repo, tag, file)
);
