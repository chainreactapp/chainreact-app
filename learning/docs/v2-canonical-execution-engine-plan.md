# Make v2 the Canonical Execution Engine

**Status:** Approved 2026-05-04. **Phase 1 audit in progress.** All work
gated behind feature flag `ENABLE_V2_LIVE_EXECUTION` (default `false`)
until staged rollout completes.

**Decided priority:** This project blocks
[safe-resume-from-failed-node-implementation-plan.md](./safe-resume-from-failed-node-implementation-plan.md)
Phase 2+. PR-R1a (lineage threading on v1) shipped 2026-05-04 and remains
in place; further resume work paused pending v2 cutover.

## Revisions log

- 2026-05-04: **PR-V2-WEBHOOK-DISCORD-INVITE shipped (first of 10 direct-caller migrations).** Migrated [`lib/services/discordInviteTracker.ts`](../../lib/services/discordInviteTracker.ts) — Discord member-join entry path — off direct `AdvancedExecutionEngine` instantiation onto the unified webhook dispatcher (`executeWebhookWorkflow`). Chose **Option B (delegation)** over Option A (inline-replicated dispatch): replaces the in-place `new AdvancedExecutionEngine() / createExecutionSession / executeWorkflowAdvanced` block with one call to the unified dispatcher, so v1/v2 dispatch + billing + dedup all live in one file. Extracted `dispatchMemberJoinWorkflow(workflow, member, triggerData, inviteCode)` at module scope so the dispatch path is testable without standing up the singleton's Discord client. **Audit Q4 dedup gap closed for this entry path:** dedupeKey = `${guildId}:${memberId}:${joinedAtISO}` with fallback chain `member.joinedAt?.toISOString() → triggerData.timestamp → 'unknown'`. 9 tests at [`__tests__/services/discordInviteTracker-v2-dispatch.test.ts`](../../__tests__/services/discordInviteTracker-v2-dispatch.test.ts) (dispatch contract / dedupeKey fallback chain / error handling preserves loop). No new TypeScript errors introduced — 2 pre-existing remain at shifted lines. **Note:** the file is dormant in production today (no `.initialize()` callers in the repo); migration future-proofs it for re-activation. Validates the migration template for the remaining 9 direct-caller PRs, with the explicit precedent that delegation-to-dispatcher is preferred when the caller fits the "this is webhook-triggered execution" shape.
- 2026-05-04: project approved with decisions:
  - **Billing gate** lifts into `WorkflowExecutionService` (or a shared
    billing-guard helper called by it) so every execution entry path
    (live, sandbox, webhook, scheduled) gets billing for free. No more
    duplicating the gate at each route.
  - **Per-user opt-in mechanism** is `user_profiles.opt_in_v2_execution`
    boolean (default false), settable only by `super_admin`. Used in
    Phase 5 stages 1-2 to gate the v2 live path before global rollout.
  - **Error-classification parity is asymmetric.** v1 will not gain
    `execution_steps` writing. Phase 4 parity tests treat error
    classification as "v2 produces it, v1 doesn't" — that gap closes
    automatically when v1 is deleted in Phase 5.
- 2026-05-04: project guidance recorded:
  - **Do not add new responsibilities to v1.**
  - **Do not build resume-from-failed-node on v1.**
  - Resume Phase 2+ stays paused until v2 is unquestionably the target
    engine (Phase 5 stage 3 or later — when the global flag has flipped
    to v2 default).
- 2026-05-04: **PR-V2C shipped (registry fallback for v2 integration
  handlers).** v2 was throwing on ~130 node types absent from explicit
  switch cases (Stripe, Shopify, GitHub, Twitter, Mailchimp, ManyChat,
  Gumroad, Monday.com + partial coverage gaps in HubSpot, OneDrive,
  Trello, Teams, Notion, Airtable). New helper at
  [lib/services/executionHandlers/registryFallback.ts](../../lib/services/executionHandlers/registryFallback.ts)
  routes unknown node types through `executeAction` (the v1 registry
  dispatch path). All `default:` branches across `IntegrationNodeHandlers`,
  `ActionNodeHandlers`, `AIActionsService`, plus the per-provider services
  (`Gmail`, `Slack`, `Google`) and the seven sub-dispatchers (OneNote,
  Discord, Airtable, Notion, Trello, HubSpot, Excel) now use the
  fallback. **Test-mode safety:** fallback short-circuits with a
  `{ __testModeFallback: true }` mock when `context.testMode === true`,
  so zero real provider calls happen via the fallback in test mode. 10
  tests added in
  [`__tests__/workflows/v2-integration-fallback.test.ts`](../../__tests__/workflows/v2-integration-fallback.test.ts).
  1164 tests pass; no regressions.
