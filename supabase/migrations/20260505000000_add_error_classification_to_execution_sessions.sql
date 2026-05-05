-- Persist humanized failure classification on workflow_execution_sessions.
-- Stored at finalization time so the UI never has to re-derive meaning from
-- raw error_message strings. Raw error_message is preserved for technical
-- details disclosure.
--
-- Shape (see lib/workflows/errors/humanizeActionError.ts):
--   {
--     "category": "auth" | "config" | "validation" | "idempotency" |
--                 "billing" | "provider" | "internal",
--     "code": string | null,
--     "provider": string | null,
--     "path": string | null,
--     "title": string,
--     "description": string,
--     "hint": string,
--     "action": "reconnect" | "open_node" | "upgrade_plan" | null,
--     "severity": "error" | "warning",
--     "nodeId": string | null,
--     "nodeName": string | null,
--     "firstFailedNodeId": string | null,
--     "failedNodeCount": number
--   }

ALTER TABLE public.workflow_execution_sessions
  ADD COLUMN IF NOT EXISTS error_classification JSONB;

NOTIFY pgrst, 'reload schema';
