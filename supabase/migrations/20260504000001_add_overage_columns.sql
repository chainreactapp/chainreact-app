-- Phase 1.2: Schema additions for task overage billing.
--
-- Adds opt-in overage to user_profiles, metered Stripe price IDs to plans,
-- and a task_overage_events audit/queue table that is later consumed by the
-- /api/cron/report-overage cron to push usage records to Stripe.
--
-- The RPC body extension that actually consumes overage budget lives in
-- the next migration (20260504000002_rpc_v2_overage.sql).

-- ─── user_profiles columns ──────────────────────────────────────────────────

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS overage_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overage_cap_multiplier numeric(4,2) NOT NULL DEFAULT 2.0
    CHECK (overage_cap_multiplier >= 1 AND overage_cap_multiplier <= 5),
  ADD COLUMN IF NOT EXISTS overage_tasks_used integer NOT NULL DEFAULT 0
    CHECK (overage_tasks_used >= 0),
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id text;

COMMENT ON COLUMN user_profiles.overage_enabled IS
  'True when user has opted in to overage billing. Required for RPC to consume past tasks_limit.';
COMMENT ON COLUMN user_profiles.overage_cap_multiplier IS
  'Hard cap on overage as a multiplier of plan tasks_limit. 2.0 = up to 2x plan, 5.0 = up to 5x plan.';
COMMENT ON COLUMN user_profiles.overage_tasks_used IS
  'Tasks consumed past tasks_limit in the current period. Reset alongside tasks_used.';
COMMENT ON COLUMN user_profiles.stripe_subscription_item_id IS
  'Stripe subscription_item ID for the metered overage line. Set when user enables overage.';

-- ─── plans columns ──────────────────────────────────────────────────────────

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS stripe_metered_price_id_monthly text,
  ADD COLUMN IF NOT EXISTS stripe_metered_price_id_yearly text;

COMMENT ON COLUMN plans.stripe_metered_price_id_monthly IS
  'Stripe metered price (sum aggregation, arrears) attached to monthly subscriptions for overage.';
COMMENT ON COLUMN plans.stripe_metered_price_id_yearly IS
  'Stripe metered price for yearly subscriptions. Uses threshold billing for monthly invoicing.';

-- ─── task_overage_events: audit + reporting queue ──────────────────────────

CREATE TABLE IF NOT EXISTS task_overage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  execution_id text NOT NULL,
  workflow_id uuid,
  amount integer NOT NULL CHECK (amount > 0),
  rate_cents numeric(10, 4) NOT NULL,
  stripe_subscription_item_id text,
  reported_to_stripe_at timestamptz,
  stripe_usage_record_id text,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, execution_id)
);

COMMENT ON TABLE task_overage_events IS
  'Audit row + Stripe-reporting queue for every task consumed past tasks_limit. RPC inserts; cron drains via reported_to_stripe_at.';
COMMENT ON COLUMN task_overage_events.amount IS
  'Tasks consumed from overage in this charge (NOT the total request — only the portion past plan + pack).';
COMMENT ON COLUMN task_overage_events.rate_cents IS
  'Per-task rate at time of charge (in cents, fractional). Snapshot from plans.limits.overageRate * 100.';
COMMENT ON COLUMN task_overage_events.reported_to_stripe_at IS
  'NULL until cron reports usage to Stripe. Filtered by partial index for fast cron queries.';

-- Partial index for cron query: find all unreported rows nearing period end
CREATE INDEX IF NOT EXISTS idx_overage_events_unreported
  ON task_overage_events (user_id, period_end)
  WHERE reported_to_stripe_at IS NULL;

-- Index for billing-history lookups (per-user, recent first)
CREATE INDEX IF NOT EXISTS idx_overage_events_user_recent
  ON task_overage_events (user_id, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE task_overage_events ENABLE ROW LEVEL SECURITY;

-- Users can read their own rows (for billing history UI)
CREATE POLICY task_overage_events_select_own
  ON task_overage_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies — writes only via SECURITY DEFINER RPC
-- (deduct_tasks_if_available) and service-role cron jobs.
