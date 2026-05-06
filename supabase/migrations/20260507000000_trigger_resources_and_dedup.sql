-- ChainReactV2 — trigger_resources + webhook_event_dedup tables.
--
-- Per docs/rules/workflow-lifecycle.md: trigger registration is created
-- when a workflow activates and removed when it deactivates / disables /
-- deletes. The orchestrator (services/workflows/lifecycleOrchestrator.ts)
-- owns the lifecycle; the trigger lifecycle service (Slice 1J.2) owns the
-- writes to this table.
--
-- Per docs/rules/webhook-receipt-routes.md: webhook_event_dedup is the
-- canonical idempotency store keyed on (provider, event_id). System-only
-- table — no end-user access; service role is the only writer.

-- ── trigger_resources ───────────────────────────────────────────────────────
--
-- One row per (workflow, trigger node). The dispatcher queries by
-- (provider, event_type) to find candidate workflows; node_id lets us know
-- which node in the workflow definition fired.
--
-- user_id is denormalized from workflows.user_id so RLS doesn't need to join.
-- The FK to auth.users keeps user-deletion cascades clean alongside the FK to
-- workflows.

CREATE TABLE public.trigger_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  provider text NOT NULL,                        -- registry id, e.g. 'slack'
  event_type text NOT NULL,                      -- provider-scoped, e.g. 'message_received'
  node_id text NOT NULL,                         -- trigger node id in workflows.draft_definition

  config jsonb NOT NULL DEFAULT '{}'::jsonb,     -- trigger filters (channel id, etc.)
  account_id text,                                -- provider account scope (Slack team_id) — null until known

  registered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,                        -- providers like MS Graph; null for Slack
  last_renewed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX trigger_resources_workflow_node_unique
  ON public.trigger_resources (workflow_id, node_id);

CREATE INDEX trigger_resources_dispatch_idx
  ON public.trigger_resources (provider, event_type);

CREATE INDEX trigger_resources_workflow_idx
  ON public.trigger_resources (workflow_id);

ALTER TABLE public.trigger_resources ENABLE ROW LEVEL SECURITY;

-- The trigger lifecycle service runs inside the activate / disable
-- orchestrator hooks, which execute under the API route's authenticated
-- session — so per-user RLS gates user writes and the service role bypasses
-- for cron / dispatcher reads. Mirrors the integrations table policy set.
CREATE POLICY trigger_resources_select_own ON public.trigger_resources
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY trigger_resources_insert_own ON public.trigger_resources
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY trigger_resources_update_own ON public.trigger_resources
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY trigger_resources_delete_own ON public.trigger_resources
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trigger_resources_set_updated_at
  BEFORE UPDATE ON public.trigger_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── webhook_event_dedup ─────────────────────────────────────────────────────
-- system-table: webhook_event_dedup — internal idempotency store; no end-user access.
--
-- The dispatcher checks (provider, event_id) before enqueueing a run. UPSERT
-- with ON CONFLICT DO NOTHING gives us "first writer wins". A daily cron
-- prunes rows past expires_at.

CREATE TABLE public.webhook_event_dedup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE UNIQUE INDEX webhook_event_dedup_unique
  ON public.webhook_event_dedup (provider, event_id);

CREATE INDEX webhook_event_dedup_expires_idx
  ON public.webhook_event_dedup (expires_at);

-- System-only table; no user-facing access. RLS is still enabled defense-in-
-- depth — the deny-all policy makes any client query empty even with a stolen
-- anon key. The service role bypasses RLS by design for the dispatcher.
ALTER TABLE public.webhook_event_dedup ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhook_event_dedup_no_client_access ON public.webhook_event_dedup
  FOR ALL USING (false) WITH CHECK (false);
