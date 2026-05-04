# v1 Production Audit — Phase 1 of v2 Canonical Engine Consolidation

**Status:** Phase 1 audit. Read-only research. No code changed.

**Companion to:** [v2-canonical-execution-engine-plan.md](./v2-canonical-execution-engine-plan.md)

## Executive summary — read this before anything else

The audit found three things, two of which were expected and **one of which materially changes the project scope**:

1. ✅ **Expected: live execution semantics are portable.** v1's parallel-execution config is dead code; the BFS queue + `Promise.all` fanout in `executeWithParallelProcessing` is never called. Real v1 execution is sequential. v2's recursive DFS produces equivalent traversal. **No engine-level rewrite needed.**

2. ⚠ **Expected but bigger than thought: 16 v1 entry paths instantiate `AdvancedExecutionEngine`.** Most are webhook handlers (Gmail, Google Workspace, Discord, Stripe, Mailchimp, Microsoft Graph queue worker, etc.) plus the manual `/api/workflows/execute` route plus a Discord gateway listener. Only the manual route runs the billing gate. Webhooks have no billing gate today — that's a pre-existing bug, not a consolidation issue, but worth fixing as we go.

3. 🚨 **SURPRISE: v2 has ~130 missing node types and 40+ partial implementations.** v2's `integrationHandlers.ts` has explicit `switch` cases for ~60 node types. v1's registry has 330+. Providers entirely absent from v2's switch: Stripe, Shopify, GitHub, Facebook, Twitter, Mailchimp, ManyChat, Gumroad, Monday.com. Partial coverage: HubSpot (20%), OneDrive (8%), Teams (0%), Notion (50%), Airtable (36%), Trello (40%).

   **This needs verification before the audit's effort estimate can be trusted.** The audit detected explicit switch cases. It did not confirm whether v2 has a **catch-all fallback** that routes unknown node types through the same registry v1 uses. If a fallback exists, the gap is mostly cosmetic. If no fallback exists, the gap is a 6-8 week porting blocker. **Section 4 below details what to verify.**

---

## 1. v1 entry paths (Agent 1 findings)

16 production code paths instantiate `AdvancedExecutionEngine`. Classified:

