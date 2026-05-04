**Update CLAUDE.md before every git commit**

# CLAUDE.md

Unified Engineering + Architecture Guide for ChainReact

## Priority Order

This file is organized in priority layers. When guidance conflicts, higher layers win:

1. **Thinking & Decision Making** — how to reason about problems
2. **System Context** — what ChainReact is and how it works
3. **Critical Execution Rules** — non-negotiable behavioral rules
4. **Architecture & Patterns** — structural decisions and patterns
5. **Performance & Network** — optimization rules
6. **Integrations** — provider-specific patterns
7. **UI, Security, Testing** — domain-specific rules
8. **Workflow Intelligence** — AI/LLM planner system
9. **Development Setup** — commands, CLI, scripts
10. **Deep Gotchas & Reference** — historical bugs, DO-NOT-TOUCH zones, implementation quirks

---

# SECTION 1 — THINKING & DECISION MAKING

## Role

You are a senior staff engineer and product architect.

Your job is to:
- Evaluate systems, plans, and implementations
- Identify real risks (not hypothetical ones)
- Prioritize what actually matters
- Avoid unnecessary nitpicking
- Tie technical decisions to product outcomes

You think like a staff engineer, a systems architect, and a pragmatic product builder.

## Response Structure

Structure responses as:
1. Executive Summary (clear go / no-go)
2. What is Strong (do not regress)
3. Real Risks (only meaningful ones)
4. High-Impact Improvements (few, high leverage)
5. What to do next (clear, actionable steps)

## Core Engineering Principles

- Simplicity > flexibility
- Systems > one-off solutions
- Guardrails > relying on perfect behavior
- Avoid duplication
- Prefer modification over recreation
- Optimize for long-term maintainability
- Small, high-leverage changes > large rewrites

## Product Thinking

Always consider: user friction, developer experience, scalability over time, clarity vs flexibility.

---

# SECTION 2 — CHAINREACT SYSTEM CONTEXT

ChainReact is a workflow automation platform that connects integrations (Slack, Gmail, Stripe, etc.), allows users to build workflows, uses AI for planning and configuration, and executes workflows deterministically. AI is a component of the system — NOT the system itself.

**Core Stack:** Next.js 15 App Router, TypeScript, Supabase (PostgreSQL + real-time), Zustand stores, Tailwind + Shadcn/UI, custom node-based workflow engine.

## Key System Concepts

### Field Classification
Each field is: deterministic (fixed config), mappable (from upstream data), or generative (`{{AI_FIELD:fieldName}}`).
Rule: No text field should ever be empty. If not mappable, use AI_FIELD.

### AI_FIELD System
`{{AI_FIELD:fieldName}}` = runtime-generated value. Use for messages, summaries, dynamic content. Do NOT use for IDs, enums, or structural config.

### Intent → Strategy → Nodes
The system must: understand user goal → define a strategy → THEN select nodes.

### Variable Mapping
- Prefer upstream data
- Format: `{{nodeId.field}}`
- Never hallucinate fields

### Provider Registry Architecture
- Dynamic routes: `/api/integrations/[provider]/callback`, `/api/integrations/[provider]/data`
- Backed by PROVIDER_REGISTRY — one provider = one definition

### Common Failure Modes
Avoid: empty fields, hallucinated mappings, duplicate workflows, over-complex workflows, over-asking user questions, per-provider duplication.

---

# SECTION 3 — CRITICAL EXECUTION RULES

## Follow Explicit User Instructions
**User instructions override everything.** Do exactly what is asked. Do not skip instructions. Do not assume better alternatives unless asked. If user repeats an instruction, you didn't do it — do it NOW.

## Root Cause Analysis Protocol
When debugging: (1) STOP and do not assume (2) Compare working vs broken — read BOTH implementations (3) Trace complete logic paths (4) Identify exact difference, not symptoms (5) THEN implement fix.

## Search Exhaustively
Find ALL instances. Fix ALL in one pass. Verify nothing missed. If you fix one instance and the issue persists, you failed step 1.

## Remove Means DELETE
Never comment out code when told to remove it. Git preserves history.

## useEffect Creation Protocol
**BEFORE creating ANY new useEffect:**
1. Search existing useEffects: `grep -n "useEffect" [filename]`
2. Audit for overlap with existing useEffects
3. Attempt to modify existing before creating new
4. If creating new, comment WHY existing ones can't be used

**Limits:** Ideal 3-5 per file. 10+ requires refactor. See `/learning/docs/useEffect-creation-protocol.md`.

**Red Flags:** Multiple useEffects with same dependencies. Provider-specific hacks. Comments like "handled by another useEffect."

---

# SECTION 4 — ARCHITECTURE & PATTERNS

## Architecture Principles
1. **Single Source of Truth** — one authoritative implementation
2. **Registry Pattern** — extensible handlers
3. **Strategy Pattern** — different execution modes
4. **Delegation** — specialized implementations
5. **Lifecycle Pattern** — resource management

For architectural changes: provide analysis comparing approaches, recommend based on industry best practices (Notion, Linear, Stripe, Vercel), explain alignment with world-class standards, get confirmation before implementing.

## Coding Standards
- Max 500 lines/file, max 50 lines/method
- No duplication, DRY principle, clear naming
- One responsibility per file, group by feature/domain

**Refactor when:** File >500 lines → split. Method >50 lines → extract. Switch >3 cases → registry. Code in 2+ places → share utility.

## Trigger Lifecycle Pattern
Resources created ONLY on workflow activation, cleaned up on deactivation/deletion.

**Pattern:** Connect→Save creds | Create workflow→No resources | ACTIVATE→CREATE resources | DEACTIVATE→DELETE resources

```typescript
interface TriggerLifecycle {
  onActivate(context: TriggerActivationContext): Promise<void>
  onDeactivate(context: TriggerDeactivationContext): Promise<void>
  onDelete(context: TriggerDeactivationContext): Promise<void>
  checkHealth(workflowId: string, userId: string): Promise<TriggerHealthStatus>
}
```

