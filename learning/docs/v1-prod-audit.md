# v1 Production Audit — Phase 1 of v2 Canonical Engine Consolidation

**Status:** Phase 1 audit complete. Headline question answered (see §4). Subsequent phases consume this doc as input. Section 7's "do NOT start Phase 2" guidance is **superseded** — Phase 2 shipped 2026-05-04 once PR-V2C confirmed the registry fallback works.

**Companion to:** [v2-canonical-execution-engine-plan.md](./v2-canonical-execution-engine-plan.md)

## Resolutions log (post-audit)

- **2026-05-04:** §4 Q1 answered. PR-V2C shipped `lib/services/executionHandlers/registryFallback.ts` — v2 routes unknown node types through v1's `executeAction` registry. The "apparent gap" reading wins; consolidation effort returns to the original 10-14 day estimate.
- **2026-05-04:** PR-V2C-AUDIT shipped (engine-level testMode pre-call gate). Closed the test-mode safety gap that PR-V2C surfaced.
- **2026-05-04:** Phase 2 shipped (v2 lineage threading). v2 now writes `root_execution_id` + `workflow_definition_hash` on session insert; all 7 v2 meta-construction sites carry `rootExecutionId`. Q4 idempotency now works end-to-end on v2.
- **2026-05-04:** Phase 3 first four slices shipped (FLAG / BILLING / WEBHOOKS / CRON). Live + sequential + scheduled + webhook execution can now route through v2 behind `ENABLE_V2_LIVE_EXECUTION` + `user_profiles.opt_in_v2_execution`. Default-off; webhook entry paths via the unified dispatcher migrate automatically.
- **2026-05-04:** §4 Q2 + Q3 answered. Prod query `SELECT COUNT(*) FROM workflow_compositions` returned **`relation does not exist`**. The table was never materialized in production. v1's `executeSubWorkflows` (advancedExecutionEngine.ts:379) silently fails on every call (`{ data: null, error: ... }` from supabase) → confirms the audit's "dead code" classification. **Resolution:** safe to delete `executeSubWorkflows` + `enableSubWorkflows` flag in Phase 5 stage 5 alongside v1 deletion. No v2 sub-workflow story needed pre-launch.
- **2026-05-04:** §4 Q4 answered. Discord gateway (`lib/integrations/discordGateway.ts:1104-1120`) has **no dedup at the workflow-execution call site** — `executeWorkflowAdvanced` is invoked directly without an event-id check. Discord's own RESUME protocol prevents protocol-level duplicates in normal single-instance operation, but real risk exists for: (a) multi-instance deployments without singleton lock, (b) rare Discord API retries, (c) crashes mid-handler before `this.sequence` advances → RESUME re-delivers. **Resolution:** when this entry path migrates (`PR-V2-WEBHOOK-DISCORD-GATEWAY`), use the unified dispatcher's `dedupeKey` derived from `guildId + member.user.id + joined_at` to dedupe within the existing 5-minute TTL window. Bug exists but is bounded; not blocking pre-launch.
- **2026-05-04:** **PR-V2-WEBHOOK-DISCORD-INVITE shipped** (first of 10 direct-caller migrations). `lib/services/discordInviteTracker.ts:362`'s inline `AdvancedExecutionEngine` instantiation now delegates to `executeWebhookWorkflow`. Extracted `dispatchMemberJoinWorkflow(workflow, member, triggerData, inviteCode)` helper at module scope so the dispatch path is testable without standing up the singleton's Discord client. Adds dedupe via `${guildId}:${memberId}:${joinedAtISO}` (resolves audit Q4 for this entry path); fallback chain is `member.joinedAt?.toISOString() → triggerData.timestamp → 'unknown'`. Per Option B (delegation) — keeps v1/v2 dispatch in `lib/webhooks/execute.ts`, picks up unified dispatcher's billing/dedup for free, simplifies eventual v1 deletion. 9 tests at `__tests__/services/discordInviteTracker-v2-dispatch.test.ts`. No new TypeScript errors (2 pre-existing remain at shifted lines). Note: this entry path appears dormant in production today (no callers of `discordInviteTracker.initialize()` were found in the repo), but migration future-proofs the file for re-activation.
- **2026-05-04:** §4 Q5 answered. Four files reference `live_execution_events`: (1) v1 writer in `advancedExecutionEngine.ts:1283-1300` — goes away with v1 deletion; (2) `lib/collaboration/realTimeCollaboration.ts:248` realtime subscription — `handleExecutionEvent` is a no-op `logger.info`, no field-specific reads; (3) `lib/testing/workflowTesting.ts:325` test framework — audit-classified deprecate (not prod); (4) `lib/services/userDeletionService.ts:45` GDPR sweep — deletes by `user_id` only, schema-agnostic. **Resolution:** no active UI consumer depends on `live_execution_events` schema. v2 doesn't write to this table (uses `executionHistoryService` + its own `ExecutionProgressTracker`). Safe to drop the writer when v1 is deleted in stage 5; the realtime subscription becomes inert (already only logs).

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
| 2 | [app/api/workflow-webhooks/[workflowId]/route.ts](../../app/api/workflow-webhooks/[workflowId]/route.ts) | Per-workflow webhook | ✓ via #3 | ✓ via #3 (auto-derived) | ❌ | ✓ Migrated 2026-05-04 (PR-V2-WEBHOOK-PER-WORKFLOW) |
| 3 | [lib/webhooks/execute.ts:154](../../lib/webhooks/execute.ts) | Unified webhook dispatcher | ❌ | ✓ in-memory cache | ❌ | ⚠ Port |
| 4 | [lib/webhooks/gmail-processor.ts:1576](../../lib/webhooks/gmail-processor.ts) | Gmail push notification | ❌ | ✓ custom map (no TTL — leak risk) | ❌ | ⚠ Port |
| 5 | [lib/webhooks/google-processor.ts](../../lib/webhooks/google-processor.ts) (5 entry points) | Calendar/Drive/Sheets webhooks | ❌ | ✓ custom maps (no TTL) | ❌ | ⚠ Port |
| 6 | [lib/services/discordInviteTracker.ts](../../lib/services/discordInviteTracker.ts) | Discord member-join event | ✓ via #3 | ✓ via #3 (`${guildId}:${memberId}:${joinedAt}`) | ❌ | ✓ Migrated 2026-05-04 (PR-V2-WEBHOOK-DISCORD-INVITE) |
| 7 | [app/api/workflow/[provider]/route.ts:303](../../app/api/workflow/[provider]/route.ts) | Provider-specific webhook | ❌ | None | ❌ | ⚠ Port |
| 8 | [app/api/microsoft-graph/worker/route.ts:1220](../../app/api/microsoft-graph/worker/route.ts) | MS Graph queue worker | ❌ | ✓ 3 layers | ❌ | ⚠ Port |
| 9 | [app/api/webhooks/stripe-integration/route.ts](../../app/api/webhooks/stripe-integration/route.ts) | Stripe events | ✓ via #3 | ✓ via #3 (`event.id`) | ❌ | ✓ Migrated 2026-05-04 (PR-V2-WEBHOOK-STRIPE-INT) |
| 10 | [app/api/webhooks/mailchimp/route.ts](../../app/api/webhooks/mailchimp/route.ts) (2 entry points) | Mailchimp events | ❌ | None | ❌ | ⚠ Port |
| 11 | [app/api/integration-webhooks/[provider]/route.ts:149](../../app/api/integration-webhooks/[provider]/route.ts) | Generic provider webhook | ❌ | None | ❌ | ⚠ Port |
| 12 | [lib/webhooks/dropboxTriggerHandler.ts](../../lib/webhooks/dropboxTriggerHandler.ts) | Dropbox webhook | ✓ via #3 | ✓ via #3 (`cursor \|\| requestId`) | ❌ | ✓ Migrated 2026-05-04 (PR-V2-WEBHOOK-DROPBOX) |
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

