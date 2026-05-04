# Safe Resume-From-Failed-Node — Implementation Plan

**Status:** Approved directionally — phase 0 in progress. All work gated
behind feature flag `ENABLE_RESUME_FROM_FAILED_NODE` (default `false`)
through full rollout. Companion to
[safe-resume-from-failed-node-project.md](./safe-resume-from-failed-node-project.md)
(the "what"); this doc is the "how".

## Revisions log
- 2026-05-04: directional approval + 8 revisions: (1) Phase 5 targets
  `WorkflowHistoryDialog.tsx`; (2) feature flag in phase 0/1, API 404
  when off; (3) 7-day eligibility window via
  `RESUME_FROM_FAILED_NODE_WINDOW_DAYS`; (4) loop rules clarified;
  (5) AI replay from cache, no LLM re-call; (6) billing lands before or
  with the resume API; (7) Q4 dual-write + read-fallback with logging,
  uuid type; (8) project doc stays "in progress behind feature flag"
  until rollout.

## Context

Today's retry endpoint at [app/api/executions/[executionId]/retry/route.ts](../../app/api/executions/[executionId]/retry/route.ts)
re-runs the entire workflow from the trigger. For workflows that partially
succeeded — Stripe charge OK on step 1, Slack notify failed on step 2 — a full
rerun re-fires step 1. Q4 session-scoped idempotency does not protect across
sessions, and Stripe's `Idempotency-Key` header is also session-scoped today,
so the second charge can land.

**The intended outcome:** users can re-run from the broken step without
re-firing successful upstream side effects, and they understand which mode
they're choosing.

## Key insight from exploration

The data we need to resume is **already persisted** — we just don't read it
back. Specifically:

| Data | Already persisted? | Where |
|---|---|---|
| Per-node outputs (full JSONB) | ✅ Yes | `execution_steps.output_data` |
| Per-node inputs (resolved config) | ✅ Yes | `execution_steps.input_data` |
| Per-node status / errors | ✅ Yes | `execution_steps` |
| First failed node id | ✅ Yes (computed, unused for control flow) | `workflow_execution_sessions.error_classification.firstFailedNodeId` |
| Trigger data | ✅ Yes | `workflow_execution_sessions.trigger_data` |
| Side-effect cache (Q4) | ✅ Yes | `session_side_effects` |

What's **missing**:
- A retry-lineage identifier so Q4 / Stripe-header keys are stable across
  attempts of the same logical run.
- An engine entry point that pre-populates `DataFlowManager` from prior
  outputs and starts traversal at a chosen node.
- A workflow-definition fingerprint so we can detect when the graph has
  changed and resume would be unsafe.
- A second retry endpoint + UI mode + billing path that charges only the
  unfinished portion.

This is mostly assembly work over existing primitives, not new infrastructure.

## Goals

1. Add a "Resume from failed step" mode alongside the existing "Retry full
   workflow" mode.
2. Successful side-effecting nodes from the failed run **do not fire again**
   on resume — neither in our Q4 cache nor at the provider level.
3. Resume is only offered when it's verifiably safe; otherwise the UI hides
   the option and the user gets full rerun only.
4. Resume billing charges only the nodes that actually run.

## Non-goals (phase 1)

- **Resume into the middle of a loop iteration.** If the failed node is
  inside a `loop` node, resume is hidden. Full retry still works. Loop-aware
  resume is a phase-2 follow-up.
- **Resume after a partially completed loop.** If a loop ran some iterations
  before failing — even if the failure was in a downstream node *and* the
  loop's overall step status is anything other than fully `completed` —
  resume is hidden. Only loops with a single completed step record (full
  output array materialized) are eligible to be replayed as one unit.
- **AI-agent regeneration on resume.** AI agent nodes that succeeded during
  the original run replay their cached `execution_steps.output_data` — they
  do not call the LLM again. If a user wants regeneration, they choose full
  retry.
- **Resume a workflow whose definition has changed.** If the persisted
  fingerprint differs, resume is hidden.
- **Resume after a successful run.** Only `failed` / `cancelled` sessions are
  candidates. Same constraint as today's full retry.