- 2026-05-04: **audit task spawned —
  [v2-explicit-handler-testmode-audit-task.md](./v2-explicit-handler-testmode-audit-task.md).**
  PR-V2C surfaced a pre-existing gap: v2's explicit-case handlers rely on
  per-handler Q8d (`meta?.testMode` early-return) for test-mode safety,
  and only ~12 handlers in `lib/workflows/actions/` implement Q8d. v2's
  `INTERCEPT_WRITES` is post-hoc result decoration, not pre-call
  blocking. The audit task enumerates every explicit dispatch path,
  classifies its protection, and adds parity tests for representative
  cases. Phase 4 (parity tests) of this plan blocks on the audit
  completing.
- 2026-05-04: **audit complete + remediation shipped (engine pre-call
  gate).** Audit found 83 dispatch cases; ~44 lacked any test-mode
  protection (Slack inline, Discord, all 9 Notion routings via
  `managePage`-style wrappers that hardcoded `testMode: false`,
  Airtable update/delete/list, Trello, HubSpot, Excel, OneNote, Outlook
  calendar event, Dropbox upload). Rather than add Q8d to 44 handlers
  (~22 hours of edits), shipped a single engine-level pre-call gate at
  [nodeExecutionService.ts:executeNode](../../lib/services/nodeExecutionService.ts).
  Gate fires when `context.testMode && isExternalAction(nodeType) &&
  actionMode !== EXECUTE_ALL`, returning a `__testModePreCallGate`
  mock without invoking the dispatcher. Also expanded
  `isExternalAction`'s prefix list to cover Notion / Airtable / HubSpot
  / Trello / OneNote / Excel / Stripe / Shopify / GitHub / Mailchimp /
  Twitter / Facebook / ManyChat / Gumroad / Monday / Square / PayPal —
  the original list pre-dated those providers so post-hoc
  `INTERCEPT_WRITES` was silently skipping them too. 14 parity tests at
  [v2-testmode-pregate.test.ts](../../__tests__/workflows/v2-testmode-pregate.test.ts);
  1178 tests pass overall. Findings doc:
  [v2-testmode-audit-findings.md](./v2-testmode-audit-findings.md).
  Per-handler Q8d remains backlog for defense-in-depth.
