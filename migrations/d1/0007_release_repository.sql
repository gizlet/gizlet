-- GitHub's id for the repository each release was indexed and mirrored from; NULL while unknown.
-- A path can change hands: a device updates an app only with releases of the repository it
-- installed from (POST /v1/updates). Releases indexed before this have none, so they are not
-- taken for any repository's: a gizlet's newest release is indexed again under its id on refresh.
ALTER TABLE releases ADD COLUMN repository_id INTEGER;
