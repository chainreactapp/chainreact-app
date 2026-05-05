-- Widen partial indexes on `integrations.status` to cover the full set
-- of canonical "connected" status values.
--
-- Background: 2026-05-05 audit revealed that ~160 server-side queries
-- were filtering with `.eq('status', 'connected')` while a parallel set
-- of code paths writes `'authorized'` / `'active'` / `'valid'` / `'ok'` /
-- `'ready'` to the same column. The query-side fix landed in
-- 695f3f57f (queries now use `.in('status', CONNECTED_STATUSES_LIST)`).
--
-- Two partial indexes from
-- 20260207000000_add_proactive_oauth_columns.sql carry `WHERE status =
-- 'connected'` predicates. After the query widening, those indexes still
-- match `'connected'` rows but force a sequential scan for the other 5
-- canonical synonyms. This migration recreates them with the wider
-- predicate so the proactive-health-check cron and related queries stay
-- index-eligible across all 6 connected statuses.
--
-- Index list (matches the original migration):
--   - idx_integrations_next_health_check
--   - idx_integrations_health_status
--
-- Single source of truth for the predicate values:
-- `lib/integrations/connectionStatus.ts:CONNECTED_INTEGRATION_STATUSES`.
-- Keep this WHERE clause in sync with that constant. If a value is
-- added or removed there, regenerate this index in a follow-up
-- migration (Postgres can't import the value at runtime).

BEGIN;

-- ─── idx_integrations_next_health_check ────────────────────────────────

DROP INDEX IF EXISTS idx_integrations_next_health_check;

CREATE INDEX idx_integrations_next_health_check
  ON integrations(next_health_check_at)
  WHERE status IN ('connected', 'authorized', 'active', 'valid', 'ok', 'ready')
    AND next_health_check_at IS NOT NULL;

-- ─── idx_integrations_health_status ────────────────────────────────────

DROP INDEX IF EXISTS idx_integrations_health_status;

CREATE INDEX idx_integrations_health_status
  ON integrations(health_check_status)
  WHERE status IN ('connected', 'authorized', 'active', 'valid', 'ok', 'ready');

COMMIT;
