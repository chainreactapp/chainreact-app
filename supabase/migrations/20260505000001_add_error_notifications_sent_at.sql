-- Idempotency guard for workflow failure notifications.
-- Both the engine crash path and the normal-with-errors finalization path
-- can reach the notification orchestrator. The orchestrator atomically
-- claims this column with UPDATE ... WHERE error_notifications_sent_at IS NULL
-- so only one fan-out fires per execution.

ALTER TABLE public.workflow_execution_sessions
  ADD COLUMN IF NOT EXISTS error_notifications_sent_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