- 2026-05-04: **PR-V2-CRON shipped (Phase 3 fourth slice — scheduled
  triggers).** The audit classified scheduled cron as "✓ Covered via
  manual route" since `app/api/cron/execute-scheduled-triggers/route.ts`
  POSTs to `/api/workflows/execute`. PR-V2-CRON tightens this:
  (1) cron now passes `executionMode: 'scheduled'` instead of `'live'`,
  so engine-dispatch logs distinguish scheduled traffic from manual on
  the rollout dashboard;
  (2) execute route's v1-fork predicate at the live/sequential branch
  was extended from `executionMode === 'live' || executionMode === 'sequential'`
  to also recognize `'scheduled'` and `'webhook'`. **Bug fix half:**
  without the predicate fix, non-opted-in users with `'scheduled'`
  workflows would fall to the v2 catch-all path, AND the route had
  already billed (different idempotency key from v2's session UUID)
  → double-charge. Now scheduled / webhook modes correctly fork to v1
  when opt-in is false. Default behavior preserved — cron still runs
  on v1 by default. The `'webhook'` predicate inclusion is forward-
  looking for direct-caller webhook ports (PR-V2-WEBHOOK-{name}). 7
  tests at [`v2-cron-dispatch.test.ts`](../../__tests__/workflows/v2-cron-dispatch.test.ts).
  1980 tests pass across 113 suites; no regressions.
- 2026-05-04: **PR-V2-WEBHOOKS shipped (Phase 3 third slice — unified
  webhook dispatcher on v2).** `lib/webhooks/execute.ts:executeWebhookWorkflow`
  — the unified entry point used by `lib/webhooks/processor.ts` + 8
  provider routes (Teams, Shopify, Facebook, GitHub, Gumroad, HubSpot,
  Mailchimp, Microsoft Graph, Monday) — now routes through v2
  (`WorkflowExecutionService`) when both `ENABLE_V2_LIVE_EXECUTION` and
  the workflow owner's `user_profiles.opt_in_v2_execution` are true.
  Otherwise falls through to v1 unchanged. v2 path passes
  `executionOptions: { billingEventType: 'workflow_execution_webhook',
  source: 'webhook' }` so webhook executions produce distinct ledger
  rows. **Decision (architectural):** added an explicit 9th
  `executionOptions: ExecutionOptions` parameter to `executeWorkflow`
  for execution metadata instead of packing into `inputData`. The
  `__retryOf` pattern from Phase 2 stays grandfathered for backward
  compat; new internal metadata lands in `executionOptions`.
  **Critical rollout guardrail (no-v1-fallback):** once v2 has been
  elected, the dispatcher does NOT silently fall back to v1 if v2
  throws or returns `billingFailed: true` — failures surface as
  `{ success: false, error }` so Phase 5 stages see v2 bugs visibly.
  v2 service is lazy-imported (`await import('@/lib/services/...')`)
  inside the dispatch path so v1-only consumers don't pay v2's
  `server-only` + eager-Supabase-client import cost. Dispatch helper
  extended to recognize `'webhook'` and `'scheduled'` as live-eligible
  modes (forward-looking for PR-V2-CRON). 13 webhook dispatch tests
  + 3 no-v1-fallback guardrail tests + 6 helper-mode-gating tests.
  1973 tests pass across 112 suites; no regressions. **Out of scope
  for this PR — follow-up work:** 10 direct `AdvancedExecutionEngine`
  callers that bypass the unified dispatcher (Gmail processor, Google
  processors ×5, Stripe-integration webhook, Dropbox, Microsoft Graph
  worker, Discord invite tracker, Discord gateway, dropboxTriggerHandler,
  workflowManager, workflow-webhooks/[workflowId]/route,
  workflow/[provider]/route). Each migrates in its own PR-V2-WEBHOOK-{name}.
- 2026-05-04: **PR-V2-BILLING shipped (Phase 3 second slice — billing
  gate lift).** New helper [`lib/billing/executionBillingGate.ts`](../../lib/billing/executionBillingGate.ts)
  (`runBillingGate(input): BillingGateOutcome`) wraps billing-scope
  resolution + atomic deduction + auto-buy fire-and-forget into a
  pure-data discriminated-union return. **Required `eventType`
  parameter** typed as `BillingEventType` union; today's callers all
  pass `'workflow_execution'` explicitly, future paths (resume / webhook
  / scheduled) opt into their own values so distinct ledger rows
  separate layered billing on the same execution. `deductTasksAtomic`
  signature extended with optional `options.eventType` (default
  `'workflow_execution'` preserves pre-PR behavior); the metadata-update
  query also filters on `event_type` so distinct event types don't
  smash each other's metadata. **Architecture (Option C):** route runs
  the gate ONLY for v1 path; v2 self-bills inside
  `WorkflowExecutionService.executeWorkflow` using the session UUID as
  the deduction key. v2 returns `{ success: false, billingFailed: true,
  billingOutcome }` on failure; route maps to 402 / 503 in the same
  shape v1 produces. `app/api/workflows/execute-stream/route.ts` (HITL
  stream, v1-only) also refactored to use the helper. Webhook entry
  paths still call v1 directly; once PR-V2-WEBHOOKS migrates them,
  they'll automatically get billing for free — closes the audit's
  pre-existing "webhooks bypass billing" bug. 14 helper tests at
  [`__tests__/billing/executionBillingGate.test.ts`](../../__tests__/billing/executionBillingGate.test.ts)
  + 10 v2-side parity tests at
  [`__tests__/workflows/v2-billing-gate.test.ts`](../../__tests__/workflows/v2-billing-gate.test.ts).
  Existing `billing-gate.test.ts` updated: structural test now asserts
  `runBillingGate` runs before engine execution in both routes plus
  v2's executeWorkflow (replaces the prior `deductTasksAtomic` direct
  check; per-result-type behavior covered by helper-level tests).
  1954 tests pass across 111 suites; no regressions.