✅ **RESOLVED 2026-05-04 — yes.** PR-V2C added `lib/services/executionHandlers/registryFallback.ts`. Every `default:` branch across v2's dispatchers now routes unknown node types through v1's `executeAction`. The "apparent gap" reading wins; consolidation returns to the 10-14 day estimate.

## 4. Open questions — ALL RESOLVED 2026-05-04

| # | Question | Status |
|---|---|---|
| 1 | Does v2 have a fallback to v1's registry? | ✅ Resolved — yes (PR-V2C). |
| 2 | Sub-workflow status. Prod query: `SELECT COUNT(*) FROM workflow_compositions`. | ✅ Resolved — table doesn't exist in prod. |
| 3 | `workflow_compositions` table contents. | ✅ Resolved — table doesn't exist; sub-workflow code is dead. |
| 4 | Discord gateway dedup on reconnect (entry #13). | ✅ Resolved — no dedup today; bounded risk; addressed in PR-V2-WEBHOOK-DISCORD-GATEWAY. |
| 5 | `live_execution_events` UI consumers — confirm no v1-only fields read. | ✅ Resolved — no UI consumer reads v1-only fields; safe to drop with v1. |

See "Resolutions log" at the top of this doc for the full findings on each.

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

## 7. Recommended next step — SUPERSEDED

The original recommendation ("do NOT start Phase 2 until §4 Q1 is answered") was discharged on 2026-05-04. PR-V2C confirmed the registry fallback exists; Phase 2 then shipped. **The project is on the original 10-14 day estimate.**

Current next step: **Phase 3 — port live execution to v2 behind a feature flag.** First slice is PR-V2-FLAG (feature flag + opt-in column + route dispatch, no behavior change). See [v2-canonical-execution-engine-plan.md](./v2-canonical-execution-engine-plan.md) Phase 3 for the full slice breakdown.
