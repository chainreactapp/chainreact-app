-- Phase 3 of v2 canonical engine plan (PR-V2-FLAG) —
-- per-user opt-in for v2 live execution.
--
-- Used in conjunction with the ENABLE_V2_LIVE_EXECUTION env flag. Both must
-- be true for a user's live (or sequential) workflow runs to be routed
-- through v2 (WorkflowExecutionService) instead of v1
-- (AdvancedExecutionEngine). Either alone keeps the run on v1. Sandbox /
-- test-mode runs are unaffected by this column — they always go through v2's
-- sandbox path regardless.
--
-- Settable only by super_admin during staged rollout (Phase 5 stages 1-2).
-- The dispatch decision + structured log live in
-- lib/execution/v2LiveExecutionDispatch.ts. The route at
-- app/api/workflows/execute/route.ts looks up this column once per request
-- and emits an `executionEngine: 'v1' | 'v2'` log so rollout dashboards can
-- track which engine actually ran each workflow.
--
-- Removed in Phase 5 stage 5 alongside v1 deletion (when the global flag
-- has flipped to default-true and held for one observation window).
--
-- Plan: learning/docs/v2-canonical-execution-engine-plan.md

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS opt_in_v2_execution boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.opt_in_v2_execution IS
  'Phase 3 staged-rollout opt-in for v2 (WorkflowExecutionService) live execution. False = v1 (AdvancedExecutionEngine). Settable by super_admin only during rollout. Removed in Phase 5 stage 5.';