- 2026-05-04: **PR-V2-FLAG shipped (Phase 3 first slice — engine
  dispatch).** Adds `FEATURE_FLAGS.V2_LIVE_EXECUTION` (env-controlled
  kill switch) + `user_profiles.opt_in_v2_execution boolean NOT NULL
  DEFAULT false` (per-user opt-in). New pure helper
  [`lib/execution/v2LiveExecutionDispatch.ts`](../../lib/execution/v2LiveExecutionDispatch.ts)
  computes the dispatch decision and a structured log payload
  (`executionEngine: 'v1' | 'v2'`, `executionMode`,
  `v2LiveExecutionEnabled`, `userOptedIntoV2Execution`) so rollout
  dashboards can attribute every workflow run to an engine. Route at
  [`app/api/workflows/execute/route.ts`](../../app/api/workflows/execute/route.ts)
  looks up opt-in once, calls the helper, logs once, and forks the
  live/sequential branch on `useV2`. Sandbox runs hit the helper too
  (so the log covers them) but always report
  `executionEngine: 'v2'` since sandbox runs v2's existing sandbox
  path. Conservative fall-through to v1 on any opt-in lookup error.
  Migration `20260508000000_add_opt_in_v2_execution_to_user_profiles.sql`
  is **not yet applied to prod** — file created, push deferred until
  staged-rollout starts. v2 result-shape mapping (`executionId`
  → `sessionId`) keeps response payload backward-compatible with
  consumers built against v1's shape. 15 tests at
  [`v2-live-dispatch.test.ts`](../../__tests__/workflows/v2-live-dispatch.test.ts)
  cover live × sequential × sandbox × flag × opt-in combinations
  plus the log shape contract. 1929 tests pass across 109 suites; no
  regressions. Default behavior unchanged — flag defaults false, no
  user has the column set, so 100% of live traffic continues on v1.
- 2026-05-04: **Phase 2 shipped (v2 lineage threading).** Mirrors PR-R1a
  on the v2 side. `WorkflowExecutionService.executeWorkflow` now
  generates the session UUID client-side via `randomUUID()` and writes
  both `root_execution_id` and `workflow_definition_hash` on session
  insert (reuses the engine-agnostic helpers in
  [`lib/execution/sessionLineage.ts`](../../lib/execution/sessionLineage.ts)).
  `ExecutionContext` extended with `rootExecutionId?: string`. All 7
  v2 meta-construction sites — `integrationHandlers.ts` (×2),
  `gmailIntegrationService.ts` (×1), `googleIntegrationService.ts`
  (×4: Sheets, Calendar, Drive create, Drive upload) — now thread
  `rootExecutionId: context.rootExecutionId ?? context.executionId`
  into handler `meta`. The brief listed the 2 sites in
  `integrationHandlers.ts`; the 5 per-service sites were discovered
  during the audit and threaded in the same PR. **Decision:** `retryOf`
  rides into `executeWorkflow` inside `inputData.__retryOf` rather
  than a 9th positional param (mirrors v1's context-bag pattern at
  the route layer; extracted + stripped before persistence so engine
  metadata never leaks to handlers). `registryFallback.ts` cleanup:
  `(context as any).rootExecutionId` cast removed since the field is
  now properly typed. 15 parity tests at
  [`v2-q4-lineage.test.ts`](../../__tests__/workflows/v2-q4-lineage.test.ts)
  cover (a) session-insert lineage columns, (b)
  `ExecutionContext.rootExecutionId` population through the engine,
  (c) all 7 meta sites, (d) fallback semantics for legacy contexts
  without lineage. 1914 tests pass across 108 suites; no regressions.
  Forward-looking — v2 sees zero prod traffic today, so lineage gets
  real exercise once Phase 3 ports live execution to v2.

## Context

The codebase has two parallel execution engines that drifted apart
during pre-launch development:

- **v1 — `AdvancedExecutionEngine`** ([lib/execution/advancedExecutionEngine.ts](../../lib/execution/advancedExecutionEngine.ts)).
  Runs all `executionMode === 'live' / 'sequential'` traffic. 100% of
  the 10 prod runs in the last 90 days went through v1.
- **v2 — `WorkflowExecutionService`** ([lib/services/workflowExecutionService.ts](../../lib/services/workflowExecutionService.ts))
  + `NodeExecutionService` + `executionHandlers/`. Runs `sandbox` /
  test-mode traffic only. Zero prod runs in the last 90 days.

The split is at [app/api/workflows/execute/route.ts:506](../../app/api/workflows/execute/route.ts):

