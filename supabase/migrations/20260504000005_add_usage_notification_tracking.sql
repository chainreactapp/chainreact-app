-- Phase 3.2: Track which usage-threshold emails have been sent per period.
--
-- The /api/cron/usage-alerts cron checks tasks_used / overage_tasks_used /
-- task_pack_balance and sends emails at 80%, 100%, when overage activates,
-- and when a pack balance hits zero.
--
-- Each notification key stores the user's billing_period_start at send time.
-- When the period rolls forward, stored timestamps become stale and the cron
-- re-sends in the new period. No need to actively clear on period reset.
--
-- Schema: user_profiles.usage_notifications_sent jsonb
--   shape: { "threshold_80": "<period_start_iso>",
--            "threshold_100": "<period_start_iso>",
--            "overage_activated": "<period_start_iso>",
--            "pack_depleted": "<iso_when_balance_first_hit_zero>" }

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS usage_notifications_sent jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_profiles.usage_notifications_sent IS
  'Per-period notification dedup. Keys: threshold_80, threshold_100, overage_activated, pack_depleted. Each value is the billing_period_start at send time (or now() for pack_depleted which is period-agnostic).';