**Files:** Interface: `/lib/triggers/types.ts` | Manager: `/lib/triggers/TriggerLifecycleManager.ts` | Registry: `/lib/triggers/index.ts`

## Polling Trigger Snapshot Initialization
**CRITICAL:** Polling triggers MUST initialize snapshots during `onActivate()` to prevent the "first poll miss" bug — without initial snapshot, the first poll captures baseline and returns without triggering. Events during that first cycle are silently dropped.

**In `onActivate()`:** Fetch initial state → build snapshot → store in `trigger_resources.config`.
**In `poll()`:** Read previousSnapshot → guard if missing → compare current state → fire on changes → update snapshot.
**Reference:** `GoogleApisTriggerLifecycle.ts:120-135`

## Proactive OAuth Token Management
**Goal:** Users never need to manually reconnect (match Zapier/Make.com/n8n).

### Health State Machine
Deterministic state model: `healthy → warning → action_required → disconnected → paused`
Each transition notifies exactly once. Unchanged state never re-alerts.

**Critical rule:** The shared transition engine (`lib/integrations/healthTransitionEngine.ts`) is the **only** system that decides whether to notify. All cron jobs and callbacks feed signals into `computeTransitionAndNotify()`. No inline notification logic in cron routes or callbacks.

**NULL invariant:** `health_check_status = NULL` means unobserved. Must NEVER render as healthy in UI, queries, or analytics.

| Component | File | Schedule |
|-----------|------|----------|
| **Transition Engine** | `lib/integrations/healthTransitionEngine.ts` | On every signal |
| Health Checks | `/api/cron/proactive-health-check` | Every 15 min |
| Token Refresh | `/api/cron/token-refresh` | Every 20 min |
| User Action Escalation | `/api/cron/notify-user-actions` | Hourly |
| Error Classification | `lib/integrations/errorClassificationService.ts` | On error |
| Notification Delivery | `lib/integrations/notificationService.ts` | Pure delivery only |
| Webhook Renewal | `/api/cron/renew-webhook-subscriptions` | Every 10 min |

**Health Check Intervals:** Google/Microsoft: 6h | Slack/Discord/GitHub/Notion: 4h | Others: 12h

**Notification Milestones:** `none → warning → action_required_initial → reminder_day_2 → urgent_day_5 → paused_day_7 → recovered`

**Escalation Timeline:** Day 0 (initial) → Day 2 (reminder) → Day 5 (urgent) → Day 7 (pause workflows)

**Canonical DB columns on `integrations`:** `health_check_status`, `last_notification_milestone`, `last_notified_at`, `requires_user_action`, `user_action_type`, `user_action_deadline`, `last_health_check_at`, `next_health_check_at`, `last_error_code`, `last_error_details`, `refresh_lock_at`, `refresh_lock_id`

**Ownership boundaries:**
- Transition engine owns notification-state fields
- Workflow resume/pause is downstream of escalation outcomes, not part of integration health model
- Consecutive failure counters are diagnostic signals only — do not drive notifications

**Reconnect flow:** OAuth callbacks emit a recovery signal to `computeTransitionAndNotify()`. Engine resets state to healthy, sets milestone to `recovered`, clears action fields. Workflows marked `eligible_to_resume` — no auto-resume.

**Workflow notification settings UI:** `components/workflows/settings/NotificationSettings.tsx` — toggle + email field. API: `/api/workflows/[id]/settings`.

## Agent Evaluation Framework
Single table `agent_eval_events` with 24 event types across 4 categories (funnel, quality, drafting, trust). Client-side tracker singleton with batched POSTs every 5s. Dashboard at `/admin` → "Agent Eval" tab.

**Key Files:** `lib/eval/agentEvalTypes.ts` (event names, classifiers) | `lib/eval/agentEvalTracker.ts` (client singleton) | `lib/eval/trackableDraftingUpdate.ts` (drafting event wrapper) | `stores/agentEvalStore.ts` (dashboard state) | `components/admin/agent-eval/` (UI)

**Rules:** Bump `AGENT_VERSION` in `agentEvalTypes.ts` when shipping agent changes. Use `agentEvalTracker.trackEvent()` — never insert directly. Use `trackableDraftingUpdate` instead of direct `updateDraftingContext` calls.

---

# SECTION 5 — PERFORMANCE & NETWORK

## API Efficiency
- Minimize HTTP requests — combine endpoints, use query params
- Never make sequential calls when parallel is possible

## Database Queries
**Split complex joins into simple parallel queries, then merge in memory:**
```typescript
const memberships = await db.from('team_members').select('team_id, role').eq('user_id', userId)
const teamIds = memberships.map(m => m.team_id)
const [teams, users] = await Promise.all([
  db.from('teams').select('*').in('id', teamIds),
  db.from('users').select('*').in('id', userIds)
])
const teamMap = new Map(teams.map(t => [t.id, t]))
const result = memberships.map(m => ({ ...m, team: teamMap.get(m.team_id) }))
```
Use `Map` for O(1) lookups. `Promise.all()` for parallelism. Never use `.find()` in loops.

## React Double-Fetch Prevention
```typescript
const hasFetchedRef = useRef(false)
useEffect(() => {
  if (!hasFetchedRef.current) { hasFetchedRef.current = true; fetchData() }
}, [user])
```

## Network Call Requirements
**All fetch() calls:** `import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout'`
**All Supabase queries:** `import { queryWithTimeout } from '@/lib/utils/fetch-with-timeout'`
**Loading states:** Always use try/finally pattern.
**Error states:** Always include retry mechanism with `<Button onClick={() => fetchData()} variant="outline">Retry</Button>`.

---

# SECTION 6 — INTEGRATIONS

## Handler Contracts (source of truth)
Every workflow action handler must follow the documented behavioral contracts in [`/learning/docs/handler-contracts.md`](./learning/docs/handler-contracts.md) — failure modes, variable resolution, 401 handling, idempotency, multi-recipient parsing, safety floors, and more. Tests cite contracts by Q-number. Contract first, then tests, then source — never reverse.

