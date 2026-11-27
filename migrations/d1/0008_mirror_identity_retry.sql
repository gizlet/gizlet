-- Releases that 0007's mirror check failed only because GitHub did not answer which repository
-- their path holds. Such releases now wait instead (src/mirror.ts); these are pending again, and
-- the cron queues them (requeueStuck). Failing deleted their packages from R2, so the packages
-- are mirrored afresh.
UPDATE packages SET size = NULL, sha256 = NULL, object = NULL
 WHERE EXISTS (SELECT 1 FROM releases r WHERE r.repo = packages.repo AND r.tag = packages.tag AND r.revision = packages.revision
                 AND r.status = 'failed' AND r.error LIKE 'GitHub did not say which repository %');
UPDATE releases SET status = 'pending', error = NULL, updated_at = 0
 WHERE status = 'failed' AND error LIKE 'GitHub did not say which repository %';
