# Safe Resume-From-Failed-Node — Implementation Plan

**Status:** **Phases 0 + 1 (PR-R1a) shipped 2026-05-04. Phase 2+ paused
2026-05-04** — blocked on
[v2 canonical execution engine consolidation](./v2-canonical-execution-engine-plan.md).

Phase 2 was originally going to add `resumeFromFailedNode` to v1's
`AdvancedExecutionEngine`. Mid-implementation we discovered the codebase
has two parallel execution engines and that v2 owns the `execution_steps`
table that resume depends on. Rather than dual-build, the project pauses
until v2 becomes the canonical engine. PR-R1a's two migrations
(`20260506000000`, `20260507000000`) and PR-R1a's code (lineage threading
on v1, helpers in `lib/execution/sessionLineage.ts`, idempotency key
update, workflow definition hash, Q4 dual-write + read-fallback) all
remain in place — the schema and helpers are engine-agnostic and
survive the consolidation.

After v2 cutover lands, Phase 2 resumes targeting v2 directly. Several
sections below (engine target, file paths, test surface) will need
revision at that time — they currently reference v1 paths.

All work gated behind feature flag `ENABLE_RESUME_FROM_FAILED_NODE`
(default `false`) through full rollout. Companion to
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
- 2026-05-04: round 2 review added the v2 history API contract under
  Phase 5 — list endpoint exposes `rootExecutionId` +
  `workflowDefinitionHash`; detail endpoint adds `graphNodeId` for
  resume eligibility lookups.
- 2026-05-04: **Phase 0 shipped to prod.** Migration
  `20260506000000_add_resume_lineage_columns.sql` applied; backfill
  clean (12/12 sessions), `idx_wes_root_execution_id` present.
- 2026-05-04: **Phase 1 / PR-R1a shipped (commits 1-7).** Migration
  `20260507000000_add_root_to_session_side_effects.sql` applied to
  prod. Engine writes lineage; meta threads through to handlers; Q4
  dual-writes both id columns and reads root-first with structured
  fallback log. 1154 tests green across 69 suites; no regressions.
  Engine path corrected from `lib/services/` → `lib/execution/` in
  this doc. Test inventory consolidated into existing test files.
  PR-R1b is now observation-gated on `q4_lineage_fallback_hit` log
  reaching zero.