```ts
if (executionMode === 'live' || executionMode === 'sequential') {
  // v1
} else {
  // v2
}
```

v2 carries the bigger feature investment: `execution_steps` audit
history, HITL pause/resume, strict pre-resolution (Q2 contract), error
classification (`classifyExecutionFailure`), test-mode action
interception, action-destination preview, mock trigger data registry,
workspace-tier locale/tz resolution (PR-G1, Q12). v1 carries parallel
execution, webhook trigger entry, scheduled trigger entry, billing-gate
integration, circuit-breaker integration, and the retry route.

**Pre-launch is the right moment to consolidate.** Carrying two engines
into production guarantees feature drift (already happening — PR-R1a's
lineage threading covered v1 but skipped v2's `integrationHandlers.ts`,
leaving Q4 dedup broken on v2). It also masks correctness bugs: error
humanization (a recently shipped feature) silently doesn't work on v1
prod runs because v1 doesn't write `execution_steps`.

## Goals

1. **One execution engine: v2** — every executionMode (live, sequential,
   sandbox, test, webhook-triggered, schedule-triggered) runs through
   `WorkflowExecutionService`.
2. **Zero behavior regressions** — billing, circuit breakers, HITL,
   retries, parallel execution, error classification, test mode all keep
   working.
3. **v1 deleted** — `AdvancedExecutionEngine`, `executeWithParallelProcessing`,
   `executeMainWorkflowPath`, the v1 branch in execute/route.ts, the
   webhook entry paths that instantiate v1, and v1-specific tests all
   removed.

## Non-goals

- **Do not port v2 features into v1.** v1 is the deletion target.
- **Do not de-scope HITL.** Must-keep per product decision.
- **Do not continue resume-from-failed-node Phase 2+ on v1.** Paused
  until v2 is canonical.
- **No DataFlowManager rewrite.** v2's `dataFlowContext.ts` survives
  unchanged.
- **No execution_steps schema change.** v2's existing audit table is
  the canonical history.

## Phase 1 — Audit v1-only production responsibilities

**Goal:** complete written enumeration of every production-relevant
behavior currently implemented only in v1, so Phase 3 can port each one
deliberately. No code changes.

**Required outputs (a new doc, e.g. `learning/docs/v1-prod-audit.md`):**

1. **Parallel execution** — v1's `executeWithParallelProcessing` and
   `executeMainWorkflowPath` (BFS queue with `executionQueue` /
   `executedNodeIds`). Document:
   - The exact algorithm.
   - `maxConcurrency` / `enableParallel` semantics.
   - Where `Promise.all` actually fans out (or doesn't — v1 currently
     disables real parallelism per a comment on line 472).
   - Whether v2 will preserve sequential or queue-with-fanout semantics.

2. **Webhook trigger entry** — every `lib/webhooks/*` and
   `app/api/webhooks/*` and `app/api/workflow-webhooks/*` file that
   currently instantiates `AdvancedExecutionEngine`. Concretely:
   - [lib/webhooks/execute.ts](../../lib/webhooks/execute.ts)
   - [lib/webhooks/gmail-processor.ts](../../lib/webhooks/gmail-processor.ts)
   - [lib/webhooks/google-processor.ts](../../lib/webhooks/google-processor.ts)
   - [app/api/microsoft-graph/worker/route.ts](../../app/api/microsoft-graph/worker/route.ts)
   - [app/api/workflow-webhooks/[workflowId]/route.ts](../../app/api/workflow-webhooks/[workflowId]/route.ts)
   - [lib/services/discordInviteTracker.ts](../../lib/services/discordInviteTracker.ts)
   - For each: what trigger data it loads, what session metadata it sets, whether it uses `retryOf`, what billing-scope it stamps.

3. **Scheduled trigger entry** — find the cron / scheduler that fires
   timed workflows. Document the entry function and its v1 call.

4. **Billing gate + circuit breaker** — currently in
   [app/api/workflows/execute/route.ts](../../app/api/workflows/execute/route.ts)
   sitting in front of v1's branch. Document:
   - Cost preview call (`computeCostPreview`)
   - `deductTasksAtomic` invocation, including its idempotency-key shape
     (currently `exec_${workflowId}_${Date.now()}`)
   - The 402 / 503 paths and overage / pack auto-buy flows
   - Circuit-breaker check (`circuit_breaker_tripped_at` on workflows)
   - Rate-limit check
   - Workspace suspension check
   - Where this whole block lives relative to `createExecutionSession`
   - Plan: should the gate move INSIDE `WorkflowExecutionService.executeWorkflow()`
     so non-route entry paths (webhooks, scheduled triggers) get billing
     too? Or stay in the route? **Decision required.**

