-- Private repositories (read through the GitHub App), marks, scans, ratings and the score.
ALTER TABLE gizlets ADD COLUMN private INTEGER NOT NULL DEFAULT 0; -- 1: a private repository, read through the app
-- Derived by rescore() in src/score.ts from the tables below: the marks shown
-- (awesome, scanned), the rating aggregate and the 0-100 score.
ALTER TABLE gizlets ADD COLUMN marks TEXT NOT NULL DEFAULT '[]';
ALTER TABLE gizlets ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gizlets ADD COLUMN rating_sum INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gizlets ADD COLUMN score INTEGER NOT NULL DEFAULT 0;
CREATE INDEX gizlets_score ON gizlets (visibility, score DESC, updated_at DESC);

-- A malware scan of a release's packages, for its current revision (a re-index clears it).
ALTER TABLE releases ADD COLUMN scan TEXT;        -- NULL (not scanned) | clean | infected
ALTER TABLE releases ADD COLUMN scan_report TEXT; -- JSON: engine, report_url, note, scanned_at

-- Marks set by an admin, such as awesome. "scanned" is never stored here: it follows the scans.
CREATE TABLE marks (
  repo TEXT NOT NULL,
  mark TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repo, mark)
);

-- One rating per account (Better Auth user id) and gizlet.
CREATE TABLE ratings (
  repo TEXT NOT NULL,
  user_id TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (repo, user_id)
);
CREATE INDEX ratings_user ON ratings (user_id, updated_at DESC);
