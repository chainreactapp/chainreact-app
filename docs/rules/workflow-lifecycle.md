# Rule: Workflow Lifecycle

## Purpose

Define every state a workflow can be in, every allowed transition between states, and the conditions that gate each transition. This rule is the foundation for activation, billing eligibility, trigger registration, execution dispatch, and UI status display.

## Resolved Decisions

**Locked for Slice 1:**
- Six lifecycle states: `draft`, `active`, `paused`, `disabled`, `eligible_to_resume`, `deleted`.
- **V2 does NOT support `archived` initially.** Users either pause or delete. Archive may be added later as a separate state if a clear product need emerges.
- Single state machine in `core/workflows/lifecycle.ts`. Persistence is a single typed `state` enum column on `workflows`. Derived flags (executable, billable, displayStatus) are pure projections.
- Transitions are explicit functions on a `LifecycleOrchestrator`. Each runs preconditions before persisting and emits side effects (trigger registration, health update, notification) atomically.
- **Trigger registration policy across states (shared invariant with webhook-receipt-routes rule):**
  - `paused` retains trigger registration. Webhook dispatcher drops events while paused.
  - `disabled` attempts **best-effort trigger unregistration**. Provider-side deregistration may fail or lag, so the **webhook dispatcher MUST still guard against disabled workflows** and silently drop leftover provider deliveries.
  - `eligible_to_resume` does NOT auto-restore trigger registration. User explicitly resumes; resumption re-registers the trigger.
- `eligible_to_resume` is a distinct state, not an attribute of `disabled`.
- **Soft-delete is the `deleted` lifecycle state itself**, not a separate `is_deleted` flag. `workflows.state = 'deleted'` is the canonical marker. `workflows.deleted_at` (timestamp) records when. A retention policy hard-deletes the row after the 30-day undelete window. UI hides `state = 'deleted'` workflows by default. Run history is retained through the soft-delete window.
- Manual-only workflows (no trigger): activation skips trigger registration but runs precondition checks.
- `disabled_reason` is a typed enum (`integration_revoked`, `billing_exhausted`, `repeated_failure`, `manual_admin`) plus optional context string.
- Failed trigger registration during activation: retry once with short backoff inside the orchestrator; longer retries belong to a separate cron path.
- In-flight runs during pause/disable: V2 follows V1 — let the run finish; pause/disable means "no new runs."
- **Multi-integration disable cascade (locked):** if an `active` workflow depends on multiple integrations and **any required** integration becomes disconnected, revoked, expired, or otherwise unhealthy in a way that prevents execution, the workflow transitions to `disabled`. Rules:
  - Disable only workflows that depend on the affected integration. Never disable unrelated workflows.
  - A workflow remains `active` only when **all** required dependencies are healthy.
  - When the broken dependency is later fixed, the workflow transitions to `eligible_to_resume`. Never auto-resume.
  - User must explicitly resume. Resume re-checks **all** activation preconditions: required config filled, all required integrations healthy, billing eligibility, trigger registration.
  - If another required dependency is still broken at resume, resume **fails with a clear user-facing reason**. The workflow does not silently become `active`.
  - Examples: Slack trigger + Slack action with Slack disconnected → disabled. Slack trigger + Gmail action with Gmail disconnected → disabled. Slack trigger + Gmail action with an unrelated Notion integration disconnecting → remains active. Disabled workflow's Gmail reconnects but Slack is now disconnected too → remains disabled (or resume fails); never silently active.

**Deferred decisions:**
- **Versioning model details:** publish creates an immutable revision; lifecycle state is on the workflow, not the revision; the `active_revision_id` column points at the running version. Pattern is clear; implementation details (revision storage, diff display, rollback UX) finalized during workflow CRUD / revision work.
- When/whether to add `archived` later.

**Decisions requiring product-owner input:**
- None for Slice 1. (Multi-integration disable cascade is now locked above.)

## Current V1 problem being solved

V1 has lifecycle-relevant state spread across:
- `workflows.status` (text column, values not strictly enumerated)
- `workflows.is_active` (boolean — overlaps with status)
- `workflows.eligible_to_resume` (boolean)
- The `workflowStore.ts` Zustand store (1,338 lines, contains UI-side state interpretation)
- Per-route handler logic that re-derives state from columns inconsistently
- Trigger registration state (`trigger_resources` table) maintained separately

There is no single state diagram. Different parts of the codebase decide differently whether a workflow can run, can be edited, can be billed, or shows as "active" in the UI.

V1 has also accumulated lifecycle-adjacent flags (`paused_by_billing`, `disabled_at`, `last_activated_at`) that interact in non-obvious ways. The result is bugs where, e.g., a workflow is "active" in the UI but its trigger webhook was never re-registered after a disconnect.

## V2 intended behavior

A single state machine in `core/workflows/lifecycle.ts` defines the canonical states and transitions. Persistence lives in `repositories/workflows.ts` as a single `state` column with a typed enum. Derived flags (UI status, billable, executable) are computed projections, not stored alongside state.