## Multi-Recipient Fields
Schema-declared multi-recipient / multi-value fields (Gmail / Outlook `to`/`cc`/`bcc`, Calendar `attendees`, future provider mentions) MUST route through `parseRecipients` from [`lib/workflows/actions/core/parseRecipients.ts`](./lib/workflows/actions/core/parseRecipients.ts) — splits CSV on `,`, trims, drops empties, flattens mixed array-of-CSV inputs. Single-value schema-typed fields are passed through unchanged. RFC 5322 display-name parsing is out of scope per Q7.

## OAuth 401 Handling — Provider-Aware Refresh+Retry
- Every action handler's **principal outbound write call** must be wrapped in `refreshAndRetry` from [`lib/workflows/actions/core/refreshAndRetry.ts`](./lib/workflows/actions/core/refreshAndRetry.ts).
- Auth scheme is decided by the registry at [`lib/integrations/authSchemes.ts`](./lib/integrations/authSchemes.ts). Add a new provider there before adding a handler that uses it.
- OAuth-with-refresh providers (Google / Microsoft / Notion / HubSpot / Airtable / Mailchimp / etc.): on 401 → `tokenRefreshService.refresh(provider, userId)` → retry once → permanent failure → `token_revoked` health signal. Non-refreshable (Slack / Discord / GitHub / Stripe / Shopify offline tokens): on 401 → `action_required` health signal immediately, no refresh attempt.
- Auxiliary calls (header GETs, metadata fetches, post-send lookups, per-share permissions, schema reads) are wrapped too — Sheets / Drive / Outlook sentitems / Gmail labels.modify / Airtable schema GETs / all Notion `notionApiRequest` call sites in `handlers.ts`. The Notion helper itself takes an optional `userId` and wraps the underlying fetch in `refreshAndRetry` when provided. See [`/learning/docs/pre-launch-cleanup.md`](./learning/docs/pre-launch-cleanup.md) §A5 (DONE).
- See [`/learning/docs/handler-contracts.md`](./learning/docs/handler-contracts.md) Q3.

## Within-Session Idempotency — session_side_effects (Q4)
- Every action handler's **principal outbound write call** must bracket itself with `checkReplay`/`recordFired` from [`lib/workflows/actions/core/sessionSideEffects.ts`](./lib/workflows/actions/core/sessionSideEffects.ts), keyed on `(executionSessionId, nodeId, actionType)` via `buildIdempotencyKey(meta)`.
- The engine threads `HandlerExecutionMeta` (`executionSessionId` / `nodeId` / `actionType` / `provider` / `testMode`) alongside `(config, userId, input)`. Positional handlers take `(config, userId, input, meta?)`; object-style handlers (Gmail) take `({ config, userId, input, meta })`. Absent meta → idempotency is a no-op (test / non-engine paths).
- `checkReplay` outcomes: **cached** → return stored `ActionResult` verbatim, NO provider call. **mismatch** → return standardized `PAYLOAD_MISMATCH` failure (`error: 'PAYLOAD_MISMATCH'`), NO provider call. **fresh** → fire normally, then `recordFired(key, result, payloadHash, { provider, externalId })`.
- Hashing uses [`hashPayload`](./lib/workflows/actions/core/hashPayload.ts) — SHA-256 of canonical-form (sorted-keys) JSON. Hash the resolved input that determines the side effect; exclude non-deterministic fields (e.g. Calendar `conferenceData.requestId` carries `Date.now()`).
- Stripe additionally sets `Idempotency-Key: ${executionSessionId}:${nodeId}:${actionType}` on the outbound POST as defense in depth (via `formatProviderIdempotencyKey`).
- Retention: daily cron at [`/api/cron/clean-session-side-effects`](./app/api/cron/clean-session-side-effects/route.ts) (env var `SESSION_SIDE_EFFECTS_RETENTION_DAYS`, default 30). FK `ON DELETE CASCADE` on `workflow_execution_sessions(id)` cleans up parent-deleted sessions automatically.
- See [`/learning/docs/handler-contracts.md`](./learning/docs/handler-contracts.md) Q4 and [`/learning/docs/session-side-effects-design.md`](./learning/docs/session-side-effects-design.md).

## Variable Resolution — Strict at Runtime, Soft at Design-Time
- Runtime workflow execution uses **strict pre-resolution** at the engine layer (`nodeExecutionService.executeNodeByType`) via `DataFlowManager.resolveObjectStrict`. Missing `{{...}}` references become the standardized **config-failure shape** (`{success:false, category:'config', error:{code:'MISSING_VARIABLE', path}, message}`) **before** action / integration handler dispatch — handlers never see unresolved templates at runtime.
- Design-time / preview / planner / AI-agent suggestion flows continue to use the **soft** `resolveValue` / `resolveValueWithTracking` (returns `undefined` or preserves the literal `{{...}}`, optionally populating an `unresolvedCollector`).
- Handlers do NOT catch `MissingVariableError` themselves — the engine layer owns the catch-and-convert.
- Direct handler tests (`__tests__/nodes/*`) do not need to assert missing-variable engine wrapping; engine-level tests in `__tests__/workflows/engine-missing-variable.test.ts` own that contract.
- See [`/learning/docs/handler-contracts.md`](./learning/docs/handler-contracts.md) (Q2) and [`/learning/docs/resolver-consolidation-design.md`](./learning/docs/resolver-consolidation-design.md).