- 2026-05-04: **v2 lineage threading shipped (Phase 2 of v2 canonical
  engine plan, not this plan's Phase 2).** PR-R1a's lineage helpers +
  schema were always engine-agnostic; v2 now writes the same columns
  on session insert and threads `rootExecutionId` through all 7 of
  its meta-construction sites. Tests at
  [`__tests__/workflows/v2-q4-lineage.test.ts`](../../__tests__/workflows/v2-q4-lineage.test.ts).
  This unblocks the future v2-targeted resume work — when this plan's
  Phase 2 resumes, both schema and lineage threading are already in
  place on v2, so `seedNodeOutputs` + `executionEngine.resumeFromFailedNode`
  build on a working foundation.

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

- [`AdvancedExecutionEngine.createExecutionSession`](../../lib/execution/advancedExecutionEngine.ts):
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

**Tests (as actually shipped — consolidated into existing files):**
- `__tests__/workflows/sessionSideEffects.test.ts` — extended from 28 → 35
  tests covering:
  - `buildIdempotencyKey — PR-R1a retry lineage`: root preserved when
    supplied; falls back to `executionSessionId` when missing/empty.
  - `formatProviderIdempotencyKey`: renders from rootExecutionId; uses
    root (not session) on retries; pre-PR-R1a callers see no behavior
    change.
  - `checkReplay — PR-R1a lineage read`: cross-session dedup via root;
    fallback to `execution_session_id = key.rootExecutionId` for
    pre-rollout rows; fresh-run gap-window replay covered by fallback;
    no fallback log when both reads miss; mismatch via root lookup.
  - `recordFired` PR-R1a dual-write: retry-context fire writes both id
    columns with different values.
- `__tests__/workflows/engine-create-session-lineage.test.ts` — 16 tests
  on the pure helpers in `lib/execution/sessionLineage.ts`: fresh
  vs retry root resolution, retry-of-a-retry stability, pre-Phase-0
  fallback, lookup error fall-through, hash null on missing/cyclic data,
  volatile UI fields ignored.
- Existing Q4 tests pass without modification (lineage = sessionId for
  non-retry runs).

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

### Phase 5 — UI: two-button retry dialog + v2 history API contract

**PR-R5.** [`WorkflowHistoryDialog.tsx`](../../components/workflows/builder/WorkflowHistoryDialog.tsx)
(the live builder history UI) + [`ClassifiedErrorCard.tsx`](../../components/workflows/ClassifiedErrorCard.tsx),
plus the v2 history API endpoints that feed the dialog.

> Plan revisions: phase 5 originally targeted `ExecutionHistoryModal.tsx`.
> The live UI shipped to users is `builder/WorkflowHistoryDialog.tsx` —
> that's the file to change. Round-2 review also added the v2 history API
> contract below, since the UI computes `canResume` client-side and needs
> the backing data exposed.

**v2 history API changes:**

- [`app/(app)/workflows/v2/api/flows/[flowId]/runs/history/route.ts`](../../app/(app)/workflows/v2/api/flows/[flowId]/runs/history/route.ts)
  (list endpoint):
  - Extend the `SELECT` to include `root_execution_id` and
    `workflow_definition_hash` (both nullable; resume is only offered when
    they're non-null).
  - Add to the `FlowRunSummary` response:
    `rootExecutionId: s.root_execution_id || null`,
    `workflowDefinitionHash: s.workflow_definition_hash || null`.
  - `error_classification.firstFailedNodeId` is already included via the
    existing `errorClassification` passthrough — no change needed.
- [`app/(app)/workflows/v2/api/runs/[runId]/nodes/route.ts`](../../app/(app)/workflows/v2/api/runs/[runId]/nodes/route.ts)
  (detail endpoint):
  - The current mapping at line 54 sets `node_id: s.node_name || s.node_type || s.node_id` — that's a display label, not the graph node id. Resume eligibility checks (does `firstFailedNodeId` still exist? is it inside a loop? is any loop partially completed?) need the **graph node id** to match against the current workflow definition.
  - Add a sibling field `graphNodeId: s.node_id` to the response. Keep
    the existing `node_id` field for backward compat (it remains the
    display label).
  - No new column reads required — `execution_steps.node_id` is already
    selected.
  - Existing `status` and `output_data` fields are sufficient for the
    UI to detect "did at least one upstream node succeed" and "is any
    loop step in a partially-completed state."

**UI:**

- WorkflowHistoryDialog:
  - Compute `canResume` from session + workflow hash + steps + window.
    Mirror the API's eligibility predicates so the button never appears
    for a request the API will reject.
  - Render second button "Resume from failed step" when `canResume`.
  - New AlertDialog copy: "Only the [N] remaining steps will run.
    Previously completed steps are skipped." Heightened payment warning
    only if a payment-impacting step exists *downstream* of the failed
    node (reuses `isPaymentImpactingNodeType` against the resumed
    subgraph).
  - Calls `POST /api/executions/[id]/resume`. When the API returns 404
    (flag off), the button is not rendered in the first place — so this
    path should be unreachable in practice.
- ClassifiedErrorCard: when `canResume`, the `open_node` action's CTA gets
  a sibling "Resume from failed step" CTA. The `firstFailedNodeId` field
  becomes load-bearing.
- New small component
  `components/workflows/RetryModePicker.tsx` to keep the two-button block
  reusable across the dialog and the card.

**Tests:**
- Component tests for the dialog verifying the button shows/hides under
  each precondition (no successful upstream step, hash mismatch, loop
  failure, partially completed loop, expired window, flag off, missing
  `rootExecutionId` or `workflowDefinitionHash` on the run).
- API contract tests for the new fields on both endpoints.
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

### Phase 7 — Rollout

**PR-R7.** Phased rollout of the feature flag (defined in phase 0).

- Flag and window env var already exist from phase 0; behavior already
  gated by API + UI from phases 4 + 5.
- Rollout sequence:
  1. Internal accounts only (`super_admin` capability check) — flip flag
     `true` only for admin users.
  2. 1% via user_id hash.
  3. 10%.
  4. 100%.
- Observability: emit one metric per resume — `resume.executed`,
  `resume.blocked.{reason}`, `resume.idempotency_hit_count`,
  `q4_lineage_fallback_hit`. Dashboard watches the idempotency hit count
  vs. fresh fire count to confirm Q4 is doing its job, and the fallback
  count to confirm phase 1's read-fallback can be retired.
- After 100% rollout holds for one week with no incidents:
  - Land **PR-R1b**: drop Q4 read-fallback, swap UNIQUE constraint to
    `(root_execution_id, node_id, action_type)`.
  - Update [project doc](./safe-resume-from-failed-node-project.md) status
    from "in progress behind feature flag" to "shipped".
  - Update CLAUDE.md §10 to remove the "do not start without explicit
    go-ahead" note for this project.

**Tests:** feature-flag test asserting all paths gate correctly when the
flag is off (404 from API, button hidden in UI).

## File-level change inventory

| File | Phase | Change type |
|---|---|---|
| `supabase/migrations/{date}_add_resume_lineage_columns.sql` | 0 | NEW |
| `supabase/migrations/{date}_add_root_to_session_side_effects.sql` | 1 | NEW |
| `lib/execution/advancedExecutionEngine.ts` | 1, 2 | EDIT |
| `lib/execution/sessionLineage.ts` | 1 | NEW (extracted helpers, testable in isolation) |
| `lib/services/workflowExecutionService.ts` | 2 | EDIT |
| `lib/services/nodeExecutionService.ts` | 2 | EDIT |
| `lib/workflows/dataFlowContext.ts` | 2 | EDIT (add `seedNodeOutputs` method) |
| `lib/workflows/actions/core/idempotencyKey.ts` | 1 | EDIT |
| `lib/workflows/actions/core/sessionSideEffects.ts` | 1 | EDIT (lookup by root, dual-write, fallback log) |
| `lib/workflows/executeNode.ts` | 1 | EDIT (thread `rootExecutionId` into `handlerMeta`) |
| `lib/workflows/workflowDefinitionHash.ts` | 1 | NEW (pure helper) |
| `__tests__/workflows/workflowDefinitionHash.test.ts` | 1 | NEW (26 tests) |
| `__tests__/workflows/engine-create-session-lineage.test.ts` | 1 | NEW (16 tests on extracted helpers) |
| `__tests__/workflows/sessionSideEffects.test.ts` | 1 | EDIT (lineage cases, dual-write, fallback) |
| `__tests__/nodes/gmail-send-email.test.ts` | 1 | EDIT (key shape now includes `rootExecutionId`) |
| `__tests__/nodes/outlook-send-email.test.ts` | 1 | EDIT (key shape now includes `rootExecutionId`) |
| `lib/workflows/cost-preview.ts` | 4 | EDIT (accept `fromNodeId`) |
| `lib/workflows/taskDeduction.ts` | 4 | EDIT (new event_type) |
| `app/api/workflows/execute/route.ts` | 1, 3 | EDIT (phase 1: pass `retryOf` to engine; phase 3: mode dispatch) |
| `app/api/workflows/[id]/preview-cost/route.ts` | 3 | EDIT |
| `app/api/executions/[executionId]/resume/route.ts` | 3 | NEW |
| `components/workflows/builder/WorkflowHistoryDialog.tsx` | 5 | EDIT |
| `app/(app)/workflows/v2/api/flows/[flowId]/runs/history/route.ts` | 5 | EDIT (expose `rootExecutionId`, `workflowDefinitionHash`) |
| `app/(app)/workflows/v2/api/runs/[runId]/nodes/route.ts` | 5 | EDIT (add `graphNodeId` field) |
| `components/workflows/ClassifiedErrorCard.tsx` | 5 | EDIT |
| `components/workflows/RetryModePicker.tsx` | 5 | NEW |
| `lib/featureFlags.ts` | 0 | EDIT (flag + window env var) |
| `learning/docs/handler-contracts.md` | 1 | EDIT (Q4 contract: lineage) |
| `learning/docs/safe-resume-from-failed-node-project.md` | 7 | EDIT (mark shipped) |
| `CLAUDE.md` §6, §10 | 1, 7 | EDIT |
| `scripts/reconcile-billing-metadata.sql` | 4 | EDIT |

## Resolved decisions (from 2026-05-04 review)

| Question | Decision |
|---|---|
| Eligibility window | 7 days from original failure timestamp; configurable via `RESUME_FROM_FAILED_NODE_WINDOW_DAYS`. |
| Failed node inside a loop | Resume hidden. Full retry only. |
| Partially-completed loop in prior run | Resume hidden — loop must be a single fully-completed step record to be replayed as a unit. |
| Completed loop upstream of failed node | Replayed as one unit from `execution_steps.output_data`. |
| AI agent on resume | Cached output replayed; LLM is **not** called again. |
| Phase ordering | Billing (phase 3) lands before or with the resume API (phase 4). API is gated by flag and returns 404 when off. |
| Q4 migration | Dual-write `root_execution_id` + `execution_session_id`. Read root first, fall back to session for one release cycle, log fallback hits. `uuid` type, matching the `session_side_effects` precedent. |
| Project doc status | "In progress behind feature flag" until rollout completes; flipped to "shipped" only after PR-R1b lands and 100% holds for a week. |

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