Transitions are exposed as explicit functions: `activate`, `pause`, `resume`, `disable`, `markEligibleToResume`, `delete`. Each function enforces preconditions before persisting and emits the side effects (trigger registration, health update, notification) atomically.

UI reads derived state via selectors (e.g. `isExecutable(workflow)`, `displayStatus(workflow)`). UI never inspects raw columns.

## Single source of truth

- State machine: `core/workflows/lifecycle.ts`.
- Persistence: `workflows.state` column (typed enum) plus `workflows.disabled_reason` (nullable text) for context when state is `disabled`.
- Transition orchestration: `services/workflows/lifecycleOrchestrator.ts` — runs transitions transactionally with side effects.
- Derived projections: `core/workflows/projections.ts` — pure functions like `isExecutable`, `displayStatus`.

## Allowed states

| State | Meaning | UI label |
|---|---|---|
| `draft` | Newly created or unpublished. No trigger registration. Not billable. Not executable. | "Draft" |
| `active` | Published, trigger registered, executable. Billable on each run. | "Active" |
| `paused` | User paused. Trigger registration retained. Not executable. Not billable on runs (no runs occur). | "Paused" |
| `disabled` | System disabled (integration revoked, billing exhausted, repeated failure). Trigger registration removed. Not executable. | "Disabled" + reason |
| `eligible_to_resume` | Was disabled; underlying issue resolved; awaiting user resume. Trigger registration NOT auto-restored. Not executable. | "Ready to resume" |
| `deleted` | Soft-deleted via `state = 'deleted'` plus `workflows.deleted_at` timestamp. Cascades unregistration. Run history retained through the 30-day undelete window. Hard-deleted by retention policy after. | (hidden) |

## Allowed transitions

```
                  ┌──────────────┐
                  │    draft     │
                  └──────┬───────┘
                         │ activate (preconditions)
                         ▼
                  ┌──────────────┐
        ┌────────►│    active    │◄────────┐
        │         └──────┬───────┘         │
        │                │                 │
        │ resume         │ pause / disable │ resume
        │                │                 │ (user-initiated)
        ▼                ▼                 │
┌────────────────┐ ┌──────────────┐  ┌──────────────────────┐
│   paused       │ │   disabled   ├─►│  eligible_to_resume  │
└──────┬─────────┘ └──────────────┘  └──────────────────────┘
       │ resume
       ▼
   active
```

| From → To | Trigger | Preconditions | Side effects |
|---|---|---|---|
| `draft` → `active` | `activate(id)` | All required fields filled. Connected integration healthy. Trigger registration succeeds. | Register trigger; emit health-engine signal; first revision published. |
| `active` → `paused` | `pause(id)` (user) | None. | Stop dispatch (in-flight runs complete); retain trigger registration. |
| `paused` → `active` | `resume(id)` (user) | Connected integration healthy. | Resume dispatch. |
| `active` → `disabled` | `disable(id, reason)` | None — system-initiated. | Unregister trigger (best-effort — provider-side deregistration may fail or lag); stop dispatch; emit notification. Webhook dispatcher must independently guard against disabled workflows for any leftover provider deliveries. |
| `paused` → `disabled` | `disable(id, reason)` | None — system-initiated. | Unregister trigger (best-effort, same as above); emit notification. The workflow was already not dispatching, so no in-flight pause-stop work. |
| `eligible_to_resume` → `disabled` | `disable(id, reason)` | A new disable reason fires (e.g. integration was reconnected then revoked again, or billing exhausted while waiting for resume). | Update `disabled_reason`; append to `disabled_history`; trigger registration is already absent. |
| `draft` → `disabled` | (disallowed) | Drafts have no trigger registration and are not executable. There is no actionable system disable for a draft. The `disable()` orchestrator rejects this transition with a typed error. | (none — transition not allowed) |
| `disabled` → `eligible_to_resume` | `markEligibleToResume(id)` | Underlying disabled-reason resolved (integration reconnected, billing OK, etc.). | Notify user; do NOT auto-resume. |
| `eligible_to_resume` → `active` | `resume(id)` (user) | Same preconditions as draft→active. | Re-register trigger; emit health-engine signal. |
| `draft` → `deleted` | `delete(id)` | User confirms. | No trigger unregistration needed (drafts have no registration). Soft-delete: `state = 'deleted'`, `deleted_at = now`. |
| `active` / `paused` / `disabled` / `eligible_to_resume` → `deleted` | `delete(id)` | User confirms. | Best-effort trigger unregistration; cascade related rows; retain run history. Soft-delete: `state = 'deleted'`, `deleted_at = now`. |
| `deleted` → (terminal) | n/a | `deleted` is terminal from the product UI unless an explicit undelete flow is added during the 30-day window. After the retention period, the row is hard-deleted by the retention policy. | n/a |

## Disallowed behavior