- **Resume outside the eligibility window.** Default 7 days from original
  failure timestamp, configurable via env var
  `RESUME_FROM_FAILED_NODE_WINDOW_DAYS`. Past the window, resume is hidden;
  full retry still works (provider state may have drifted, but that's
  user-visible at retry time).
- **Cross-workflow resume.** Resume is always within a single workflow.

## Design decisions

### D1. Retry-lineage key (Q4 + Stripe header)

**Decision:** Add a `root_execution_id` column to `workflow_execution_sessions`.
First execution: `root_execution_id = id`. Each retry/resume:
`root_execution_id = original_session.root_execution_id`.

Q4 idempotency keys and `formatProviderIdempotencyKey()` are changed to use
`rootExecutionId` instead of `executionSessionId`. Same shape, different
field source.

**Why this over alternatives:**
- *Widen Q4 key to (user, workflow, node, action)*: breaks per-run
  isolation; two unrelated runs of the same workflow would dedupe each other.
- *Parallel cross-session table*: extra writes per handler; doubles Q4
  surface area; harder to reason about.
- *Lineage column*: zero new tables, single field threaded through meta,
  Stripe's server-side idempotency naturally extends to retries because the
  header value is identical.

**Backward compatibility:** for non-retry runs `root_execution_id = id`, so
the key value is unchanged from today. Existing `session_side_effects` rows
remain valid because their `execution_session_id` equals the run that
created them, which equals the lineage root for that run.

### D2. Skip-with-replay vs. handler-replay

When resuming, two ways to handle nodes upstream of the failed node that
already succeeded:

**Option A — Skip-with-replay (recommended):** Engine pre-populates
`DataFlowManager.nodeOutputs` from `execution_steps.output_data` for
completed nodes. Traversal *skips* those nodes entirely (handler not
invoked). Downstream variable references (`{{nodeId.field}}`) still resolve
because the output is in the manager.

**Option B — Handler-replay:** Engine traverses from the trigger as today.
Each handler hits Q4 and short-circuits to the cached `ActionResult`. No
provider call, but handler functions are invoked.

Option A is faster, cleaner, and avoids any risk of a handler doing work
outside `checkReplay` (e.g. logging, metrics, opening a connection).
Option B is a free safety net we get *for free* by keeping Q4 active even on
the resume path.

**Decision:** Both. Skip upstream completed nodes via Option A; keep Q4
active on the resumed-from node and all downstream nodes via Option B
(defense in depth). If the failed node partially succeeded — e.g. it threw
after recording — Q4 catches it and replays the recorded result.

### D3. Workflow definition fingerprint

**Decision:** Add a `workflow_definition_hash` column to
`workflow_execution_sessions`, populated at session creation. Hash =
SHA-256 of canonical JSON of `(nodes ordered by id, edges ordered by
(source, target))` — same canonicalization as `hashPayload`.

On resume, recompute the hash from the current workflow row. If it differs,
hide the resume option in the UI and reject at the API layer with a clear
error code (`WORKFLOW_DEFINITION_CHANGED`).

**Why fingerprint at session start (not at resume time of the original
workflow):** the user may edit the workflow between failure and retry. We
want to know *what graph the original run used*, not what it looks like
now. Storing it at session creation is cheap and unambiguous.

### D4. Billing for resume

**Decision:** Charge only nodes that will actually run.

- Resume cost preview = `computeCostPreview()` on the subgraph reachable
  from the failed node (inclusive). Reuse existing `cost-preview.ts`
  primitives; add a `fromNodeId` parameter that filters the node set.
- Deduction RPC call uses a fresh `execution_id` and a new `event_type =
  'workflow_execution_resume'` so it remains idempotent and does not collide
  with the original `'workflow_execution'` ledger row.
- Metadata on the ledger row includes `original_execution_id`,
  `root_execution_id`, `from_node_id`, and the list of skipped node ids.

**Why a new event_type:** preserves analytic separation between full runs
and resumes; the daily reconciliation query
([scripts/reconcile-billing-metadata.sql](../../scripts/reconcile-billing-metadata.sql))
can sum across both.

