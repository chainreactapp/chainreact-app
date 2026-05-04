-- Baseline: capture the current production body of `deduct_tasks_if_available`.
--
-- This RPC has been running in production but was never checked into the repo.
-- This migration brings it into version control with ZERO behavior change so
-- the next migration (overage extension) shows a clean diff.
--
-- Captured 2026-05-04 from prod via `pg_get_functiondef('deduct_tasks_if_available'::regproc)`.
-- Single overload only.

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
  remaining integer
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
BEGIN
  -- Step 1: Lock the user's row to serialize concurrent deductions
  SELECT tasks_used, tasks_limit, plan, billing_period_start, billing_period_end
  INTO v_tasks_used, v_tasks_limit, v_plan, v_period_start, v_period_end
  FROM user_profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, FALSE, 'billing_unavailable'::TEXT, 0, 0, 0;
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
        END;
      RETURN;
    END IF;
  END IF;

  -- Step 3: Period reset check (only if period has expired)
  IF v_period_end IS NOT NULL AND v_now > v_period_end THEN
    IF v_plan = 'free' OR v_plan = 'beta' THEN
      -- Free/beta users: roll forward locally
      IF v_tasks_used > 0 THEN
        -- Insert period_reset event only when actually resetting from > 0
        INSERT INTO task_billing_events (
          user_id, execution_id, event_type, amount, balance_after,
          tasks_limit_snapshot, period_start_snapshot, period_end_snapshot,
          source, metadata
        ) VALUES (
          p_user_id, NULL, 'period_reset', 0, 0,
          v_tasks_limit, v_period_start, v_period_end,
          COALESCE(p_source, 'execute_route'), '{}'::jsonb
        );
      END IF;

      v_tasks_used := 0;
      v_period_start := v_now;
      v_period_end := v_now + INTERVAL '30 days';

      UPDATE user_profiles
      SET tasks_used = 0,
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
        IF v_tasks_used > 0 THEN
          INSERT INTO task_billing_events (
            user_id, execution_id, event_type, amount, balance_after,
            tasks_limit_snapshot, period_start_snapshot, period_end_snapshot,
            source, metadata
          ) VALUES (
            p_user_id, NULL, 'period_reset', 0, 0,
            v_tasks_limit, v_period_start, v_period_end,
            COALESCE(p_source, 'execute_route'),
            jsonb_build_object('subscription_status', v_sub_status, 'reset_reason', 'expired_period_active_subscription')
          );
        END IF;

        v_tasks_used := 0;

        -- Reset tasks but do NOT advance billing_period_end — leave for webhook
        UPDATE user_profiles
        SET tasks_used = 0
        WHERE id = p_user_id;

      ELSE
        -- Subscription not active — fail closed
        RETURN QUERY SELECT FALSE, FALSE, 'subscription_inactive'::TEXT,
          v_tasks_used, v_tasks_limit, 0;
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
      p_workflow_id, COALESCE(p_source, 'execute_route'), '{}'::jsonb
    );

    RETURN QUERY SELECT TRUE, TRUE, 'deducted'::TEXT,
      v_tasks_used + p_amount, v_tasks_limit, -1;
    RETURN;
  END IF;

  -- Step 5: Balance check — insufficient funds
  IF (v_tasks_limit - v_tasks_used) < p_amount THEN
    RETURN QUERY SELECT FALSE, FALSE, 'insufficient_balance'::TEXT,
      v_tasks_used, v_tasks_limit,
      GREATEST(0, v_tasks_limit - v_tasks_used);
    RETURN;
  END IF;

  -- Step 6: Deduct — sufficient balance, apply charge
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
    p_workflow_id, COALESCE(p_source, 'execute_route'), '{}'::jsonb
  );

  RETURN QUERY SELECT TRUE, TRUE, 'deducted'::TEXT,
    v_tasks_used + p_amount, v_tasks_limit,
    GREATEST(0, v_tasks_limit - (v_tasks_used + p_amount));
  RETURN;
END;
$function$;