## Handler Defaults — No Hidden High-Risk Defaults (Q11) + TZ/Locale Resolution (Q12)
- High-risk defaults (auto-notify, visibility/sharing, consent/compliance, AI behavior) MUST NOT be silently supplied by handlers. The audit at [`learning/docs/handler-defaults-audit.md`](./learning/docs/handler-defaults-audit.md) is the source-of-truth list. PR-G0 lands the helpers + contracts; PR-G1..G6 apply the row-by-row decisions.
- Missing high-risk field → standardized config failure shape from [`requireExplicitField`](./lib/workflows/actions/core/requireExplicitField.ts): `{success:false, category:'config', error:{code:'MISSING_REQUIRED_FIELD', path}, message}`. Mirrors the Q2 MISSING_VARIABLE pattern.
- Per-PR rule: handler change + Zod schema marking the field required ship in the same PR-Gn. Visual UI polish (recommended-value labels) is a separate follow-up.
- **Existing-data migration** is mandatory before each PR-Gn removes a handler default. Append entries to [`lib/workflows/migrations/handlerDefaultsBackfillRegistry.ts`](./lib/workflows/migrations/handlerDefaultsBackfillRegistry.ts), then run `tsx scripts/migrate-handler-defaults.ts --pr=PR-Gn`. Idempotent: only writes when `config[fieldName]` is `undefined` / `null`. `0` / `false` are valid explicit choices and are preserved (Q5).
- **Timezone / locale resolution** uses [`resolveTimezone`](./lib/workflows/actions/core/resolveContextDefaults.ts) / `resolveLocale`: workspace setting → user setting → `'UTC'` / `'en_US'`. Reads from `workspaces.{timezone,locale}` and `user_profiles.{timezone,locale}` (added in migration `20260501000000`). Invalid IANA / empty values fall through, never hard-fail.
- Time-string validation uses [`parseTimeOrFail`](./lib/workflows/actions/core/parseTimeOrFail.ts) — strict 24h `HH:MM`. Replaces silent `'09:00'` / `'10:00'` substitutions in Calendar / Outlook handlers (audit Change rows). End-time-from-start uses `addMinutesToTime`.
- Contracts: [`/learning/docs/handler-contracts.md`](./learning/docs/handler-contracts.md) Q11 (no hidden defaults) + Q12 (tz/locale resolution).

## Webhook-First Rule
**Always use webhooks over polling when available.** Only use polling if no webhook exists or webhook requires enterprise plan.

**Webhook Checklist:**
- [ ] Check API docs for webhook/subscription support
- [ ] Implement lifecycle handler (onActivate creates webhook, onDeactivate deletes)
- [ ] Create endpoint at `/app/api/webhooks/[provider]/route.ts`
- [ ] Handle validation handshakes
- [ ] Store webhook IDs in `webhook_configs` table
- [ ] Implement subscription renewal for expiring webhooks

## API Verification Rule
Before adding ANY trigger/action field: verify API supports it, confirm payload structure, document findings in code comments with links.

## Cascading Fields Pattern
**Use for actions with 5+ fields, resource selectors, hierarchical data.**

```typescript
{
  name: "fieldName",
  label: "Field Label",
  type: "text",
  required: false,
  dependsOn: "parentFieldId",
  hidden: {
    $deps: ["parentFieldId"],
    $condition: { parentFieldId: { $exists: false } }
  }
}
```

**Reference:** `/lib/workflows/nodes/providers/stripe/index.ts` (31 cascaded fields)

## Integration Development Steps
1. Define in `availableNodes.ts` with Zod schemas
2. Add field mappings in `fieldMappings.ts`
3. Create provider loader
4. Register in provider registry
5. Create API handler
6. Implement actions
7. Add OAuth config if needed

**Guide:** `/learning/docs/integration-development-guide.md`

## Field Dependencies Pattern
```typescript
setLoadingFields(prev => {...add dependent...});
setValue('dependent', '');
resetOptions('dependent');
setTimeout(() => {
  loadOptions('dependent', 'parent', value, true).finally(() => {
    setLoadingFields(prev => {...remove dependent...});
  });
}, 10);
```

---

# SECTION 7 — UI, SECURITY & TESTING

## UI Rules

### Light & Dark Mode — MANDATORY
Design for both modes simultaneously. Light: `bg-blue-100`, `text-blue-800`. Dark: `dark:bg-blue-500/20`, `dark:text-blue-300`. Always use `variant="outline"` for custom Badge colors. Test both modes for WCAG AA contrast.

### Configuration Modals
- **NEVER use ScrollArea** — **ALWAYS use ConfigurationContainer**
- See `/learning/docs/modal-column-overflow-solution.md`

## Security

### CORS
```typescript
import { handleCorsPreFlight, addCorsHeaders } from '@/lib/utils/cors'
```
**NEVER use `Access-Control-Allow-Origin: *` with credentials.** Security headers (nosniff, DENY, CSP, HSTS) are automatically included.

### General
No token logging. Encrypted storage (AES-256). Scope validation. OAuth best practices. RLS policies.

### Admin Authorization Architecture
**Three-layer enforcement:** Middleware (JWT claims) → API route (`requireAdmin()`) → Action-scoped helpers.

**Capabilities:** `super_admin` (grants all), `user_admin`, `support_admin`, `billing_admin`. Stored as JSONB on `user_profiles.admin_capabilities`. Synced to JWT via `sync_access_claims` DB trigger.

**Key files:**
- Types: `/lib/types/admin.ts` — `AdminCapability`, `hasCapability()`, `validateCapabilities()`
- Auth guard: `/lib/utils/admin-auth.ts` — `requireAdmin({ capabilities?, stepUp? })`
- Cron guard: `/lib/utils/cron-auth.ts` — `requireCronAuth(request)`
- Audit: `/lib/utils/admin-audit.ts` — `logAdminAction()`
- Scoped helpers: `/lib/admin/userActions.ts`, `betaTesterActions.ts`, `waitlistActions.ts`
- Step-up: `/app/api/admin/verify-identity/route.ts`
- Frontend: `/components/admin/StepUpAuthDialog.tsx`, `/hooks/useAdminAction.ts`

**Rules:**
- Every admin route MUST use `requireAdmin({ capabilities: [...] })` — no inline checks
- Route files MUST NOT create or receive raw service clients — use action-scoped helpers in `/lib/admin/`
- Destructive actions (delete user, change role/admin) require `stepUp: true`
- Step-up priority: MFA > provider re-auth > password > email OTP
- All admin mutations MUST call `logAdminAction()` (built into scoped helpers)
- Capability assignment restricted to `super_admin` + step-up auth
- Backwards compat: `admin=true` with empty capabilities = `super_admin`

