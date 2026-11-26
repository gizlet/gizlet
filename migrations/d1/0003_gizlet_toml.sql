-- Gizlets are described by the repository's gizlet.toml at the release tag, not by a gizlet.json
-- release asset, and a package's size and sha256 are learnt while mirroring it.
--
-- Releases and packages indexed from gizlet.json are dropped. Gizlets are kept, with what the
-- registry decided about them (blocks, admin-set visibility and its reason, downloads); what
-- came from gizlet.json is cleared, so each one is indexed again from its gizlet.toml on its next
-- visit or by the refresh cron. Collections, marks, ratings and the sha256 of infected packages
-- (migration 0002) are kept.
DROP TABLE packages;
DROP TABLE releases;
DELETE FROM misses;

ALTER TABLE gizlets ADD COLUMN license TEXT;
ALTER TABLE gizlets ADD COLUMN links TEXT NOT NULL DEFAULT '{}'; -- the developer's site and social accounts
ALTER TABLE gizlets ADD COLUMN pattern TEXT;                     -- a tile repeated on its cartridge and page

-- Art was named by release asset; it is now a repository path, read again from gizlet.toml.
UPDATE gizlets SET latest_tag = NULL, version = NULL, icon = NULL, cover = NULL, screenshots = '[]', about = '{}',
  controls = '[]', targets = '[]', tiers = '[]', checked_at = 0;
-- Visibility the checks set is decided again; one an admin set (blocked included) stays.
UPDATE gizlets SET visibility = 'unlisted', visibility_reason = 'no release has passed its checks yet' WHERE visibility_locked = 0;

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
  scan TEXT,                     -- NULL (not scanned) | clean | infected; a re-index clears it (0002)
  scan_report TEXT,              -- JSON: engine, report_url, note, scanned_at
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
  object TEXT,                   -- R2 key of the mirrored bytes sha256 describes; one per mirror attempt
  revision INTEGER NOT NULL,     -- the release revision this row belongs to
  PRIMARY KEY (repo, tag, file)
);
