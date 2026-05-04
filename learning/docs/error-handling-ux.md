# Error Handling UX

User-facing error handling for workflow executions. Closes the "errors live in
logs" gap with three pieces:

1. **Plain-english explanations** at finalization time.
2. **One-click retry** from the execution history modal.
3. **Proactive health alerts** — already shipped via the health transition
   engine, see CLAUDE.md §4.

This doc covers (1) and (2). For (3), see
`lib/integrations/healthTransitionEngine.ts`.

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │  workflow_execution_sessions                │
                    │  ─────────────────────────────              │
                    │  error_message     TEXT       (raw)         │
                    │  error_classification JSONB   (humanized)   │
                    └─────────────────────────────────────────────┘
                                       ▲
                                       │  written at finalization
                                       │
   ┌──────────────────────────┐        │        ┌─────────────────────────┐
   │ workflowExecutionService │────────┴────────│ classifyExecutionFailure│
   │   - crash path           │                 │  - reads execution_steps │
   │   - normal-with-errors   │                 │  - picks first failed    │
   │     finalization         │                 │  - calls humanizer       │
   └──────────────────────────┘                 └────────────┬─────────────┘
                                                             │
                                                  ┌──────────▼──────────┐
                                                  │ humanizeActionError │
                                                  │ (pure, unit-tested) │
                                                  └─────────────────────┘