5. **Retry route** — [app/api/executions/[executionId]/retry/route.ts](../../app/api/executions/[executionId]/retry/route.ts).
   Currently forwards to `/api/workflows/execute` with `retryOf` set.
   That stays unchanged (it's just an API redirect), but Phase 2's
   v2-side handling of `retryOf` needs to mirror what v1 does today.

6. **Provider/node routing differences** —
   v1 routes through `lib/workflows/executeNode.ts:executeAction` →
   action registry. v2 routes through
   [lib/services/executionHandlers/integrationHandlers.ts](../../lib/services/executionHandlers/integrationHandlers.ts)
   (1300 lines, switch on `nodeType`) and
   [actionHandlers.ts](../../lib/services/executionHandlers/actionHandlers.ts).
   For each provider/action that has a v1 path:
   - Which file does v1's handler live in?
   - Does v2's `integrationHandlers.ts` switch case dispatch to the
     same handler function?
   - Are there providers v1 supports that v2 doesn't, or vice versa?

   This is the single biggest correctness risk for the cutover. **Every
   gap discovered here is a follow-up TODO before Phase 5 starts.**

7. **Live-event logging / progress tracker** — v1 calls
   `logExecutionEvent`, writes to `live_execution_events`,
   `ExecutionProgressTracker.update`. Does v2 call any of these? If so,
   v2 already covers; if not, document the gap.

8. **Sub-workflow execution** — v1 has `enableSubWorkflows: true` and
   logic for nested workflow execution. Find the v2 equivalent (or its
   absence).

**Phase 1 ships when:** the audit doc lists every v1 responsibility and
classifies it as ✓ already in v2 / ⚠ gap to port / ❌ deprecating with
v1 / 🔍 needs design.

## Phase 2 — Add v2 lineage threading

**Status: SHIPPED 2026-05-04.** See revisions log for the full summary.

**Goal:** close the v2 Q4 idempotency gap so retries on v2 dedupe like
they do on v1. Required even before Phase 3 because Phase 4's parity
tests will compare retry behavior on both engines.

### Files

| File | Change |
|---|---|
| [lib/services/workflowExecutionService.ts](../../lib/services/workflowExecutionService.ts) | Extend `ExecutionContext` with `rootExecutionId?: string`. Set it from session row in `createExecutionContext`. Mirror Phase-1 v1 logic. |
| [lib/services/executionHandlers/integrationHandlers.ts](../../lib/services/executionHandlers/integrationHandlers.ts) | Two `meta = { executionSessionId: context.executionId, ... }` constructions (currently lines 351-359 and 770-776). Add `rootExecutionId: context.rootExecutionId ?? context.executionId`. |
| Any other v2 meta-construction site | Same fix. |
| v2 session creation | If v2 doesn't already write `root_execution_id` / `workflow_definition_hash` (PR-R1a only updated v1's `createExecutionSession`), add it. Reuse `lib/execution/sessionLineage.ts` helpers — they're pure and engine-agnostic. |

### Tests

- **`__tests__/workflows/v2-q4-lineage.test.ts`** (new) — fresh v2 run +
  retry share root id → second run's handler call hits cache. Mirrors
  the v1 lineage test from PR-R1a.
- Existing v2 tests should pass without modification.

### Phase exit

v2 retry pair dedupes correctly. `q4_lineage_fallback_hit` log silent on
v2 paths. **Met as of 2026-05-04** — observation gate trivially holds
because v2 carries 0 prod retries; the field becomes load-bearing once
Phase 3 ports live traffic.

## Phase 3 — Port live execution to v2 behind a feature flag

**Goal:** add a v2 path for `executionMode === 'live' / 'sequential'`,
gated by a feature flag. v1 stays the default. Internal users can opt in.

### Feature flag

Add to [lib/featureFlags.ts](../../lib/featureFlags.ts):

