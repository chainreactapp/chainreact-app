-- ChainReactV2 — user_billing table + atomic deduct RPC.
--
-- Per Slice 1N: minimum billing gate. One row per user holds the task
-- quota counters. The gate (services/billing/executionBillingGate.ts)
-- calls deduct_tasks_if_available before every workflow run; if the
-- deduction would push tasks_used past tasks_limit, the run is refused.
--
-- Stripe / packs / overage / auto-buy are deferred. This is the minimum
-- structure that proves the engine can be blocked by quota end-to-end;
-- richer billing layers slot on top without altering this contract.

CREATE TABLE public.user_billing (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tasks_limit int NOT NULL DEFAULT 100,
  tasks_used int NOT NULL DEFAULT 0,
  period_started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_billing ENABLE ROW LEVEL SECURITY;

-- Reads: users see their own billing row only. Writes happen exclusively
-- via the RPC (SECURITY DEFINER) or service-role; no user-facing INSERT/
-- UPDATE/DELETE policies — default-deny so a user cannot reset their own
-- tasks_used.
CREATE POLICY user_billing_select_own ON public.user_billing
  FOR SELECT USING (auth.uid() = user_id);

CREATE TRIGGER user_billing_set_updated_at
  BEFORE UPDATE ON public.user_billing
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Backfill rows for any users that already exist before this migration.
INSERT INTO public.user_billing (user_id)
  SELECT id FROM auth.users
  ON CONFLICT (user_id) DO NOTHING;

-- Extend the existing handle_new_user trigger so new signups always get a
-- billing row alongside their profile. SECURITY DEFINER is justified for
-- the same reason as the original (only Supabase Auth inserts auth.users;
-- the function runs with owner privileges to bypass RLS for the seed).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id) VALUES (NEW.id);
  INSERT INTO public.user_billing (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

-- ── Atomic deduct RPC ──────────────────────────────────────────────────
--
-- The atomicity is the point: a single UPDATE … WHERE tasks_used + amount
-- <= tasks_limit RETURNING gives us a race-free check-and-write under the
-- row-level lock UPDATE acquires. No "SELECT then UPDATE" — that would
-- let two concurrent runs both see capacity and both deduct.
--
-- Returns jsonb {ok, used, limit}:
--   ok=true  → deduction succeeded; used reflects the post-deduction value.
--   ok=false → not enough capacity; used reflects the current value.
--
-- SECURITY DEFINER + REVOKE/GRANT scopes execution to service_role only
-- (server-side callers). RLS is bypassed because the function runs as
-- the owner (postgres); the explicit grant is the auth boundary.

CREATE OR REPLACE FUNCTION public.deduct_tasks_if_available(
  p_user_id uuid,
  p_amount int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used int;
  v_limit int;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'deduct_tasks_if_available: p_amount must be positive (got %)', p_amount;
  END IF;

  -- Materialize a row for this user if signup predated billing or the
  -- backfill missed an edge case. ON CONFLICT keeps the existing counters.
  INSERT INTO public.user_billing (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

  -- Atomic deduct. The capacity predicate is part of the WHERE clause so
  -- the row lock makes check-and-write race-free.
  UPDATE public.user_billing
     SET tasks_used = tasks_used + p_amount
   WHERE user_id = p_user_id
     AND tasks_used + p_amount <= tasks_limit
   RETURNING tasks_used, tasks_limit
   INTO v_used, v_limit;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'used', v_used, 'limit', v_limit);
  END IF;

  -- Capacity exhausted — return current state for the gate to surface.
  SELECT tasks_used, tasks_limit
    INTO v_used, v_limit
    FROM public.user_billing
   WHERE user_id = p_user_id;

  RETURN jsonb_build_object('ok', false, 'used', v_used, 'limit', v_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_tasks_if_available(uuid, int) FROM public;
REVOKE ALL ON FUNCTION public.deduct_tasks_if_available(uuid, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_tasks_if_available(uuid, int) TO service_role;
