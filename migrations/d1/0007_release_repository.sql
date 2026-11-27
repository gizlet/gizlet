-- GitHub's id for the repository each release was indexed from. A path can change hands; a
-- device updates an app only with releases of the repository it installed from (POST /v1/updates).
-- Releases indexed before this take their gizlet's id; NULL where that is unknown too.
ALTER TABLE releases ADD COLUMN repository_id INTEGER;
UPDATE releases SET repository_id = (SELECT g.repository_id FROM gizlets g WHERE g.repo = releases.repo);