```

## Files

### Data layer

| File | Purpose |
|------|---------|
| `lib/workflows/errors/humanizeActionError.ts` | Pure humanizer — maps `(category, code, path, provider, message)` → `{title, description, hint, action, severity, ...}`. Falls back to heuristic category inference when none provided. |
| `lib/workflows/errors/classifyExecutionFailure.ts` | DB-aware helper — pulls first failed step from `execution_steps`, calls humanizer, adds `firstFailedNodeId` + `failedNodeCount`. Never throws. |
| `lib/services/workflowExecutionService.ts` | Calls `classifyExecutionFailure` at both finalization paths (engine crash, normal-with-errors), then fires `notifyWorkflowFailure` for fan-out. |
| `supabase/migrations/20260505000000_add_error_classification_to_execution_sessions.sql` | Adds `error_classification JSONB`. |
| `supabase/migrations/20260505000001_add_error_notifications_sent_at.sql` | Adds `error_notifications_sent_at TIMESTAMPTZ` for one-shot notification dedup. |
| `app/api/executions/[executionId]/retry/route.ts` | POST endpoint. Loads original trigger_data, forwards to `/api/workflows/execute` with cookie passthrough — so all auth / billing / cost-gate / rate-limit checks run uniformly with fresh executions. |

### Live builder UI (v2)

| File | Purpose |
|------|---------|
| `app/(app)/workflows/v2/api/flows/[flowId]/runs/history/route.ts` | v2 history endpoint. Selects + returns `errorClassification` + `errorMessage` on each `FlowRunSummary`. |
| `components/workflows/builder/WorkflowHistoryDialog.tsx` | The **live** v2 history dialog. List view shows compact classified card per failed run; click-into-detail view renders full classified card + Retry button + step list. Reads `pendingExecutionId` prop and auto-jumps to detail view from the `?historyExecution=` deep link. |
| `components/workflows/builder/BuilderHeader.tsx` | Mounts `WorkflowHistoryDialog` and threads through `pendingHistoryExecutionId` from URL. |
| `components/workflows/builder/WorkflowBuilderV2.tsx` | Reads `?historyExecution=` via `useSearchParams`, passes to `BuilderHeader`, strips the param after consumption so refresh / close doesn't re-loop. |
| `components/workflows/ClassifiedErrorCard.tsx` | Pure render — humanized card + contextual CTA (`reconnect` / `open_node` / `upgrade_plan`) + collapsed technical-details disclosure. Used by both the dialog list view (compact variant) and detail view (full variant). |

### Notification fan-out

| File | Purpose |
|------|---------|
| `lib/notifications/errorHandler.ts` | Orchestrator. Atomically claims `error_notifications_sent_at` for dedup, looks up classification, builds payload, fans out to email / Slack / Discord / SMS / in-app. Exposes `notifyWorkflowFailure(supabase, workflowId, errorDetails)` thin wrapper. |
| `lib/notifications/workflowFailurePayload.ts` | Pure builder. One classification + workflow + execution → `WorkflowFailurePayload` (subject, title, description, hint, cta, severity, technicalDetails, failedStepName). All channels render from this same shape. |
| `lib/notifications/email.ts` | Humanized email. Subject = `${title}: ${workflowName}`. HTML has accent-colored alert card, CTA button, collapsed `<details>` for technical info. |
| `lib/notifications/slack.ts` | Humanized Slack blocks: header / description / hint context / workflow + failed-step fields / CTA button / truncated technical details context. |
| `lib/notifications/discord.ts` | Humanized embed: title / description / inline workflow + failed-step / hint / CTA-as-link / truncated technical-details code block. |
| (SMS) | Inline in `errorHandler.ts` — terse: `"ChainReact: ${title} — workflow \"${name}\"."`. No URL. |

### Dead code (follow-up cleanup)

| File | Status |
|------|--------|
| `components/workflows/ExecutionHistoryModal.tsx` | **Dead.** Zero call sites — never rendered. The earlier classified-card / retry / detail UX work in this file is functionally superseded by the same UX now landing in `WorkflowHistoryDialog`. **Cleanup task:** after the live dialog is verified in production, delete this file or factor the shared card / retry pieces (`ClassifiedErrorCard`, retry confirmation `AlertDialog`) into reusable components if anything outside the builder will need them. Tracked in CLAUDE.md §10. |

## Persisted classification shape

Stored on `workflow_execution_sessions.error_classification`:

```json
{
  "category": "auth",
  "code": "AUTH_RECONNECT_REQUIRED",
  "provider": "gmail",
  "path": null,
  "title": "Reconnect Gmail",
  "description": "Your Gmail connection expired or was revoked.",
  "hint": "Reconnect Gmail from the integrations page, then retry the workflow.",
  "action": "reconnect",
  "severity": "error",
  "nodeId": "node_123",
  "nodeName": "Send email",
  "firstFailedNodeId": "node_123",
  "failedNodeCount": 1
}
```

The raw `error_message` is preserved verbatim for the technical-details
disclosure.

## CTA routing

Generic, provider-agnostic actions only. Both the in-app card and the
notification channels share the same routing table:

| `action` | URL |
|----------|-----|
| `reconnect` | `/integrations` |
| `open_node` | `/workflows/builder/{workflowId}?focusNode={nodeId}&historyExecution={executionId}` |
| `upgrade_plan` | `/subscription` |
| `null` (no specific action) | History deep link: `/workflows/builder/{workflowId}?historyExecution={executionId}` — opens History dialog directly to the failed run |

## Notification fan-out

When a workflow finalizes with `status = failed`, `notifyWorkflowFailure` is
called from both `workflowExecutionService` finalization paths:

1. **Engine crash** — `try/catch` in execute loop. Calls notify before re-throwing.
2. **Normal-with-errors** — execution completes, but `failedNodeIds.length > 0`.

Plus the existing fallback call sites in `app/api/workflows/execute/route.ts`
catch handler and `lib/execution/advancedExecutionEngine.ts` catch handler —
which still fire for pre-execution errors that never reach the service
finalization (auth, billing, parse failures).

### Idempotency

The orchestrator atomically claims `workflow_execution_sessions.error_notifications_sent_at`:

```sql
UPDATE workflow_execution_sessions
SET error_notifications_sent_at = NOW()
WHERE id = $1 AND error_notifications_sent_at IS NULL
RETURNING id
```

Returning a row → this caller wins, fans out. Returning empty → another
caller already sent, skip. Pre-execution errors with no `executionId` skip
the dedup check (no row to claim) and notify unconditionally.

### Channel-specific behavior

- **Email** — full HTML treatment with accent card, CTA button, collapsed Technical Details.
- **Slack** — block builder with header, description, hint context, workflow + failed-step fields, CTA button (`type: 'actions'`), truncated technical-details context.
- **Discord** — embed with title, description, inline workflow + failed-step fields, hint as field, CTA as `[label](url)` markdown link, truncated technical-details code block.
- **SMS** — `ChainReact: ${title} — workflow "${name}".` Title truncated to 40 chars. **No URL.**
- **In-app** — `notifications` table row: `type='workflow_failed'`, `title`, `message`, `action_url` (deep link), `action_label`, metadata. Default-enabled when `error_notifications_enabled = true`; opt out via `settings.error_notification_in_app = false`.

## Retry semantics — v1

**Full rerun only.** Calling `POST /api/executions/{id}/retry` creates a brand
new execution session via the standard execute pipeline, with:

- `inputData = original.trigger_data`
- `retryOf = original.id`
- `source = 'retry'` (drives `task_billing_events.source` for analytics)

**The original execution is never mutated.** It stays `failed` and remains in
history.

**Side-effect dedupe is session-scoped.** The Q4 idempotency keys are keyed on
`(executionSessionId, nodeId, actionType)`. A new session = new keys, so any
action that already fired in the original session will fire again on retry —
unless the underlying provider has its own dedupe (Stripe `Idempotency-Key`
header includes `executionSessionId`, so a retry uses a new key).

The UI shows a confirmation dialog before retry. Workflows with payment-
impacting steps (Stripe / Shopify / Square / PayPal) get a heightened warning.

## Follow-up — out of scope for v1

Tracked as a dedicated future project:
[Safe resume-from-failed-node execution](./safe-resume-from-failed-node-project.md).

Today, retry = full rerun. For workflows that already partially succeeded
before failing (e.g. step 1: Stripe charge succeeded, step 2: Slack notify
failed), retry will re-fire step 1. Closing that gap requires engine work —
node-level checkpoints, DataFlowContext rebuild from stored outputs,
cross-session / retry-lineage idempotency keys, payment-impacting node
safety, and UI copy distinguishing "Retry full workflow" vs "Resume from
failed step." See the project doc for the full minimum scope.

**Do not start that work without explicit go-ahead** — the project doc
records scope, not a green light.

## Testing

- `__tests__/workflows/humanizeActionError.test.ts` — 23 tests covering all
  Q1 categories, heuristic inference, structured vs string `error`, path
  prettification.
- The `classifyExecutionFailure` helper is integration-tested implicitly via
  the live workflow execution flow — no isolated test (it's mostly a thin
  DB lookup + delegate to the unit-tested humanizer).
