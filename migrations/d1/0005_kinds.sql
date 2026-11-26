-- Kinds (docs/gizlet-toml.md): `app` (games and other foreground programs) or `service`. Every
-- gizlet indexed so far is an app; releases stored before this keep no kind and are read as apps.
ALTER TABLE gizlets ADD COLUMN kind TEXT NOT NULL DEFAULT 'app';
CREATE INDEX gizlets_kind ON gizlets (visibility, kind, updated_at DESC);

-- Listing now takes an editor's approval: the checks leave a gizlet unlisted until an admin lists
-- it, which locks its visibility. The gizlets listed until now stay listed, approved as they are.
UPDATE gizlets SET visibility_locked = 1, visibility_reason = NULL WHERE visibility = 'listed' AND visibility_locked = 0;
