-- Phase 2.1: Schema additions for extra task packs.
--
-- Adds:
--   - pack_size / pack_price_cents / stripe_pack_price_id to plans
--   - task_pack_balance + auto_buy_packs to user_profiles
--   - default_payment_method_id to subscriptions (closes a latent bug where the
--     webhook reads this from Stripe but never persisted it)
--   - new pack_purchases table (one-time purchase ledger; FIFO consumption)
--
-- The RPC body extension that consumes pack balance lives in the next migration
-- (20260504000004_rpc_v3_packs.sql). Pack consumption order: plan → pack → overage.
--
-- Per decision #5, pack balance does NOT expire — survives period rolls and
-- plan downgrades.

-- ─── plans columns ──────────────────────────────────────────────────────────

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS pack_size integer
    CHECK (pack_size IS NULL OR pack_size > 0),
  ADD COLUMN IF NOT EXISTS pack_price_cents integer
    CHECK (pack_price_cents IS NULL OR pack_price_cents > 0),
  ADD COLUMN IF NOT EXISTS stripe_pack_price_id text;

COMMENT ON COLUMN plans.pack_size IS
  'Tasks granted per pack purchase. NULL for plans without pack support (free, beta, enterprise).';
COMMENT ON COLUMN plans.pack_price_cents IS 'One-time pack price in USD cents.';
COMMENT ON COLUMN plans.stripe_pack_price_id IS
  'Stripe one-time price (mode=payment) created via setup-stripe-pack-prices.ts.';

-- Populate defaults from pricing page values (decision #6):
--   Pro:      +1,000 tasks for $15
--   Team:     +5,000 tasks for $35
--   Business: +15,000 tasks for $100
UPDATE plans SET pack_size = 1000,  pack_price_cents = 1500  WHERE name = 'pro';
UPDATE plans SET pack_size = 5000,  pack_price_cents = 3500  WHERE name = 'team';
UPDATE plans SET pack_size = 15000, pack_price_cents = 10000 WHERE name = 'business';

-- ─── user_profiles columns ──────────────────────────────────────────────────

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS task_pack_balance integer NOT NULL DEFAULT 0
    CHECK (task_pack_balance >= 0),
  ADD COLUMN IF NOT EXISTS auto_buy_packs boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_profiles.task_pack_balance IS
  'Denormalized cache of sum(pack_purchases.tasks_remaining) for status=paid. Maintained by RPC + webhook + refund handler atomically.';
COMMENT ON COLUMN user_profiles.auto_buy_packs IS
  'When true, the engine triggers an off-session pack purchase if a workflow execution would otherwise hit insufficient_balance.';

-- ─── subscriptions: persist default payment method ──────────────────────────

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS default_payment_method_id text;

COMMENT ON COLUMN subscriptions.default_payment_method_id IS
  'Stripe payment_method ID saved from checkout. Used for off-session auto-buy.';

-- ─── pack_purchases: one-time purchase ledger ──────────────────────────────

CREATE TABLE IF NOT EXISTS pack_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text,
  plan_code text NOT NULL,
  pack_size integer NOT NULL CHECK (pack_size > 0),
  pack_price_cents integer NOT NULL CHECK (pack_price_cents > 0),
  tasks_remaining integer NOT NULL CHECK (tasks_remaining >= 0),
  tasks_consumed integer NOT NULL DEFAULT 0 CHECK (tasks_consumed >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'refunded', 'failed')),
  triggered_by text NOT NULL CHECK (triggered_by IN ('manual', 'auto_buy')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  refunded_at timestamptz
);

COMMENT ON TABLE pack_purchases IS
  'One-time pack purchase ledger. tasks_remaining decreases as RPC consumes (FIFO oldest paid first).';
COMMENT ON COLUMN pack_purchases.tasks_remaining IS
  'Tasks left in this specific pack. Sum across paid rows = user_profiles.task_pack_balance.';
COMMENT ON COLUMN pack_purchases.triggered_by IS
  '"manual" = user clicked Buy Pack; "auto_buy" = engine triggered off-session purchase.';

-- Index for FIFO consumption query (oldest paid pack first)
CREATE INDEX IF NOT EXISTS idx_pack_purchases_fifo
  ON pack_purchases (user_id, paid_at)
  WHERE status = 'paid' AND tasks_remaining > 0;

-- Index for purchase history UI
CREATE INDEX IF NOT EXISTS idx_pack_purchases_user_recent
  ON pack_purchases (user_id, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE pack_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY pack_purchases_select_own
  ON pack_purchases
  FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies — writes only via service-role webhook +
-- the refund / consumption SECURITY DEFINER paths.
