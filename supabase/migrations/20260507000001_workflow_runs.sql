-- ChainReactV2 — workflow_runs table.
--
-- Per Slice 1M: every engine execution writes one row at completion. The UI
-- (workflow detail page) reads this table to show run history; the
-- humanized error_classification gives users a plain-English explanation
-- of failures with a clear action hint when applicable.
--
-- Steps live as jsonb on the row (no separate run_steps table for now).
-- That's fine for the small workflows Slice 1 ships; if step queries
-- become a hot path, we split later.

CREATE TYPE public.workflow_run_status AS ENUM (
  'succeeded',
  'failed'
);

CREATE TABLE public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  status public.workflow_run_status NOT NULL,
  trigger_node_id text NOT NULL,
  trigger_event jsonb NOT NULL,

  -- Per-step results from the engine (RunStepResult[]).
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Run-level fatal (workflow not found, trigger node missing, etc.).
  -- Distinct from per-step failures, which live inside steps[].error.
  fatal_error jsonb,

  -- Humanized error shape produced by core/errors/humanizeActionError.
  -- Populated only when status = 'failed'. Schema:
  --   { title: string, description: string, hint?: string,
  --     action?: 'reconnect'|'open_node'|'upgrade_plan',
  --     severity: 'warning'|'error' }
  error_classification jsonb,

  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- "List runs for this workflow, newest first" — the dominant UI query.
CREATE INDEX workflow_runs_workflow_idx
  ON public.workflow_runs (workflow_id, started_at DESC);

-- "List runs for this user, newest first" — for a future global runs page.
CREATE INDEX workflow_runs_user_idx
  ON public.workflow_runs (user_id, started_at DESC);

-- Partial index for the "find failed runs to alert on" cron path.
CREATE INDEX workflow_runs_failed_idx
  ON public.workflow_runs (workflow_id, started_at DESC)
  WHERE status = 'failed';

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;

-- Reads: users see their own runs only. Inserts come from the engine via
-- the service-role client; no user-facing write policies (default-deny).
CREATE POLICY workflow_runs_select_own ON public.workflow_runs
  FOR SELECT USING (auth.uid() = user_id);
