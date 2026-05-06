-- ChainReactV2 — workflow_runs.error_notifications_sent_at column.
--
-- Per V2 notifications platform plan §3 ("Dedup strategy"):
--   The notification orchestrator atomically claims this column to prevent
--   the failure-fan-out from firing twice for the same run. Source of
--   truth for "have we already notified the user about this failure?".
--
-- Atomic claim:
--   UPDATE workflow_runs
--      SET error_notifications_sent_at = now()
--    WHERE id = $1 AND error_notifications_sent_at IS NULL
--    RETURNING id;
--
-- Race-safe by primary-key lock — concurrent claims for the same run
-- collapse to one winner; losers see no row in RETURNING and skip
-- silently. Protects against engine retries, future
-- resume-from-failed-node, durable-queue at-least-once delivery, and
-- duplicate webhook delivery slipping past upstream dedup.
--
-- Per the plan: NO partial index added in this slice. The "future
-- retry cron" use case isn't built yet; we don't ship indexes that no
-- live query reads. Add the index in the slice that ships the cron.

ALTER TABLE public.workflow_runs
  ADD COLUMN error_notifications_sent_at timestamptz;