- Auto-transition from `disabled` directly to `active`. `eligible_to_resume` is mandatory; user must explicitly resume.
- Activation when the trigger registration call fails. Activation is transactional: if registration fails, the state stays `draft` and the failure is reported.
- Two concurrent transitions on the same workflow. Use a row-level lock (advisory lock or SELECT FOR UPDATE).
- UI reading `is_active` or other legacy columns. UI consumes only the projection helpers.
- Skipping the `eligible_to_resume` step and resuming silently when an integration reconnects.
- Disabling an entire user's workflows because one integration disconnected. Disable cascade is per-integration: only workflows that depend on the revoked integration are disabled.
- Deletion of a workflow that has in-flight runs without first allowing them to complete or be killed.
- Lifecycle decisions made outside the orchestrator — every transition goes through the orchestrator.

## Edge cases

- **Activate fails after partial trigger registration:** orchestrator rolls back the registration before failing the transition. Repository state stays `draft`.
- **Disable cascade:** integration `slack-conn-123` is revoked → orchestrator finds all workflows using it → calls `disable(id, 'integration_revoked')` for each. Workflows using *other* integrations are unaffected.
- **Pause during active run:** the in-flight execution completes (or is killed at the next-step boundary, depending on retry-resume design). No new runs are dispatched.
- **Disable during active run:** same as pause for in-flight runs. The workflow does not auto-resume after the run completes; it stays disabled.
- **Manual-only workflows (no trigger):** activation skips trigger registration but still runs the precondition checks. Lifecycle state is identical; the difference is in execution dispatch.
- **Workflow with multiple triggers (future):** activation must register all triggers; partial failure rolls back all.
- **Versioned workflows / revisions:** lifecycle state is per workflow, not per revision. Activation publishes a revision; revisions are immutable; the workflow points at the active revision.
- **Soft-deleted workflow with active triggers:** deletion unregisters triggers. A "deleted" workflow can never receive an event.
- **Race between `disable(reason=billing)` and `disable(reason=integration_revoked)`:** the lock serializes; whichever wins records its reason. Subsequent reasons are appended to a `disabled_history` log, not silently overwritten.
- **Eligible-to-resume but new disable reason fires:** transition `eligible_to_resume` → `disabled` is allowed (back to disabled with a new reason).
- **Workflow creator deletes their account:** all workflows transition to `deleted`. Run history retained for billing reconciliation.

## Required tests

Unit tests in `tests/unit/core/workflows/lifecycle.test.ts`:

1. Every allowed transition succeeds when preconditions are met.
2. Every disallowed transition rejects with a clear error code.
3. Activation rolls back trigger registration on partial failure.
4. Disable does not auto-transition to active when the integration reconnects (eligible_to_resume mandatory).
5. Pause preserves trigger registration; resume does not re-register.
6. Disable unregisters trigger; resume re-registers.
7. Lifecycle transitions are idempotent at the API boundary (calling `pause` on an already-paused workflow is a no-op or a typed error, not a state corruption).
8. Concurrent transitions on the same workflow serialize via lock.
9. Q5 invariant: a workflow with `null` integration field never transitions to active (precondition fails).
10. Manual-only workflow: activation skips trigger registration but runs precondition checks.

Integration tests in `tests/integration/lifecycle/`:

11. Full draft → active → run → pause → resume → run → disable (integration revoked) → eligible_to_resume → resume flow on a real Supabase test schema.
12. Disable cascade: revoke integration, verify all dependent workflows transition to disabled.
13. Concurrent pause + disable: only one wins, the other returns a typed conflict error.
14. **Lifecycle ↔ webhook dispatcher guard alignment:** workflow is `disabled` while the provider still delivers a webhook (deregistration lag). The webhook dispatcher silently drops the event; no run is enqueued. Verifies the shared invariant with the webhook-receipt-routes rule.
15. **Multi-integration dependency cascade (4-case matrix):**
    a. Workflow depends on Slack (trigger) + Gmail (action). Disconnect Gmail → workflow transitions to `disabled` with reason `integration_revoked`.
    b. Workflow depends on Slack + Gmail. Disconnect an unrelated Notion integration belonging to the same user → workflow remains `active`.
    c. Disabled workflow (because Gmail disconnected). Gmail reconnects → workflow transitions to `eligible_to_resume` (not auto-resumed).
    d. Disabled workflow (because Gmail disconnected). Gmail reconnects, but Slack disconnects in the meantime. User attempts resume → resume **fails** with a typed error citing the still-broken dependency; workflow remains `disabled` (or `eligible_to_resume`); never silently `active`.

Parity test in `tests/parity/`:

16. A workflow that V1 silently auto-resumed after integration reconnect (known regression) does NOT auto-resume in V2.

## V1 behavior to preserve

- The `eligible_to_resume` concept — users explicitly resume disabled workflows after reconnection.
- Per-integration disable cascade (don't disable unrelated workflows).
- Run history retention through deletion.
- Manual-only workflow activation (no trigger required).

## V1 behavior to drop

- State spread across multiple columns and stores.
- Implicit lifecycle transitions buried in route handlers.
- UI reading raw columns rather than projections.
- Auto-resume edge cases that bypass user consent.

## Open questions

(Disable granularity, `eligible_to_resume` distinct-vs-flag, in-flight run during pause/disable, failed-trigger-registration retry, and soft-delete vs hard-delete are now resolved — see "Resolved Decisions" above. Versioning is now in Deferred Decisions.)

No open questions remain that block Slice 1.
