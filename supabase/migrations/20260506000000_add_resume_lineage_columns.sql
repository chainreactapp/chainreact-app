-- PR-R0 — phase 0 of the "Safe resume-from-failed-node execution" project.
--
-- Adds retry-lineage and workflow-definition-hash columns to
-- workflow_execution_sessions so that:
--   * Every execution can identify the "root" run of its retry chain.
--   * Resume can detect when the workflow definition has changed since the
--     original failed run and reject unsafely-resumable cases.
--
-- No application code reads these columns yet; phase 1 (PR-R1a) starts
-- writing them and threading root_execution_id into Q4 idempotency.
--
-- Plan: learning/docs/safe-resume-from-failed-node-implementation-plan.md
-- Project: learning/docs/safe-resume-from-failed-node-project.md

ALTER TABLE public.workflow_execution_sessions
  ADD COLUMN IF NOT EXISTS root_execution_id uuid;

ALTER TABLE public.workflow_execution_sessions
  ADD COLUMN IF NOT EXISTS workflow_definition_hash text;

-- Backfill: every existing run is its own retry-lineage root.
-- Idempotent: only updates rows where root_execution_id is NULL.
-- The id::uuid cast follows the session_side_effects precedent
-- (migration 20260413000000) which has been treating session ids as
-- uuid-formatted strings since that table was created.
UPDATE public.workflow_execution_sessions
   SET root_execution_id = id::uuid
 WHERE root_execution_id IS NULL;

-- Lookup index for retry-lineage queries (resume eligibility checks,
-- analytics: "how many retries does this run have?").
CREATE INDEX IF NOT EXISTS idx_wes_root_execution_id
  ON public.workflow_execution_sessions (root_execution_id);

-- workflow_definition_hash is read only after a single-row session lookup,
-- so no index is needed.

-- NOT NULL is deliberately deferred. The engine (phase 1) will start
-- populating root_execution_id for new rows; a follow-up cleanup migration
-- can SET NOT NULL once we are confident every active write path sets it.

NOTIFY pgrst, 'reload schema';