```ts
/**
 * When true, live and sequential execution modes go through v2
 * (WorkflowExecutionService) instead of v1 (AdvancedExecutionEngine).
 * Default false. Per-user opt-in via super_admin gate during early
 * rollout.
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md
 */
ENABLE_V2_LIVE_EXECUTION: process.env.ENABLE_V2_LIVE_EXECUTION === 'true',
```

Plus a per-user / per-workflow opt-in mechanism — can be a column on
`user_profiles` or a setting on `workflows`. **Decision required during
Phase 1 audit.**

### Route change

[app/api/workflows/execute/route.ts:506](../../app/api/workflows/execute/route.ts):

```ts
const useV2 = FEATURE_FLAGS.ENABLE_V2_LIVE_EXECUTION
  && (await isV2EligibleForUser(userId, workflowId))
if (useV2) {
  // v2 path with billing-gate, parallel hint, etc.
} else if (executionMode === 'live' || executionMode === 'sequential') {
  // v1 path (unchanged)
} else {
  // v2 path (sandbox/test, unchanged from today)
}
```

### What needs to land for v2 to handle live traffic

Driven by Phase 1 audit's gap list. At minimum:

- **Parallel execution.** Port v1's BFS queue + `Promise.all` fanout
  into v2's `executeWorkflow` flow. Honor `enableParallel` and
  `maxConcurrency` from request body.
- **Webhook entry path.** Each webhook handler that calls
  `AdvancedExecutionEngine` gets a v2 path, gated by the same flag.
- **Scheduled trigger entry path.** Same.
- **Billing gate.** Decide (Phase 1) whether to lift it INTO v2 or
  leave it in the route. If lifted, every entry path gets billing for
  free. If left, each new entry path duplicates the gate.
- **Provider/node routing parity.** Phase 1's audit produces a checklist
  of providers; each must work on v2 before Phase 5 can flip the flag.

### Phase exit

Internal-flag-on traffic runs end-to-end on v2. v1 still runs for
everyone else. No behavior regressions visible to internal users.

## Phase 4 — Parity tests

**Goal:** programmatic proof that the same workflow on v1 and v2
produces equivalent observable behavior. Required before any rollout
beyond internal users.

### Test surface

Create `__tests__/parity/` with:

1. **Output parity** — for ~10 representative workflows (gmail send,
   slack post, stripe charge, sheets row append, branch + filter,
   loop, AI agent, HITL pause, multi-step with variable references):
   - Run identical input through v1 and v2.
   - Assert: handler call counts identical, outputs identical, side
     effects identical (mocked at the SDK boundary).

2. **Billing parity** — same workflow runs charge the same number of
   tasks on both engines. Same `task_billing_events` shape. Retries
   charged the same. Overage / packs trigger identically.

