-- Phase 1.3: Extend deduct_tasks_if_available with task overage support.
--
-- New decision tree (Phase 2 will insert pack consumption between plan and overage):
--   1. Lock user_profiles row (unchanged)
--   2. Idempotency check (unchanged)
--   3. Period reset (extended: also reset overage_tasks_used)
--   4. Enterprise unlimited (unchanged)
--   5. Compute room across tiers (NEW): plan_room + overage_room
--      Overage room = (tasks_limit * (overage_cap_multiplier - 1)) - overage_tasks_used
--      Only counted when overage_enabled = true AND overage_rate is configured.
--   6. If total_available < requested → insufficient_balance (return remaining = plan_room only)
--   7. Consume in priority: plan → overage. Update both user_profiles columns.
--   8. Insert task_billing_events with metadata.plan_consumed + metadata.overage_consumed
--   9. Insert task_overage_events row when overage was consumed (Stripe-reporting queue).
--
-- The return signature is EXTENDED with two new columns: consumed_from_overage and
-- overage_rate_cents. Existing TS callers ignore unknown columns; the type extension
-- in Phase 1.5 starts reading them.

DROP FUNCTION IF EXISTS public.deduct_tasks_if_available(
  uuid, integer, text, text, jsonb, uuid, text
);

CREATE OR REPLACE FUNCTION public.deduct_tasks_if_available(
  p_user_id uuid,
  p_amount integer,
  p_execution_id text DEFAULT NULL::text,
  p_event_type text DEFAULT 'workflow_execution'::text,
  p_node_breakdown jsonb DEFAULT '{}'::jsonb,
  p_workflow_id uuid DEFAULT NULL::uuid,
  p_source text DEFAULT 'execute_route'::text
)
RETURNS TABLE(
  success boolean,
  applied boolean,
  result_type text,
  new_tasks_used integer,
  current_tasks_limit integer,
  remaining integer,
  consumed_from_overage integer,
  overage_rate_cents numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tasks_used INTEGER;
  v_tasks_limit INTEGER;
  v_plan TEXT;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_sub_status TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_existing_balance_after INTEGER;
  v_existing_limit INTEGER;
  -- Overage state
  v_overage_enabled BOOLEAN;
  v_overage_cap_multiplier NUMERIC;
  v_overage_tasks_used INTEGER;
  v_stripe_subscription_item_id TEXT;
  -- Plan-level overage rate (dollars per task), pulled from plans.limits.overageRate
  v_overage_rate NUMERIC;
  v_overage_rate_cents NUMERIC;
  -- Computed room
  v_plan_room INTEGER;
  v_overage_cap INTEGER;
  v_overage_room INTEGER;
  -- Consumption split
  v_consume_from_plan INTEGER;
  v_consume_from_overage INTEGER;
BEGIN
  -- Step 1: Lock the user's row to serialize concurrent deductions
  SELECT
    up.tasks_used, up.tasks_limit, up.plan, up.billing_period_start, up.billing_period_end,
    up.overage_enabled, up.overage_cap_multiplier, up.overage_tasks_used, up.stripe_subscription_item_id
  INTO
    v_tasks_used, v_tasks_limit, v_plan, v_period_start, v_period_end,
    v_overage_enabled, v_overage_cap_multiplier, v_overage_tasks_used, v_stripe_subscription_item_id
  FROM user_profiles up
  WHERE up.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, FALSE, 'billing_unavailable'::TEXT, 0, 0, 0, 0, 0::NUMERIC;
    RETURN;
  END IF;

  -- Step 2: Idempotency check — if this execution was already billed, return previous result
  IF p_execution_id IS NOT NULL THEN
    SELECT tbe.balance_after, tbe.tasks_limit_snapshot
    INTO v_existing_balance_after, v_existing_limit
    FROM task_billing_events tbe
    WHERE tbe.user_id = p_user_id
      AND tbe.execution_id = p_execution_id
      AND tbe.event_type = p_event_type;

    IF FOUND THEN
      -- Idempotent replay: return success but applied=FALSE
      RETURN QUERY SELECT
        TRUE,
        FALSE,
        'idempotent_replay'::TEXT,
        v_existing_balance_after,
        v_existing_limit,
        CASE WHEN v_existing_limit = -1 THEN -1
             ELSE GREATEST(0, v_existing_limit - v_existing_balance_after)
        END,
        0,
        0::NUMERIC;
      RETURN;
    END IF;
  END IF;

  -- Step 3: Period reset check (only if period has expired)
  -- Reset both tasks_used AND overage_tasks_used to 0.
  IF v_period_end IS NOT NULL AND v_now > v_period_end THEN
    IF v_plan = 'free' OR v_plan = 'beta' THEN
      -- Free/beta users: roll forward locally
      IF v_tasks_used > 0 OR v_overage_tasks_used > 0 THEN
        INSERT INTO task_billing_events (
          user_id, execution_id, event_type, amount, balance_after,
          tasks_limit_snapshot, period_start_snapshot, period_end_snapshot,
          source, metadata
        ) VALUES (
          p_user_id, NULL, 'period_reset', 0, 0,
          v_tasks_limit, v_period_start, v_period_end,
          COALESCE(p_source, 'execute_route'),
          jsonb_build_object('previous_overage_tasks_used', v_overage_tasks_used)
        );
      END IF;

      v_tasks_used := 0;
      v_overage_tasks_used := 0;
      v_period_start := v_now;
      v_period_end := v_now + INTERVAL '30 days';

      UPDATE user_profiles
      SET tasks_used = 0,
          overage_tasks_used = 0,
          billing_period_start = v_period_start,
          billing_period_end = v_period_end
      WHERE id = p_user_id;

    ELSE
      -- Paid users: check subscription status before resetting
      SELECT s.status
      INTO v_sub_status
      FROM subscriptions s
      WHERE s.user_id = p_user_id
        AND s.status IN ('active', 'trialing')
      ORDER BY s.current_period_end DESC NULLS LAST
      LIMIT 1;

      IF v_sub_status IS NOT NULL THEN
        -- Subscription is active/trialing — safe to reset
        IF v_tasks_used > 0 OR v_overage_tasks_used > 0 THEN
          INSERT INTO task_billing_events (
            user_id, execution_id, event_type, amount, balance_after,
            tasks_limit_snapshot, period_start_snapshot, period_end_snapshot,
            source, metadata
          ) VALUES (
            p_user_id, NULL, 'period_reset', 0, 0,
            v_tasks_limit, v_period_start, v_period_end,
            COALESCE(p_source, 'execute_route'),
            jsonb_build_object(
              'subscription_status', v_sub_status,
              'reset_reason', 'expired_period_active_subscription',
              'previous_overage_tasks_used', v_overage_tasks_used
            )
          );
        END IF;

        v_tasks_used := 0;
        v_overage_tasks_used := 0;

        -- Reset usage but do NOT advance billing_period_end — leave for webhook
        UPDATE user_profiles
        SET tasks_used = 0,
            overage_tasks_used = 0
        WHERE id = p_user_id;

      ELSE
        -- Subscription not active — fail closed
        RETURN QUERY SELECT FALSE, FALSE, 'subscription_inactive'::TEXT,
          v_tasks_used, v_tasks_limit, 0, 0, 0::NUMERIC;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- Step 4: Enterprise unlimited — always succeed
  IF v_tasks_limit = -1 THEN
    UPDATE user_profiles
    SET tasks_used = v_tasks_used + p_amount
    WHERE id = p_user_id;

    INSERT INTO task_billing_events (
      user_id, execution_id, event_type, amount, node_breakdown,
      balance_after, tasks_limit_snapshot, period_start_snapshot, period_end_snapshot,
      workflow_id, source, metadata
    ) VALUES (
      p_user_id, p_execution_id, p_event_type, p_amount, p_node_breakdown,
      v_tasks_used + p_amount, v_tasks_limit, v_period_start, v_period_end,
      p_workflow_id, COALESCE(p_source, 'execute_route'),
      jsonb_build_object('plan_consumed', p_amount, 'overage_consumed', 0)
    );

    RETURN QUERY SELECT TRUE, TRUE, 'deducted'::TEXT,
      v_tasks_used + p_amount, v_tasks_limit, -1, 0, 0::NUMERIC;
    RETURN;
  END IF;

  -- Step 5: Resolve overage room.
  -- Look up the plan's overage rate from plans.limits.overageRate (dollars/task).
  -- If the rate is missing, treat overage as disabled (fail safe — never charge an unknown rate).
  v_plan_room := GREATEST(0, v_tasks_limit - v_tasks_used);

  IF v_overage_enabled THEN
    SELECT (p.limits->>'overageRate')::NUMERIC INTO v_overage_rate
    FROM plans p
    WHERE p.name = v_plan
    LIMIT 1;

    IF v_overage_rate IS NULL OR v_overage_rate <= 0 THEN
      v_overage_room := 0;
      v_overage_rate_cents := 0;
    ELSE
      v_overage_cap := FLOOR(v_tasks_limit * (v_overage_cap_multiplier - 1));
      v_overage_room := GREATEST(0, v_overage_cap - v_overage_tasks_used);
      v_overage_rate_cents := v_overage_rate * 100;
    END IF;
  ELSE
    v_overage_room := 0;
    v_overage_rate_cents := 0;
  END IF;

  -- Step 6: Total-availability check
  IF (v_plan_room + v_overage_room) < p_amount THEN
    RETURN QUERY SELECT FALSE, FALSE, 'insufficient_balance'::TEXT,
      v_tasks_used, v_tasks_limit,
      v_plan_room,
      0, 0::NUMERIC;
    RETURN;
  END IF;

  -- Step 7: Consume in priority — plan first, then overage
  v_consume_from_plan := LEAST(p_amount, v_plan_room);
  v_consume_from_overage := p_amount - v_consume_from_plan;

  UPDATE user_profiles
  SET tasks_used = v_tasks_used + v_consume_from_plan,
      overage_tasks_used = v_overage_tasks_used + v_consume_from_overage
  WHERE id = p_user_id;

  -- Step 8: Audit billing event (single row covering both plan + overage portions)
  INSERT INTO task_billing_events (
    user_id, execution_id, event_type, amount, node_breakdown,
    balance_after, tasks_limit_snapshot, period_start_snapshot, period_end_snapshot,
    workflow_id, source, metadata
  ) VALUES (
    p_user_id, p_execution_id, p_event_type, p_amount, p_node_breakdown,
    v_tasks_used + v_consume_from_plan, v_tasks_limit, v_period_start, v_period_end,
    p_workflow_id, COALESCE(p_source, 'execute_route'),
    jsonb_build_object(
      'plan_consumed', v_consume_from_plan,
      'overage_consumed', v_consume_from_overage,
      'overage_rate_cents', v_overage_rate_cents
    )
  );

  -- Step 9: Audit overage event (separate row, drives the Stripe-reporting queue)
  IF v_consume_from_overage > 0 THEN
    INSERT INTO task_overage_events (
      user_id, execution_id, workflow_id, amount, rate_cents,
      stripe_subscription_item_id, period_start, period_end
    ) VALUES (
      p_user_id, p_execution_id, p_workflow_id, v_consume_from_overage, v_overage_rate_cents,
      v_stripe_subscription_item_id, v_period_start, v_period_end
    );
  END IF;

  RETURN QUERY SELECT TRUE, TRUE, 'deducted'::TEXT,
    v_tasks_used + v_consume_from_plan,
    v_tasks_limit,
    GREATEST(0, v_tasks_limit - (v_tasks_used + v_consume_from_plan)),
    v_consume_from_overage,
    v_overage_rate_cents;
  RETURN;
END;
$function$;