### D5. UI surfacing

**Decision:** Two-button design.

- "Retry full workflow" — current behavior, always available on `failed` /
  `cancelled` runs.
- "Resume from failed step" — only available when **all** of:
  - At least one node before the failed node succeeded (otherwise resume ≡
    full retry).
  - `error_classification.firstFailedNodeId` is set and resolves to a node
    in the current workflow definition.
  - Workflow definition hash matches.
  - Failed node is not inside a loop (phase 1 constraint).

When available, both buttons are shown side-by-side. The resume dialog
shows a different copy ("only the [N] remaining steps will run; previously
completed steps are skipped") and omits the heightened payment-impact
warning *for the skipped steps* — but retains it if any payment-impacting
step is downstream of the failed node.

## Implementation phases

Each phase is independently shippable and testable. PRs land in order.
Everything from phase 1 onward is gated behind
`ENABLE_RESUME_FROM_FAILED_NODE` (default `false`) until rollout completes.

### Phase 0 — Schema foundations + feature flag

**PR-R0.** Migration + backfill + flag definition. No behavior change for
existing flows.

- Migration `supabase/migrations/{date}_add_resume_lineage_columns.sql`:
  - `ALTER TABLE workflow_execution_sessions ADD COLUMN root_execution_id uuid`
  - `ALTER TABLE workflow_execution_sessions ADD COLUMN workflow_definition_hash text`
  - Backfill: `UPDATE workflow_execution_sessions SET root_execution_id = id::uuid WHERE root_execution_id IS NULL` — follows the `session_side_effects` precedent of treating session ids as valid uuid strings (the `id` column is `text` in the migration's create branch, but real-world ids are uuid-formatted; the FK pattern in `session_side_effects` already relies on this).
  - Add index `idx_wes_root_execution_id` on `(root_execution_id)` for lineage queries.
  - No index on `workflow_definition_hash` — low cardinality, only read after a single-row session lookup.
- Feature flag added to [`lib/featureFlags.ts`](../../lib/featureFlags.ts):
  - `ENABLE_RESUME_FROM_FAILED_NODE` — `false` default.
  - `RESUME_FROM_FAILED_NODE_WINDOW_DAYS` — int, `7` default.
- No engine, handler, API, or UI code changes in this phase.

**Tests:** migration applies cleanly on a copy of production schema; backfill is idempotent (re-running leaves rows unchanged). Feature flag default verified via unit test.

### Phase 1 — Lineage threading (Q4 + Stripe header)

**PR-R1a.** Engine writes lineage; handlers read it.

- [`AdvancedExecutionEngine.createExecutionSession`](../../lib/services/advancedExecutionEngine.ts):
  - Compute `workflow_definition_hash` from workflow nodes/edges.
  - On retry path: read `original.root_execution_id` and propagate; set
    `workflow_definition_hash` from current workflow.
  - On non-retry path: `root_execution_id = newId` (the freshly created
    UUID), `workflow_definition_hash = current hash`.
- [`HandlerExecutionMeta`](../../lib/workflows/actions/core/idempotencyKey.ts):
  add `rootExecutionId?: string`. `executionSessionId` stays for backward
  compat / debugging but is not used for the key.
- [`buildIdempotencyKey`](../../lib/workflows/actions/core/idempotencyKey.ts):
  use `rootExecutionId` if present, else fall back to `executionSessionId`
  (so older calls without lineage continue to work during rollout).
- [`formatProviderIdempotencyKey`](../../lib/workflows/actions/core/idempotencyKey.ts):
  unchanged signature; the underlying `SideEffectKey.executionSessionId`
  field is now populated from lineage. (Internal renaming optional.)
- Engine threads `rootExecutionId` into every `HandlerExecutionMeta`
  construction site. The 14 Stripe handlers and Shopify handler pick this up
  automatically because they build meta from `context`.
- `session_side_effects` table — dual-write + read-fallback migration:
  - Add `root_execution_id uuid NULL` column (nullable initially so writes
    can proceed before backfill is verified). Migration:
    `supabase/migrations/{date}_add_root_to_session_side_effects.sql`.
  - Backfill existing rows: `UPDATE session_side_effects SET root_execution_id = execution_session_id WHERE root_execution_id IS NULL`.
  - **Dual-write phase:** `recordFired()` writes both `execution_session_id` (from current session) and `root_execution_id` (from lineage root). `checkReplay()` reads by `(root_execution_id, node_id, action_type)` first; on miss, falls back to `(execution_session_id, node_id, action_type)` and emits a structured log (`q4_lineage_fallback_hit` with session+root+node+action). Fallback hits are expected to drop to zero within one release cycle as backfill completes and dual-writes catch up.
  - **Index:** add `(root_execution_id, node_id, action_type)` non-unique index for the lookup.
  - **UNIQUE constraint** on `(execution_session_id, node_id, action_type)` is preserved during dual-write. A separate unique index on `(root_execution_id, node_id, action_type)` is **not** added yet — would block legitimate retry writes that share a root.
  - One full release cycle later (PR-R1b), drop the fallback read path and the `execution_session_id` UNIQUE constraint, replacing it with `(root_execution_id, node_id, action_type)` UNIQUE. PR-R1b is gated on the fallback log emitting zero hits over the observation window.

**Tests:**
- `__tests__/workflows/q4-lineage.test.ts` — new run + retry share root id
  → second run's handler call hits cache via root lookup.
- `__tests__/workflows/q4-fallback-read.test.ts` — row written before
  rollout (no `root_execution_id`) is still found via session-id fallback;
  fallback emits the expected log line.
- `__tests__/workflows/stripe-idempotency-lineage.test.ts` — Stripe header
  formed from root id; verifies same value across retries.
- Existing Q4 tests should pass without modification (lineage = sessionId
  for non-retry runs).

**Rollback plan:** if PR-R1a misbehaves, the read-fallback path means
existing session-scoped Q4 records are still discoverable. If lineage
threading is wrong, retries simply degrade to today's behavior (full rerun
re-fires upstream). The new column is nullable, so no row inserts fail.

### Phase 2 — Engine resume entry point

**PR-R2.** New engine method; not yet exposed.

- New method `executionEngine.resumeFromFailedNode({ originalSessionId, fromNodeId, userId })`:
  1. Load original session + verify ownership + status.
  2. Load `execution_steps` for original session, filter
     `status = 'completed'`.
  3. Load workflow + recompute hash; reject if mismatch.
  4. Walk the DAG from the trigger; identify the set of nodes "successfully
     completed and on the path to `fromNodeId`". These get pre-populated
     into `DataFlowManager.nodeOutputs` from
     `execution_steps.output_data`.
  5. Create a new session with `root_execution_id = original.root_execution_id`,
     `workflow_definition_hash = current hash`, `source = 'resume'`,
     `retry_of = originalSessionId`.
  6. Pass a new `traversalStartNodes = [fromNodeId]` parameter to the engine
     loop; existing logic for visiting connected nodes is unchanged from
     `fromNodeId` onwards.
  7. Each `execution_steps` row for skipped nodes is recorded with
     `status = 'skipped'` and a back-reference to the original step id, so
     the new run's history is complete.
- Keep Q4 active for all invoked nodes — defense in depth.

**Tests:**
- `__tests__/workflows/resume-engine.test.ts`:
  - 3-node workflow, node 2 fails → resume → node 1 skipped, node 2 + 3
    executed.
  - DataFlowManager has node 1's output before node 2 runs (verified via
    a `{{node_1.field}}` reference in node 2's config).
  - Workflow hash mismatch → reject.
  - Original session unmodified after resume.

### Phase 3 — Billing + cost preview support

**PR-R3.** Resume-aware deduction primitives. **Lands before phase 4** so
the resume API cannot exist without correct deduction wired in.

- `lib/workflows/cost-preview.ts`: `computeCostPreview()` accepts an
  optional `fromNodeId` parameter. When set, walks the DAG from that node
  forward and includes only reachable nodes in the cost calculation.
  Skipped nodes contribute zero. Loop-cost expansion (controlled by the
  existing `ENABLE_LOOP_COST_EXPANSION` flag) is honored on the
  resume-subgraph too.
- `lib/workflows/taskDeduction.ts`: new `deductTasksForResume()` wrapper
  (or extended params on `deductTasksAtomic`) that:
  - sets `event_type = 'workflow_execution_resume'`
  - sets `source = 'resume'` for analytics
  - sets `metadata = { original_execution_id, root_execution_id, from_node_id, skipped_node_ids }`
  - uses a fresh `execution_id` for ledger-idempotency (the row is its
    own unit of work; resume never replays the original ledger row).
- `task_billing_events` UNIQUE constraint already covers
  `(user_id, execution_id, event_type)` — the new event_type plus a fresh
  `execution_id` means a resume cannot collide with the original run's
  ledger row.
- Cost preview endpoint
  [app/api/workflows/[id]/preview-cost/route.ts](../../app/api/workflows/[id]/preview-cost/route.ts)
  accepts optional `fromNodeId` and surfaces both `flatCost` and `totalCost`
  for the subgraph. When the flag is off, `fromNodeId` is silently
  ignored (returns full-workflow preview).
- Reconciliation script
  [scripts/reconcile-billing-metadata.sql](../../scripts/reconcile-billing-metadata.sql)
  updated to include the new event_type in the parity invariant.

**Tests:**
- `__tests__/workflows/cost-preview-resume.test.ts` — 4-node workflow,
  `fromNodeId = node_3`, returns cost of nodes 3 + 4 only; loop-expansion
  edge cases (loop fully upstream of `fromNodeId` → contributes 0; loop
  containing `fromNodeId` → not exercised here, blocked at API layer).
- `__tests__/billing/resume-deduction.test.ts` — resume of a 4-node failed
  run charges only the unfinished nodes, original run's ledger row is
  untouched, parity invariant holds across the new event_type.

### Phase 4 — Resume API + execute route mode

**PR-R4.** API surface that ties phases 1-3 together. Returns 404 when
flag is off so external callers cannot probe.

- New endpoint `POST /api/executions/[executionId]/resume`:
  - **First check:** if `ENABLE_RESUME_FROM_FAILED_NODE` is `false`, return
    `404 Not Found` immediately. No body, no error shape — endpoint
    appears not to exist.
  - Validates (when flag is on): status, ownership, hash match,
    `firstFailedNodeId` present and currently exists, failed node not
    inside a loop, no partially-completed loop in the prior run, within
    the eligibility window (`now() - original.completed_at <=
    RESUME_FROM_FAILED_NODE_WINDOW_DAYS days`).
  - Returns standardized error codes for each failure case:
    `WORKFLOW_DEFINITION_CHANGED`, `FAILED_NODE_INSIDE_LOOP`,
    `LOOP_PARTIALLY_COMPLETED`, `RESUME_WINDOW_EXPIRED`,
    `NO_RESUMABLE_NODE`, `ALREADY_RESUMED`.
  - On success, forwards to `/api/workflows/execute` with
    `mode: 'resume'`, `originalSessionId`, `fromNodeId`.
- `/api/workflows/execute` accepts `mode`, `originalSessionId`,
  `fromNodeId`. When `mode === 'resume'` and the flag is on, calls the
  new engine entry point instead of standard execution. When the flag is
  off, treats `mode === 'resume'` as an unknown parameter and falls
  through to standard execution (defense in depth — the API layer is the
  primary gate).
- Existing `/api/executions/[executionId]/retry` is unchanged.

**Tests:**
- `__tests__/api/resume-endpoint.test.ts` covering each error code, success
  path, the auth/billing forwarding, the 404-when-flag-off case, and the
  loop / window / hash gates.

### Phase 5 — UI: two-button retry dialog

**PR-R5.** [`ExecutionHistoryModal.tsx`](../../components/workflows/ExecutionHistoryModal.tsx)
+ [`ClassifiedErrorCard.tsx`](../../components/workflows/ClassifiedErrorCard.tsx).

- ExecutionHistoryModal:
  - Compute `canResume` from session + workflow hash + steps.
  - Render second button "Resume from failed step" when `canResume`.
  - New AlertDialog copy: "Only the [N] remaining steps will run.
    Previously completed steps are skipped." Heightened payment warning
    only if a payment-impacting step exists *downstream* of the failed
    node (reuses `isPaymentImpactingNodeType` against the resumed subgraph).
  - Calls `POST /api/executions/[id]/resume`.
- ClassifiedErrorCard: when `canResume`, the `open_node` action's CTA gets
  a sibling "Resume from failed step" CTA. The `firstFailedNodeId` field
  becomes load-bearing.
- New small component
  `components/workflows/RetryModePicker.tsx` to keep the two-button block
  reusable across the modal and the card.

**Tests:**
- Component tests for the modal verifying the button shows/hides under
  each precondition.
- Visual: light + dark mode pass per CLAUDE.md §7.

### Phase 6 — Provider-by-provider safety review

**PR-R6.** Audit + targeted fixes.

For each payment / side-effecting handler, confirm:
1. Idempotency key flows through `buildIdempotencyKey(meta)` (no inline
   construction).
2. Provider-native idempotency header (where supported) uses
   `formatProviderIdempotencyKey`.
3. Q4 `checkReplay` happens before any provider write.

Targets:
- Stripe (14 handlers under `lib/workflows/actions/stripe/`) — verify all
  go through the helper.
- Shopify — same, plus add idempotency headers if the GraphQL endpoint
  supports them (it does for some mutations via `Idempotency-Key` extension).
- Square / PayPal — handlers do not exist yet. Add a CLAUDE.md note that
  any new payment provider must follow the lineage pattern from day one.
- Non-payment but high-cost: Discord webhook, Slack message, Twilio SMS,
  Resend email — same audit, same pattern.

**Tests:** integration test suite per provider that calls the same handler
twice with the same `rootExecutionId` and asserts only one provider call
fires.

### Phase 7 — Feature flag + rollout

**PR-R7.** Gate everything behind `ENABLE_RESUME_FROM_FAILED_NODE`.

- Flag added to [`lib/featureFlags.ts`](../../lib/featureFlags.ts).
- Default `false`. UI hides the second button when off. API endpoint
  returns 404 when off (so external callers cannot probe).
- Rollout sequence:
  1. Internal accounts only (`super_admin` capability check).
  2. 1% via user_id hash.
  3. 10%.
  4. 100%.
- Observability: emit one metric per resume — `resume.executed`,
  `resume.blocked.{reason}`, `resume.idempotency_hit_count`. Dashboard
  watches the idempotency hit count vs. fresh fire count to confirm Q4 is
  doing its job.

**Tests:** feature-flag test asserting all behavior is gated.

## File-level change inventory

| File | Phase | Change type |
|---|---|---|
| `supabase/migrations/{date}_add_resume_lineage_columns.sql` | 0 | NEW |
| `supabase/migrations/{date}_add_root_to_session_side_effects.sql` | 1 | NEW |
| `lib/services/advancedExecutionEngine.ts` | 1, 2 | EDIT |
| `lib/services/workflowExecutionService.ts` | 2 | EDIT |
| `lib/services/nodeExecutionService.ts` | 2 | EDIT |
| `lib/workflows/dataFlowContext.ts` | 2 | EDIT (add `seedNodeOutputs` method) |
| `lib/workflows/actions/core/idempotencyKey.ts` | 1 | EDIT |
| `lib/workflows/actions/core/sessionSideEffects.ts` | 1 | EDIT (lookup by root) |
| `lib/workflows/cost-preview.ts` | 4 | EDIT (accept `fromNodeId`) |
| `lib/workflows/taskDeduction.ts` | 4 | EDIT (new event_type) |
| `app/api/workflows/execute/route.ts` | 3 | EDIT (mode dispatch) |
| `app/api/workflows/[id]/preview-cost/route.ts` | 3 | EDIT |
| `app/api/executions/[executionId]/resume/route.ts` | 3 | NEW |
| `components/workflows/ExecutionHistoryModal.tsx` | 5 | EDIT |
| `components/workflows/ClassifiedErrorCard.tsx` | 5 | EDIT |
| `components/workflows/RetryModePicker.tsx` | 5 | NEW |
| `lib/featureFlags.ts` | 7 | EDIT |
| `learning/docs/handler-contracts.md` | 1 | EDIT (Q4 contract: lineage) |
| `learning/docs/safe-resume-from-failed-node-project.md` | 7 | EDIT (mark shipped) |
| `CLAUDE.md` §6, §10 | 1, 7 | EDIT |
| `scripts/reconcile-billing-metadata.sql` | 4 | EDIT |

## Open questions for review

Before I start phase 0, I'd like your call on:

1. **Resume eligibility window.** Today's full retry has no window — you can
   retry a year-old failed run. For resume, the underlying provider state
   may have drifted (a Stripe customer was deleted, a Slack channel
   archived). Do we cap resume at e.g. 7 days post-failure? Or leave
   unbounded and let provider errors surface?

2. **Loop nodes.** Phase 1 hides resume when the failed node is *inside* a
   loop. But what about a failed node that sits *after* a loop that
   completed successfully? The completed loop's output replays from
   `execution_steps.output_data`. I believe this is safe; confirming.

3. **AI agent + dynamic templates.** The AI agent action persists no
   checkpoints today. Skip-with-replay (D2 Option A) gives downstream nodes
   the cached output without re-calling the LLM. Confirming this is desired
   — alternative is to force AI-agent-bearing workflows to use full retry.

4. **Resume after partial loop.** If a loop completed 7 of 10 iterations
   then a downstream node failed: resume from the downstream node, the loop
   is treated as a single completed unit (its full output array is
   replayed). Confirming this is the right granularity.

5. **Phase ordering.** Phases 0-2 are pure plumbing with no user-visible
   change. Phase 3 exposes the API but UI is gated. Phase 5 is the
   user-visible one. Acceptable to merge phases 0-2 and observe for a
   week before opening phase 3?

## Verification plan (end-to-end, post-phase-7)

1. **Happy path.** 3-node workflow: Stripe charge → Slack notify →
   Gmail send. Force Slack to fail. Click "Resume from failed step".
   Confirm:
   - Stripe is **not** called again (check Stripe dashboard test mode).
   - Slack and Gmail are called.
   - New session row exists with `source = 'resume'`,
     `root_execution_id = original.root_execution_id`.
   - `execution_steps` for the new session shows node 1 as `skipped`,
     nodes 2 and 3 as `completed`.
   - `task_billing_events` has one row for original (3 tasks) and one
     row for resume (2 tasks).

2. **Definition-changed block.** Edit the workflow between failure and
   resume. Confirm UI hides the resume button and the API returns
   `WORKFLOW_DEFINITION_CHANGED`.

3. **Loop-inside block.** Workflow with a loop containing the failed
   node. Confirm resume is hidden, full retry still works.

4. **Q4 cross-session test.** Manually call the same handler twice with
   the same `rootExecutionId` (via test harness). Confirm one provider
   call, one `session_side_effects` row, second call returns cached
   result.

5. **Reconciliation.** Run
   [scripts/reconcile-billing-metadata.sql](../../scripts/reconcile-billing-metadata.sql)
   after a resume. Confirm the parity invariant holds with the new
   `workflow_execution_resume` event type.

## Estimated effort

Rough order-of-magnitude, not a commitment:

- Phase 0: 0.5 day
- Phase 1: 2-3 days (lineage threading + Q4 lookup change is the
  trickiest part because it touches many handlers)
- Phase 2: 2-3 days
- Phase 3: 1-2 days
- Phase 4: 1-2 days
- Phase 5: 2 days
- Phase 6: 1-2 days (mostly audit, some fixes)
- Phase 7: 0.5 day

Total: ~12-16 working days for one engineer, sequential. Phases 5 and 6
can parallelize with phase 4 once 1-3 land.