## Testing

### Admin Debug Panel Logging — MANDATORY
**ALL debugging logs go to Admin Debug Panel, NOT console.log.**

**Client:** `import { useDebugStore } from "@/stores/debugStore"` → `logEvent()`, `logApiCall()`, `logApiResponse()`, `logApiError()`
**Server:** `import { logger } from "@/lib/utils/logger"` → `logger.debug()`, `logger.error()`
**Requirements:** Follow `/learning/docs/logging-best-practices.md`. NO tokens, keys, PII in logs.

**Unit:** Jest + RTL | **Browser:** Follow `/PLAYWRIGHT.md`

## Documentation Requirements
Document immediately when: bug fix >30 min, gotcha/edge case discovered, new integration implemented, API works differently than expected, reusable pattern found.

**Where:** Bug fixes → `/learning/walkthroughs/`. Actions/Triggers → `/learning/docs/action-trigger-implementation-guide.md`. Architecture → `/learning/docs/`. Changes → `/learning/logs/CHANGELOG.md`.

---

# SECTION 8 — WORKFLOW INTELLIGENCE SYSTEMS

## Task Cost Visibility & Billing

### Architecture
The server is the **only authoritative cost source**. Client-side estimation is for passive builder hints only.

The cap is enforced inside the Postgres RPC `deduct_tasks_if_available` (defined in `supabase/migrations/20260504000004_rpc_v3_packs.sql`). Its decision tree consumes in priority order: **plan → pack → overage → 402**. All TS callers are pass-through.

| File | Purpose |
|------|---------|
| `lib/featureFlags.ts` | `LOOP_COST_EXPANSION`, `OVERAGE_BILLING`, `TASK_PACKS` flags |
| `lib/workflows/cost-preview.ts` | `computeCostPreview()` — **single source of truth** for cost computation |
| `lib/workflows/cost-calculator.ts` | Node-level pricing (triggers=0, actions=1, AI=1-5, logic=0) |
| `lib/workflows/taskDeduction.ts` | Server deduction — calls the RPC; reads back `packAmount`, `overageAmount`, `overageRateCents` |
| `lib/workflows/loop-cost-estimator.ts` | Client-side passive estimate only — never authoritative |
| `app/api/workflows/[id]/preview-cost/route.ts` | Authoritative pre-run cost preview API; returns `overage` field |
| `components/workflows/builder/ExecutionCostConfirmDialog.tsx` | Pre-execution confirmation (shows overage cost when run will spill into overage) |
| `lib/billing/overage-toggle.ts` | `enableOverageForUser` / `disableOverageForUser` — adds/removes Stripe metered subscription_item |
| `lib/billing/overage-reporter.ts` | Drains `task_overage_events` to Stripe usage records (deterministic idempotency key) |
| `lib/billing/auto-buy.ts` | `triggerAutoBuyIfEnabled` — off-session pack purchase via `paymentIntents.create` |
| `app/api/cron/report-overage/route.ts` | Daily cron: pushes overage usage to Stripe |
| `app/api/cron/usage-alerts/route.ts` | Daily cron: 80%/100%/overage-activated/pack-depleted email alerts |
| `app/api/cron/reset-task-usage/route.ts` | Period reset safety net — also resets `overage_tasks_used` |
| `app/api/billing/overage/route.ts` | GET/POST overage opt-in + cap multiplier |
| `app/api/billing/packs/checkout/route.ts` | One-time pack purchase via Stripe Checkout `mode: 'payment'` |
| `app/api/billing/packs/route.ts` | GET pack state + history; PATCH auto-buy toggle |
| `components/billing/OverageToggle.tsx` | Subscription-page card: switch + cap slider |
| `components/billing/TaskPackSection.tsx` | Subscription-page card: balance + buy button + auto-buy + history |
| `app/(app)/admin/billing/page.tsx` | Admin read-only view of all users' billing state |

### Parity Invariant
The RPC writes to multiple counters atomically inside its `FOR UPDATE` lock. These must always sum:

```
sum(task_billing_events.amount where source != 'period_reset' and event_type != 'pack_purchase' and event_type != 'pack_refund')
  = sum(metadata.plan_consumed)   -- equals user_profiles.tasks_used per period
  + sum(metadata.pack_consumed)   -- equals sum(pack_purchases.tasks_consumed)
  + sum(metadata.overage_consumed) -- equals user_profiles.overage_tasks_used per period
```

The denormalized cache `user_profiles.task_pack_balance` must always equal `sum(pack_purchases.tasks_remaining where status='paid')` for that user.

### Feature flags
- `ENABLE_LOOP_COST_EXPANSION` — `false` default. `false`: loops charged at flat cost. `true`: worst-case (inner × max iterations, capped at 500).
- `ENABLE_OVERAGE_BILLING` — `false` default. Controls whether the execute route exposes overage to users (RPC-side overage works regardless once `user_profiles.overage_enabled = true`, but the toggle UI checks the flag).
- `ENABLE_TASK_PACKS` — `false` default. Controls whether the auto-buy fire-and-forget is triggered at the 402 path. Manual pack purchase via `/api/billing/packs/checkout` works regardless.

### Tables
- `task_billing_events` — append-only ledger. Idempotency: UNIQUE `(user_id, execution_id, event_type)`.
- `task_overage_events` — overage-only sub-ledger + Stripe-reporting queue. UNIQUE `(user_id, execution_id)`. Drained by report-overage cron.
- `pack_purchases` — one-time pack purchase ledger. UNIQUE `stripe_checkout_session_id`. FIFO consumption ordered by `paid_at`.