| # | Entry path | Trigger | Billing gate | Dedup | `retryOf` | Classification |
|---|---|---|---|---|---|---|
| 1 | [app/api/workflows/execute/route.ts:508](../../app/api/workflows/execute/route.ts) | Manual API / scheduled trigger | ✓ | N/A | ✓ | ⚠ Port |
| 2 | [app/api/workflow-webhooks/[workflowId]/route.ts:295](../../app/api/workflow-webhooks/[workflowId]/route.ts) | Per-workflow webhook | ❌ | None | ❌ | ⚠ Port |
| 3 | [lib/webhooks/execute.ts:154](../../lib/webhooks/execute.ts) | Unified webhook dispatcher | ❌ | ✓ in-memory cache | ❌ | ⚠ Port |
| 4 | [lib/webhooks/gmail-processor.ts:1576](../../lib/webhooks/gmail-processor.ts) | Gmail push notification | ❌ | ✓ custom map (no TTL — leak risk) | ❌ | ⚠ Port |
| 5 | [lib/webhooks/google-processor.ts](../../lib/webhooks/google-processor.ts) (5 entry points) | Calendar/Drive/Sheets webhooks | ❌ | ✓ custom maps (no TTL) | ❌ | ⚠ Port |
| 6 | [lib/services/discordInviteTracker.ts:362](../../lib/services/discordInviteTracker.ts) | Discord member-join event | ❌ | None | ❌ | ⚠ Port |
| 7 | [app/api/workflow/[provider]/route.ts:303](../../app/api/workflow/[provider]/route.ts) | Provider-specific webhook | ❌ | None | ❌ | ⚠ Port |
| 8 | [app/api/microsoft-graph/worker/route.ts:1220](../../app/api/microsoft-graph/worker/route.ts) | MS Graph queue worker | ❌ | ✓ 3 layers | ❌ | ⚠ Port |
| 9 | [app/api/webhooks/stripe-integration/route.ts:273](../../app/api/webhooks/stripe-integration/route.ts) | Stripe events | ❌ | None | ❌ | ⚠ Port |
| 10 | [app/api/webhooks/mailchimp/route.ts](../../app/api/webhooks/mailchimp/route.ts) (2 entry points) | Mailchimp events | ❌ | None | ❌ | ⚠ Port |
| 11 | [app/api/integration-webhooks/[provider]/route.ts:149](../../app/api/integration-webhooks/[provider]/route.ts) | Generic provider webhook | ❌ | None | ❌ | ⚠ Port |
| 12 | [lib/webhooks/dropboxTriggerHandler.ts:274](../../lib/webhooks/dropboxTriggerHandler.ts) | Dropbox webhook | ❌ | None | ❌ | ⚠ Port |
| 13 | [lib/integrations/discordGateway.ts:1104](../../lib/integrations/discordGateway.ts) | Discord gateway WS event | ❌ | None | ❌ | ⚠ Port |
| 14 | `app/api/cron/execute-scheduled-triggers/route.ts` | Scheduled cron | ✓ via #1 | N/A | ✓ via #1 | ✓ Covered |
| 15 | [lib/testing/workflowTesting.ts:51](../../lib/testing/workflowTesting.ts) | Test framework | — | — | — | ❌ Deprecate (not prod) |
| 16 | [lib/webhooks/webhookManager.ts:464](../../lib/webhooks/webhookManager.ts) | Legacy webhook manager | ❌ | None | ❌ | ⚠ Port (or merge with #3) |

**Findings:**
- **Pre-existing bug:** webhooks execute for free (no billing gate). Lifting the billing gate into `WorkflowExecutionService` (decision already made) closes this.
- **Pre-existing bug:** dedup caches in `gmail-processor` and `google-processor` use unbounded maps with no TTL — potential memory leak. Worth replacing with a centralized service (Redis or table-based) during the v2 port.
- **No `retryOf` plumbing on any webhook entry path.** This means PR-R1a's lineage threading does nothing for webhook-triggered runs. If we want resume-from-failed-node to work for webhook executions, lineage threading on webhooks needs to land too. (Out of scope for this audit; flag for Phase 2/3.)

## 2. Execution semantics (Agent 2 findings)

| Semantic | v1 status | v2 status | Action | Complexity |
|---|---|---|---|---|
| Traversal | BFS queue, sequential in practice | Recursive DFS | ✓ Both correct; no port | — |
| `enableParallel: true` config | **Dead code** — never wired into the running path | Not implemented | ❌ Deprecate; remove from API | Trivial |
| `maxConcurrency` | **Dead code** — Semaphore class never instantiated | Not implemented | ❌ Deprecate | Trivial |
| `executeParallelBranches` (line 491-566) | **Dead code** — never called | Not implemented | ❌ Delete | Trivial |
| `executeSubWorkflows` (line 568) | **Dead code** — never called from main path; `workflow_compositions` table queried but results ignored | Not implemented | 🔍 Verify if `workflow_compositions` has prod data; delete if not | Small |
| `startNodeId` (HITL resume) | ✓ supported via line 159 / `executeMainWorkflowPath` | ✓ Equivalent via `skipTriggers` + reconstructed start point on resume | ✓ Already covered | — |
| `live_execution_events` writing | ✓ via `logExecutionEvent` | ✓ via `executionHistoryService` + own progress tracker | ✓ Both feed the UI subscription | — |
| HITL pause/resume | ❌ No support in v1 | ✓ Full pause/resume in v2 | ✓ Already in v2 — keep | — |
| Strict pre-resolution (Q2 contract) | ❌ Soft resolution only | ✓ `dataFlowManager.resolveObjectStrict` | ✓ Already in v2 — keep | — |
| `execution_steps` writing | ❌ Not written | ✓ Written | ✓ Already in v2 — keep | — |
| `classifyExecutionFailure` | ❌ Not called | ✓ Called | ✓ Already in v2 — keep (asymmetric parity per decision) | — |
| Test mode (`TestModeConfig`) | ❌ Boolean only | ✓ Rich config + interception | ✓ Already in v2 — keep | — |
| AI Router multi-path | ✓ in `executeMainWorkflowPath` (lines 1009-1049) | ✓ in `connectionRouting.ts` | ✓ Both have it | — |

**Net finding for engine semantics:** v2 already has everything v1 has that's actually used in production. v1's "advanced" features (parallel, sub-workflows, max concurrency) are dead code. Delete on cutover.

## 3. Node type parity (Agent 3 findings) — **NEEDS VERIFICATION**

The audit's most consequential finding. Agent 3 inventoried v1's registry and v2's three handler files and produced a coverage table.

### Headline numbers (subject to verification — see §4)

| Bucket | v1 | v2 explicit | v2 via service delegation | Apparent gap |
|---|---|---|---|---|
| Gmail (15 actions + 1 trigger) | ✓ all | service-delegated | likely all | possibly 0 |
| Google Suite (24 across Sheets/Calendar/Docs/Drive/Analytics) | ✓ all | service-delegated | likely all | possibly 0 |
| Microsoft Outlook + OneNote + Excel (22) | ✓ all | ✓ explicit cases | — | 0 |
| Slack (30+) | ✓ all | 2 explicit + service fallback | likely all | possibly 0 |
| Discord (5) | ✓ all | ✓ all explicit | — | 0 |
| Notion (18+) | ✓ all | 9 explicit | unknown | possibly 9+ |
| Airtable (11) | ✓ all | 4 explicit | unknown | possibly 7 |
| HubSpot (25+) | ✓ all | 5 explicit | unknown | possibly 20+ |
| Trello (10) | ✓ all | 4 explicit | unknown | possibly 6 |
| OneDrive (12) | ✓ all | 1 explicit | unknown | possibly 11 |
| Dropbox (2) | ✓ all | 1 explicit | unknown | possibly 1 |
| Teams (14) | ✓ all | 0 explicit | unknown | possibly 14 |
| Stripe (11 actions + 8 triggers) | ✓ all | 0 explicit | unknown | possibly 19 |
| Shopify (11) | ✓ all | 0 explicit | unknown | possibly 11 |
| GitHub (6) | ✓ all | 0 explicit | unknown | possibly 6 |
| Facebook (8) | ✓ all | 0 explicit | unknown | possibly 8 |
| Twitter (12) | ✓ all | 0 explicit | unknown | possibly 12 |
| Mailchimp (16) | ✓ all | 0 explicit | unknown | possibly 16 |
| ManyChat (10) | ✓ all | 0 explicit | unknown | possibly 10 |
| Gumroad (15) | ✓ all | 0 explicit | unknown | possibly 15 |
| Monday.com (20+) | ✓ all | 0 explicit | unknown | possibly 20+ |
| Logic / control flow (6) | ✓ all | 4 explicit + 2 missing (`http_request`, `wait_for_*`) | — | 2-3 + divergent loop semantics |
| AI nodes (8) | ✓ all | ✓ via `AIActionsService` (delegation) | likely all | possibly 0; ai_agent/ai_router behavior may diverge |

### Key question (§4)

**Does v2's `integrationHandlers.ts` have a fallback that routes unknown node types through the v1 registry?**

If **yes** → the apparent gap is mostly an explicit-routing optimization in v2; the actual handler functions are reused. The consolidation is a 10-14 day project as originally estimated.

If **no** → v2 silently fails on ~130 node types; the consolidation is a 6-8 week porting marathon, possibly more.

This is the single biggest unknown in the project. Phase 1 cannot ship a defensible plan until this is resolved.

## 4. Open questions to resolve before Phase 2 begins

1. 🚨 **The integrationHandlers fallback question.** Read `integrationHandlers.ts` end-to-end and confirm:
   - Is there a `default:` case in the top-level switch that delegates to the v1 registry's `executeAction`?
   - For "service-delegated" providers (Gmail, Google, Slack), what does the service actually do — does it cover all node types or just an enumerated subset?
   - For providers with zero explicit cases (Stripe, Shopify, etc.), what happens at runtime if a workflow fires one in test mode? Throw? Silent return? Mock?

2. **Sub-workflow status.** Query production: `SELECT COUNT(*) FROM workflow_compositions`. If empty, deprecate. If not empty, design a v2 sub-workflow story before Phase 3.

3. **`workflow_compositions` table contents.** Same query result also reveals whether the compositions table is a feature or a leftover from earlier work.

4. **Discord gateway path (entry #13).** Discord WS events may produce duplicate executions on reconnect. Confirm or refute via the codebase. If real, dedup is required for v2.

5. **`live_execution_events` UI consumers.** Both engines write to this table; both readers (front-end and admin debug panel) should keep working. Quick grep to confirm no v1-only fields are read.

## 5. Effort estimate — REVISED, conditional on §4 outcome

| Outcome of §4 question 1 | Estimated total effort | Phase 3 sub-effort |
|---|---|---|
| **v2 has registry fallback** (best case) | 10-14 working days | ~5 days |
| **v2 service-delegation covers all per-provider methods** | 14-18 working days | ~8 days |
| **v2 has neither fallback nor full service coverage** | 30-40 working days (6-8 weeks) | ~25 days porting |

The original plan's 10-14 day estimate assumed best case. If the worst case holds, the project effectively becomes "rewrite v2's integration handlers" before consolidation can ship.

## 6. Pre-existing bugs surfaced by the audit (not project-blocking, but worth tracking)

1. **Webhooks have no billing gate.** Most webhook entry paths execute workflows without billing. Bot-spam attacks could currently rack up free task usage. Phase 3 closes this naturally when billing lifts into `WorkflowExecutionService`.
2. **Dedup caches leak.** Gmail and Google processors use unbounded in-memory maps. Restart-only "TTL". Replace with a TTL-bounded service during v2 port.
3. **No webhook `retryOf` plumbing.** PR-R1a lineage threading is wasted on webhook traffic. If resume-from-failed-node should work for webhook-triggered runs, this needs threading.
4. **`stripe-integration`, `mailchimp`, generic webhooks: no event-id dedup.** Provider retries cause duplicate executions. Fix during port.
5. **`AdvancedExecutionEngine.executeParallelBranches` and `executeSubWorkflows` are dead code.** Delete.

## 7. Recommended next step

**Do NOT start Phase 2 (v2 lineage threading) until §4 question 1 is answered.** The whole project plan rests on whether the node-type gap is real or apparent. Resolving it is a 30-minute read of `integrationHandlers.ts` end-to-end plus the integration services it delegates to.

If the gap is real, we should re-discuss the project scope with the user — six weeks of porting before the v2 cutover may not be worth it pre-launch. Options to surface in that conversation:
- **Stay on v1.** Build the missing v2 features (execution_steps, HITL, error classification) on v1 instead. Reverses the original Option B → Option A decision.
- **Postpone consolidation.** Ship pre-launch on v1; consolidate post-launch when there's time for a 6-week port.
- **Trim the node catalog.** Decide which providers are truly launch-critical, deprecate the rest, port only what's left.

If the gap is apparent (registry fallback exists), proceed to Phase 2 as originally planned.
