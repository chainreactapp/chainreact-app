-- ChainReactV2 — notifications table.
--
-- Per master plan §10 Slice 1: "Notifications — execution failure fan-out
-- (slice 1: in-app only; email/Slack/Discord/SMS deferred to slice 2)."
-- This is the in-app surface — one row per user-facing event the user
-- should know about. The humanized error_classification on the
-- workflow_runs row is the source of the failure shape; the notification
-- row is a durable user-scoped record + dismissal state.
--
-- Inserts come from services (engine notifyOnFailedRun) via service-role.
-- Reads/updates (mark-read) are user-scoped through RLS — the user owns
-- their own dismissal state.

CREATE TYPE public.notification_type AS ENUM (
  'workflow_failed'
);

CREATE TYPE public.notification_severity AS ENUM (
  'warning',
  'error'
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  type public.notification_type NOT NULL,
  severity public.notification_severity NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  -- Where the user should go to act on this notification. Internal app
  -- path (e.g. /workflows/<id>); not a full URL.
  action_url text,
  -- Loosely-typed metadata: workflow_id, run_id, etc. — for future filtering
  -- and for in-page deep-link enrichment without a JOIN.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The dominant query: "list this user's notifications, newest first."
CREATE INDEX notifications_user_idx
  ON public.notifications (user_id, created_at DESC);

-- Partial index for the unread-count badge surface (header / home page).
CREATE INDEX notifications_unread_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Reads: users see their own notifications only.
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Updates: users mark their own notifications read. The WITH CHECK keeps a
-- malicious client from changing user_id during an UPDATE.
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- INSERT and DELETE policies deliberately omitted: inserts come from the
-- engine via service-role; deletion is service-role / cascade only.
