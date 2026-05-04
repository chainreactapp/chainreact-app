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

| File | Purpose |
|------|---------|
| `lib/workflows/errors/humanizeActionError.ts` | Pure humanizer — maps `(category, code, path, provider, message)` → `{title, description, hint, action, severity, ...}`. Falls back to heuristic category inference when none provided. |
| `lib/workflows/errors/classifyExecutionFailure.ts` | DB-aware helper — pulls first failed step from `execution_steps`, calls humanizer, adds `firstFailedNodeId` + `failedNodeCount`. Never throws. |
| `lib/services/workflowExecutionService.ts` | Calls `classifyExecutionFailure` at both finalization paths (engine crash, normal-with-errors). |
| `supabase/migrations/20260505000000_add_error_classification_to_execution_sessions.sql` | Adds `error_classification JSONB`. |
| `app/api/executions/[executionId]/retry/route.ts` | POST endpoint. Loads original trigger_data, forwards to `/api/workflows/execute` with cookie passthrough — so all auth / billing / cost-gate / rate-limit checks run uniformly with fresh executions. |
| `components/workflows/ClassifiedErrorCard.tsx` | Renders the humanized card with contextual CTA + "show technical details" disclosure. |
| `components/workflows/ExecutionHistoryModal.tsx` | Live UI. Replaces the old raw `<pre>` rendering at 3 sites. Adds Retry button + confirmation dialog. |

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

Generic, provider-agnostic actions only:

| `action` | UI behavior |
|----------|-------------|
| `reconnect` | Routes to `/integrations` |
| `open_node` | Routes to `/workflows/builder/{workflowId}?focusNode={nodeId}` |
| `upgrade_plan` | Routes to `/subscription` |
| `null` | No CTA shown |

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

> **Safe retry / resume-from-failed-node for side-effecting workflows.**
>
> Today, retry = full rerun. For workflows that already partially succeeded
> before failing (e.g. step 1: Stripe charge succeeded, step 2: Slack notify
> failed), retry will re-fire step 1.
>
> Resume-from-failed-node would require:
> - Engine support for partial context reconstruction (replay completed step
>   outputs into the data flow manager without rerunning them).
> - Cross-session idempotency dedupe — extend the Q4 key from
>   `(executionSessionId, nodeId, actionType)` to `(workflowId, originalSessionId, nodeId, actionType)`
>   so a resume can claim the original session's effects.
> - UX for choosing "retry from start" vs "resume from failed step".
>
> Track this as a separate engine project. Linked from CLAUDE.md §10.

## Testing

- `__tests__/workflows/humanizeActionError.test.ts` — 23 tests covering all
  Q1 categories, heuristic inference, structured vs string `error`, path
  prettification.
- The `classifyExecutionFailure` helper is integration-tested implicitly via
  the live workflow execution flow — no isolated test (it's mostly a thin
  DB lookup + delegate to the unit-tested humanizer).