3. **Error classification parity** — induced failures on v1 (with new
   `execution_steps` writing — see below) and v2 produce the same
   `error_classification` shape on `workflow_execution_sessions`.
   - **Constraint:** v1 currently does not write `execution_steps`, so
     `classifyExecutionFailure` returns null on v1 today. To make this
     parity test meaningful, v1 must briefly start writing
     `execution_steps` for the test surface — OR — the parity is
     asymmetric and we accept that v1 prod runs have unhumanized
     errors until cutover (matches today's reality).
   - **Recommendation:** accept the asymmetry. Don't add `execution_steps`
     writing to v1 for one PR's worth of value. Phase 5 closes the gap
     when v2 takes over.

4. **execution_steps writing** — v2 runs produce well-formed step rows
   for every node in the graph; statuses match the run outcome.

5. **Test mode interception** — v2 sandbox runs intercept writes
   (Gmail, Slack, Stripe, etc.) without hitting providers. Already
   covered by existing v2 tests; add coverage gaps if any.

6. **HITL pause + resume** — v2 pauses on a HITL node, persists
   `paused_node_id` + `resume_data`, and resumes correctly via
   `/api/workflows/[id]/resume`. Already partially covered; close gaps.

### Phase exit

All parity tests green on both engines. Single workflow can be flagged
between engines and produce equivalent results.

## Phase 5 — Staged rollout + delete v1

### Rollout sequence

| Stage | Audience | Gate | Watch for |
|---|---|---|---|
| 1 | `super_admin` users only | manual flag flip per user | any v2 prod failure, error rate, latency |
| 2 | Selected workflows (ad-hoc list) | per-workflow opt-in column | side-effect parity (Stripe charges, emails sent) |
| 3 | All `live` / `sequential` direct executions | flag default `true` for direct route | sustained green over 1 week |
| 4 | Webhook + scheduled triggers | each entry path migrates one at a time | per-trigger parity, no missed events |
| 5 | v1 deletion | nothing left calling `AdvancedExecutionEngine` | confirm via grep + dashboard before merge |

### Stage 5 cleanup

Delete:

- `lib/execution/advancedExecutionEngine.ts`
- The v1 branch in [app/api/workflows/execute/route.ts](../../app/api/workflows/execute/route.ts)
- Any v1-only helper imports
- `__tests__/workflows/engine-create-session-lineage.test.ts` if it
  tests v1-only logic (the helpers in `sessionLineage.ts` are reused
  by v2 — those tests stay)
- Update [CLAUDE.md](../../CLAUDE.md) §10 references to remove v1 mention.
- Update [safe-resume-from-failed-node-implementation-plan.md](./safe-resume-from-failed-node-implementation-plan.md)
  to lift the "v1 only" / "v2 only" distinction throughout.

### Resume project (paused) unblocks

After Stage 5 ships, [safe-resume-from-failed-node-project.md](./safe-resume-from-failed-node-project.md)
Phase 2 can resume. Resume implementation will be on v2:
- `execution_steps.output_data` is already populated → seedNodeOutputs
  works without new schema.
- Strict pre-resolution catches missing variables before resume
  re-fires anything.
- HITL infrastructure provides a tested pattern for "create new session
  but reuse old context" that the resume engine entry point can mirror.

## Risks

1. **Cutover blast radius.** v2 has zero prod traffic to date. The first
   real workflow on v2 is a step into not-fully-tested territory. The
   feature-flag staged rollout exists specifically for this — don't
   skip stages.
2. **Provider/node coverage gaps.** v2's `integrationHandlers.ts` may
   silently lack a node type that v1 supports. Phase 1's audit must
   enumerate; Phase 4's parity tests should cover the catalog.
3. **Performance regression.** v2 was designed for sandbox; haven't
   measured prod-throughput. Phase 5 stage 3 watches latency.
4. **Lineage threading double-spend.** PR-R1a wrote root + hash on v1's
   session creation. v2's session creation needs the same logic. Phase 2
   covers this; if Phase 3 ships before Phase 2 completes, retries on
   v2-flagged users would lose Q4 dedup.
5. **HITL regressions.** HITL is must-keep. Parity tests must include
   pause/resume scenarios.

## Estimated effort

Rough order of magnitude, not a commitment:

- Phase 1: 2 days (writing audit doc, mapping providers)
- Phase 2: 1-2 days (small mirror of PR-R1a on v2 side)
- Phase 3: 4-6 days (port parallel exec + webhook entry + sched entry + billing gate decision)
- Phase 4: 2-3 days (parity test scaffolding + ~10 workflow scenarios)
- Phase 5: ongoing observation, plus 1 day for v1 deletion PR

**Total: 10-14 working days for one engineer.**

Cutover stages 1-4 (Phase 5 rollout) take real-time soak — measured in
days/weeks, not engineering hours.

## Resolved decisions (2026-05-04 approval)

| Question | Decision |
|---|---|
| Billing gate location | Lift into `WorkflowExecutionService` (or a shared billing-guard helper called by it). Every execution entry path — live, sandbox, webhook, scheduled — gets billing for free. Phase 3 implements. |
| Per-user opt-in mechanism | New column `user_profiles.opt_in_v2_execution boolean default false`. Settable only by `super_admin`. Used during Phase 5 stages 1-2; deleted in stage 5 alongside v1. |
| Engine selection visibility | Internal logging only. Not surfaced to end-users. Per-user visibility becomes moot after stage 3 (global flag flip). |
| PR-R1a continuity | PR-R1a's two migrations (`20260506000000`, `20260507000000`) and helpers (`lib/execution/sessionLineage.ts`, `lib/workflows/workflowDefinitionHash.ts`, idempotency key + Q4 changes) are engine-agnostic and survive v1 deletion. No reverts. |
| Error-classification parity | Asymmetric. v1 does not gain `execution_steps` writing. Phase 4 parity tests treat error classification as v2-only. Gap closes automatically in stage 5. |
| Resume-from-failed-node Phase 2+ | Paused until v2 is unquestionably the target engine — at minimum Phase 5 stage 3 (global flag flipped to v2 default). |
