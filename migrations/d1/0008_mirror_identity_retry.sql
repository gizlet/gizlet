-- Releases that 0007's mirror check failed only because GitHub did not answer which repository
-- their path holds. Mirroring no longer fails for that (src/mirror.ts); these are pending again,
-- and the cron queues them once they have waited (requeueStuck).
UPDATE releases SET status = 'pending', error = NULL, updated_at = 0
 WHERE status = 'failed' AND error LIKE 'GitHub did not say which repository %';
