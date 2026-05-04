-- PR-R1a, commit 1 — phase 1 of the "Safe resume-from-failed-node execution"
-- project. Adds the retry-lineage column to session_side_effects so that Q4
-- idempotency dedup can survive across retry/resume sessions of the same
-- logical run.
--
-- The new column is:
--   * Nullable initially. Application code in subsequent commits will
--     dual-write both execution_session_id and root_execution_id on every
--     recordFired() call.
--   * Backfilled here to equal execution_session_id for every existing
--     row. Before lineage existed, every run was its own root; copying
--     the session id into the new column preserves that invariant.
--   * Indexed (non-uniquely) on (root_execution_id, node_id, action_type)
--     for the new checkReplay() lookup pattern. NOT made UNIQUE: a
--     resume session and its retry-lineage parent share the root, and
--     both legitimately write rows during the dual-write window.
--
-- The existing UNIQUE (execution_session_id, node_id, action_type)
-- constraint is preserved through the dual-write phase. PR-R1b will swap
-- it for UNIQUE (root_execution_id, node_id, action_type) once the
-- q4_lineage_fallback_hit log shows zero fallback hits over the
-- observation window.
--
-- Type rationale: uuid matches execution_session_id (declared uuid in
-- migration 20260413000000) and matches the root_execution_id column on
-- workflow_execution_sessions (added in 20260506000000). No cast needed
-- when copying.
--
-- Plan: learning/docs/safe-resume-from-failed-node-implementation-plan.md
-- Project: learning/docs/safe-resume-from-failed-node-project.md

ALTER TABLE public.session_side_effects
  ADD COLUMN IF NOT EXISTS root_execution_id uuid;

UPDATE public.session_side_effects
   SET root_execution_id = execution_session_id
 WHERE root_execution_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sse_root_node_action
  ON public.session_side_effects (root_execution_id, node_id, action_type);

-- NOT NULL is deliberately deferred. Subsequent commits in PR-R1a start
-- writing this column for new rows; a follow-up cleanup migration (after
-- PR-R1b ships) can SET NOT NULL once every active write path populates it.

NOTIFY pgrst, 'reload schema';
