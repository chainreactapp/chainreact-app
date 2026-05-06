-- ChainReactV2 — workflows + workflow_revisions tables.
--
-- Per docs/rules/database-security.md: RLS enabled and policies declared in
-- the same migration. Per docs/rules/workflow-lifecycle.md: six-state enum
-- (`workflow_state`), typed `workflow_disabled_reason`, soft-delete is the
-- `deleted` state itself plus a `deleted_at` timestamp, and publish creates
-- an immutable revision (workflow_revisions) — the workflow points at the
-- running version via `active_revision_id`.

CREATE TYPE public.workflow_state AS ENUM (
  'draft',
  'active',
  'paused',
  'disabled',
  'eligible_to_resume',
  'deleted'
);

CREATE TYPE public.workflow_disabled_reason AS ENUM (
  'integration_revoked',
  'billing_exhausted',
  'repeated_failure',
  'manual_admin'
);

-- ── workflows ────────────────────────────────────────────────────────────────

CREATE TABLE public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name text NOT NULL,
  state public.workflow_state NOT NULL DEFAULT 'draft',
  disabled_reason public.workflow_disabled_reason,
  disabled_context text,                         -- optional human context for system disable
  active_revision_id uuid,                       -- FK added below (forward declaration to break cycle)

  -- Editable definition. On publish, snapshotted into workflow_revisions and
  -- active_revision_id is repointed.
  draft_definition jsonb NOT NULL DEFAULT '{}'::jsonb,

  deleted_at timestamptz,                        -- set when state transitions to 'deleted'

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflows_user_id_active_idx
  ON public.workflows (user_id, updated_at DESC)
  WHERE state <> 'deleted';

CREATE INDEX workflows_state_idx ON public.workflows (state) WHERE state <> 'deleted';

-- ── workflow_revisions ──────────────────────────────────────────────────────
-- Immutable snapshots created at publish-time. Updated only via INSERT — no
-- UPDATE policy. DELETE only via cascade from the workflow row.

CREATE TABLE public.workflow_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_revisions_workflow_id_idx ON public.workflow_revisions (workflow_id, created_at DESC);

-- Now wire the FK from workflows.active_revision_id.
ALTER TABLE public.workflows
  ADD CONSTRAINT workflows_active_revision_fk
  FOREIGN KEY (active_revision_id)
  REFERENCES public.workflow_revisions(id)
  ON DELETE SET NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflows_select_own ON public.workflows
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY workflows_insert_own ON public.workflows
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY workflows_update_own ON public.workflows
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY workflows_delete_own ON public.workflows
  FOR DELETE USING (auth.uid() = user_id);

-- workflow_revisions: select + insert only. Immutability + cascade-delete
-- semantics enforced by the absence of UPDATE / DELETE policies.
CREATE POLICY workflow_revisions_select_own ON public.workflow_revisions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY workflow_revisions_insert_own ON public.workflow_revisions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER workflows_set_updated_at
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