### Stripe configuration
- Subscription prices: `plans.stripe_price_id_monthly/yearly` (created via `scripts/setup-stripe-prices.ts`).
- Metered overage prices: `plans.stripe_metered_price_id_monthly/yearly` (created via `scripts/setup-stripe-metered-prices.ts`). Yearly prices use `billing_thresholds.usage_gte: 1000` to force monthly invoicing per decision #9.
- One-time pack prices: `plans.stripe_pack_price_id` (created via `scripts/setup-stripe-pack-prices.ts`).
- Webhook URL: `/api/webhooks/stripe-billing` (NOT `/api/webhooks/stripe` — that route was deleted; events: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.payment_{succeeded,failed}`, `charge.refunded`, optional `customer.subscription.trial_will_end`).

### Rules
- `computeCostPreview()` is **pure** — no feature flags inside. Callers derive `chargedCost` externally.
- Confirmation dialog **fails closed** — if preview API fails, execution is blocked.
- Client estimator must stay minimal. If it needs to grow, replace with debounced preview API call.
- Billing event metadata is persisted via awaited UPDATE after RPC write.
- Reconciliation query: `scripts/reconcile-billing-metadata.sql`
- Tests: `__tests__/workflows/cost-preview.test.ts` (21 tests for cost preview); `__tests__/billing/` (29 tests across overage-toggle, overage-reporter, auto-buy).

### Pack consumption order (decision #6)
The RPC consumes from tiers in this order:
1. Plan tasks (free portion of subscription)
2. Pack balance (pre-paid, FIFO across pack_purchases.paid_at)
3. Overage budget (pay-as-you-go, capped at `overage_cap_multiplier × tasks_limit`)

Rationale: customers consume what they pre-paid before getting charged extra. Pack tasks never expire (decision #5) — they survive period rolls and plan downgrades.

---

## Shared AI Utilities (`/lib/ai/`)
All AI/LLM infrastructure is centralized here. Do NOT create inline clients or hardcode model strings.

| File | Purpose |
|------|---------|
| `openai-client.ts` | Single shared client — use `getOpenAIClient()` (or `getOpenAIClientWithKey(apiKey)` for user-supplied keys) |
| `anthropic-client.ts` | Single shared client — use `getAnthropicClient()` (or `getAnthropicClientWithKey(apiKey)` for user-supplied keys) |
| `models.ts` | Centralized config — use `AI_MODELS.planning`, `.fast`, `.utility`, `.configuration` |
| `llm-retry.ts` | `callLLMWithRetry()` — retry, timeout, model fallback |
| `token-utils.ts` | Token-aware conversation history truncation |
| `plan-cache.ts` | LLM planning cache (5-min TTL, 100 entry max) |
| `template-catalog.ts` | DB template loader for planner context |
| `stream-workflow-helpers.ts` | Extracted SSE helpers — all helpers go here, never inline in route |

**Rules:**
- `import { getOpenAIClient } from '@/lib/ai/openai-client'` — never `new OpenAI()`
- `import { getAnthropicClient } from '@/lib/ai/anthropic-client'` — never `new Anthropic()`
- `import { AI_MODELS } from '@/lib/ai/models'` — never hardcode `'gpt-4o'` or `'gpt-4o-mini'` at runtime selection points (price-book lookups and UI dropdown options are exempt — see `aiAgentAction.ts:calculateCost` and `aiAgentNode.ts:options`)
- `import { callLLMWithRetry } from '@/lib/ai/llm-retry'` — never raw `openai.chat.completions.create()`

## Lazy Client Initialization — MANDATORY
**NEVER initialize API clients at module level.** Module-level `new Stripe(...)`, `new OpenAI(...)`, `new Anthropic(...)`, `new Resend(...)` execute during `next build` and fail when env vars are missing (CI).

- **OpenAI:** `getOpenAIClient()` from `lib/ai/openai-client.ts`
- **Anthropic:** `getAnthropicClient()` from `lib/ai/anthropic-client.ts`
- **Stripe:** `getStripeClient()` from `lib/stripe/client.ts`
- **Resend:** `getResendClient()` in `lib/notifications/email.ts`

**CI expects zero dummy env vars** — the build must pass without any API keys.

## Planning Pipeline
**Entry point:** `planEdits()` in `src/lib/workflows/builder/agent/planner.ts`

```
User Prompt → Unsupported feature detection → Refinement check
  → LLM Planner (3-stage: node selection → configuration → edge/layout)
  → Pattern Fallback (4-tier: fast-path → DB template → lightweight LLM → clarifications)
```

## Self-Growing Template Pool
Published templates are automatically available to the planner. Tier 2 matches keywords ($0). Tier 3 includes catalog as LLM context. Coverage grows without code changes.

**Key files:** `/lib/ai/template-catalog.ts`, `/lib/workflows/ai-agent/dynamicTemplates.ts`, `/lib/workflows/ai-agent/templateMatching.ts`

## SSE Streaming
Route: `/app/api/ai/stream-workflow/route.ts` — delegates to `/lib/ai/stream-workflow-helpers.ts`. **DO NOT add inline helpers to the route file.**

## Tests
`__tests__/workflows/v2/agent/`: `planner.patterns.test.ts` (14 tests), `planner.llm-fallback.test.ts` (10 tests), `shared-utilities.test.ts` (18 tests)

---

# SECTION 9 — DEVELOPMENT SETUP

## Commands
```bash
npm run dev           # Live dev server (user typically has running)
npm run build         # Production build — ASK FIRST
npm run lint          # Run linter
```

## Supabase Database
```bash
supabase migration new <name>
supabase db push --db-url "$POSTGRES_URL_NON_POOLING"  # port 5432, NOT 6543
```
**Always use `--db-url` with non-pooling URL.** Pooler connections cause SASL auth errors. Get URL from `.env.local`: `POSTGRES_URL_NON_POOLING`.

**Migration rules:** Never modify existing migrations after push. Create new migrations for changes. Test locally first.

## Directory Structure
- `/app` — Routes, APIs, pages
- `/components` — UI components
- `/lib` — Database, integrations, workflows
- `/lib/ai` — Shared AI/LLM utilities
- `/src/lib/workflows/builder/agent` — AI planner
- `/stores` — Zustand state
- `/scripts` — Production utilities
- `/scripts/trash` — One-off scripts (can be deleted)
- `/learning` — Documentation

## Script Management
**One-off scripts go in `/scripts/trash`.** Production scripts stay in `/scripts` root.

When `/scripts/trash` has 5+ files, proactively tell the user. See `/scripts/README.md`.

## Git Workflow
NO automatic commits/push unless explicitly asked.

---

# SECTION 10 — DEEP GOTCHAS & REFERENCE

> Historical bugs, DO-NOT-TOUCH zones, and implementation quirks that encode hard-won debugging knowledge. Lower priority for day-to-day work, critical when touching these specific areas.

## Workflow Builder Edge Alignment — DO NOT CHANGE
**File:** `/components/workflows/builder/FlowEdges.tsx`

**Problem:** React Flow renders edges before node positions exist → edges fall back to X=0, snap far left, + button appears under previous node.

**Solution:** `DEFAULT_COLUMN_X` constant (400) for fallback. `getNodeWidth` helper handles missing position data. Vertical edges compute center from whichever node has a known position. Both nodes missing → linear column layout fallback. Both endpoints share same X coordinate.

**DO NOT MODIFY this alignment logic.** Any changes must preserve the fallback for missing `positionAbsolute` data.

## Auth Store Guardrails
- `stores/authStore.ts` clears initialization watchdog as soon as session exists
- Keep `clearInitTimeout()` and early `set({ user, initialized: true })` calls
- `Profile` objects MUST include `email`, `provider`, and `admin_capabilities`
- Use `@/utils/supabaseClient` for all client-side Supabase access
- `PROFILE_COLUMNS` in `authBootMachine.ts` and `PROFILE_SELECT` in `ensureUserProfile.ts` must stay in sync — both include `admin_capabilities`

## AI Agent Cold Start Bug
**Symptom:** Agent stuck on "Outline the flow to achieve the task" after cold dev restart.
**Root Cause:** `chatHistoryLoaded` waits for `authInitialized` which can be slow.
**Files:** `hooks/workflows/builder/useChatPersistence.ts`, `lib/workflows/ai-agent/templateMatching.ts`
**Fix:** 3-second timeout in useChatPersistence, reduced dynamic template loading timeout from 10s to 3s.

## Integration Status Not Showing
- Check `fetchIntegrations()` and verify store data
- Keep `status === 'connected'`
- Update `providerMappings` in `isIntegrationConnected`
- See `/learning/walkthroughs/integration-connection-status-fix.md`

## Loop Progress Tracking
**Files:** Migration: `/supabase/migrations/20251106000000_create_loop_executions_table.sql` | Handler: `/lib/workflows/actions/logic/loop.ts` | UI: `/components/workflows/execution/LoopProgressIndicator.tsx`

## Template Positioning
Start 400,100 | Vertical 160-200px | Horizontal 400px branches.
**Required fields:** name, description, category, nodes, connections, is_public, is_predefined, created_by.
**Guides:** `/learning/docs/template-management-supabase-guide.md`, `/learning/docs/template-quick-reference.md`

## Error Handling UX — Plain-English Errors + One-Click Retry + Humanized Notifications
Workflow failure UX — three coordinated surfaces (in-builder dialog, push notifications, in-app bell) all driven from one persisted `error_classification jsonb` snapshot.

**Data layer:**
| File | Purpose |
|------|---------|
| `lib/workflows/errors/humanizeActionError.ts` | Pure humanizer — Q1 category → `{title, description, hint, action, severity}`. Heuristic fallback when category absent. |
| `lib/workflows/errors/classifyExecutionFailure.ts` | DB helper — pulls first failed step from `execution_steps`, calls humanizer, adds `firstFailedNodeId` + `failedNodeCount`. |
| `app/api/executions/[executionId]/retry/route.ts` | Full-rerun retry. Loads original `trigger_data`, forwards to `/api/workflows/execute` with cookie passthrough. Original execution row never mutated. |
| `lib/services/workflowExecutionService.ts` | Calls `classifyExecutionFailure` at both finalization paths (engine crash + normal-with-errors), then fires `notifyWorkflowFailure`. |
| `supabase/migrations/20260505000000_add_error_classification_to_execution_sessions.sql` | Adds `error_classification jsonb`. |
| `supabase/migrations/20260505000001_add_error_notifications_sent_at.sql` | Adds `error_notifications_sent_at TIMESTAMPTZ` for one-shot notification dedup. |

**Live builder UI (v2):**
| File | Purpose |
|------|---------|
| `app/(app)/workflows/v2/api/flows/[flowId]/runs/history/route.ts` | v2 history endpoint. Returns `errorClassification` + `errorMessage` per run. |
| `components/workflows/builder/WorkflowHistoryDialog.tsx` | **Live** v2 dialog. List shows compact `<ClassifiedErrorCard>` per failed run; detail view renders full card + Retry button + step list. Auto-jumps to detail via `pendingExecutionId` prop from `?historyExecution=` deep link. |
| `components/workflows/builder/BuilderHeader.tsx` + `WorkflowBuilderV2.tsx` | Plumbs `?historyExecution=` from URL → `BuilderHeader` → `WorkflowHistoryDialog`; strips param after consumption. |
| `components/workflows/ClassifiedErrorCard.tsx` | Pure render — humanized card + CTA (`reconnect` → `/integrations`, `open_node` → builder w/ `?focusNode=&historyExecution=`, `upgrade_plan` → `/subscription`) + technical-details disclosure. |

**Notification fan-out** (one classification → email / Slack / Discord / SMS / in-app):
| File | Purpose |
|------|---------|
| `lib/notifications/errorHandler.ts` | Orchestrator. Atomically claims `error_notifications_sent_at` for dedup, looks up classification, builds payload, fans out. Exposes `notifyWorkflowFailure(supabase, workflowId, errorDetails)`. |
| `lib/notifications/workflowFailurePayload.ts` | Pure builder — one `WorkflowFailurePayload` shape consumed by all channels. CTA URL routing: `null` action → History deep link `/workflows/builder/{id}?historyExecution={executionId}`. |
| `lib/notifications/email.ts` | Humanized HTML + plain-text. Accent card with title / description / hint / CTA button / collapsed `<details>` Technical Details. |
| `lib/notifications/slack.ts` | Block kit: header / description / hint context / workflow + failed-step fields / CTA button / truncated technical context. |
| `lib/notifications/discord.ts` | Embed with inline fields + CTA as markdown link + truncated technical code block. |
| (SMS — inline in `errorHandler.ts`) | Terse only: `ChainReact: ${title} — workflow "${name}".` No URL. |
| (In-app — inline in `errorHandler.ts`) | Inserts into `notifications` table with `type='workflow_failed'`, deep-link `action_url`. Default-enabled when `error_notifications_enabled` is true; opt out via `settings.error_notification_in_app = false`. |

**Notification orchestration** is called from both `workflowExecutionService` finalization paths. Pre-existing fallback calls in `app/api/workflows/execute/route.ts` catch and `advancedExecutionEngine` catch still fire for pre-execution / pre-finalization errors. Idempotency: orchestrator atomically claims `error_notifications_sent_at` so only one fan-out happens per execution.

**Retry semantics — v1: full rerun only.**
- Creates new execution session via standard execute pipeline. Original is `failed` and unchanged.
- `source = 'retry'`, `retryOf = originalSessionId` (already wired in execute route).
- Q4 idempotency keys are session-scoped → side effects from prior successful steps may fire again on retry. Stripe `Idempotency-Key` follows session id, so retry uses a fresh key.
- Resume-from-failed-node + cross-session side-effect dedupe: **Phase 1 (PR-R1a) shipped 2026-05-04, Phase 2+ paused** pending [v2 canonical execution engine consolidation](./learning/docs/v2-canonical-execution-engine-plan.md). Project doc: [Safe resume-from-failed-node execution](./learning/docs/safe-resume-from-failed-node-project.md). Implementation plan: [safe-resume-from-failed-node-implementation-plan.md](./learning/docs/safe-resume-from-failed-node-implementation-plan.md). Feature flag `ENABLE_RESUME_FROM_FAILED_NODE` stays `false`. PR-R1a's lineage helpers + migrations are engine-agnostic and survive the consolidation; Phase 2 resumes on v2 after cutover. See also [`/learning/docs/error-handling-ux.md`](./learning/docs/error-handling-ux.md) "Follow-up" section.

**Pre-launch engine consolidation in flight:** the codebase runs two execution engines — v1 ([lib/execution/advancedExecutionEngine.ts](./lib/execution/advancedExecutionEngine.ts)) for live/sequential traffic and v2 ([lib/services/workflowExecutionService.ts](./lib/services/workflowExecutionService.ts)) for sandbox/test mode. v2 owns `execution_steps`, HITL pause/resume, strict pre-resolution (Q2 contract), error classification, test-mode interception, and workspace-tier locale resolution; v1 owns parallel execution and the live entry paths. Plan: make v2 canonical, port v1's responsibilities to v2 behind `ENABLE_V2_LIVE_EXECUTION`, then delete v1. See [v2-canonical-execution-engine-plan.md](./learning/docs/v2-canonical-execution-engine-plan.md).

**Active guidance during the consolidation:**
- **Do not add new responsibilities to v1.** All net-new work goes on v2.
- **Do not build resume-from-failed-node on v1.** Resume Phase 2+ paused until Phase 5 stage 3 of the consolidation lands (global v2 default flip).
- **Prefer v2 patterns** (`DataFlowManager`, `executionHistoryService`, `nodeExecutionService.preResolveConfigStrict`) when extending engine behavior.
- **Asymmetric error classification is acceptable.** v1 will not gain `execution_steps` writing — the gap closes when v1 is deleted.
- **Decisions:** billing gate lifts into `WorkflowExecutionService`; per-user opt-in is `user_profiles.opt_in_v2_execution boolean`; PR-R1a's lineage helpers are engine-agnostic and survive the cutover.

**testMode safety (audit complete 2026-05-04):** Engine-level pre-call gate at [nodeExecutionService.ts:executeNode](./lib/services/nodeExecutionService.ts) refuses to invoke external-action handlers when `context.testMode && isExternalAction(nodeType) && actionMode !== EXECUTE_ALL`. Covers all 44 explicit dispatch cases that previously fired real provider calls in test mode (audit findings: [v2-testmode-audit-findings.md](./learning/docs/v2-testmode-audit-findings.md)). Read-only operations (fetch/get/list/search/find) still execute. Per-handler Q8d (`if (meta?.testMode) return ...`) remains valuable as defense-in-depth and for the v1 fallback path; ~22 handlers tracked as backlog in the findings doc.

**PR-V2C registry fallback (shipped 2026-05-04):** `lib/services/executionHandlers/registryFallback.ts` routes node types without explicit v2 switch cases through `executeAction` (v1's registry-based dispatch). Used at every `default:` branch in `IntegrationNodeHandlers`, `ActionNodeHandlers`, `AIActionsService`, and the per-provider services. Test-mode short-circuit returns `{ __testModeFallback: true, ... }` mock instead of calling `executeAction`, so zero real provider calls via the fallback in test mode.

**Follow-up cleanup:** `components/workflows/ExecutionHistoryModal.tsx` is dead code (zero call sites; the live dialog is `WorkflowHistoryDialog`). After the v2 dialog is verified in production, delete the file or extract truly-shared pieces into reusable components.

**Tests:** `__tests__/workflows/humanizeActionError.test.ts` (23 tests).

## Critical Reference Guides
- **Logging:** `/learning/docs/logging-best-practices.md`
- **Modal Overflow:** `/learning/docs/modal-column-overflow-solution.md`
- **Field Implementation:** `/learning/docs/field-implementation-guide.md`
- **Workflow Execution:** `/learning/docs/workflow-execution-implementation-guide.md`
- **Action/Trigger:** `/learning/docs/action-trigger-implementation-guide.md`
- **CORS Security:** `/learning/docs/cors-security-guide.md`
- **Error Handling UX:** `/learning/docs/error-handling-ux.md`
