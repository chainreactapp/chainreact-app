# Rule: Project Structure and Module Boundaries

## Purpose

Define the official ChainReactV2 folder structure, what each top-level folder owns, what each may import, what is forbidden, and how to keep the new repo from re-creating V1's monolithic architecture. This rule applies **globally across the entire app**, not just the workflow builder.

The other rule docs each define one subsystem. This doc is the *whole-codebase* rule that all the others sit inside. When in doubt about where new code belongs, this is the source of truth.

## Resolved Decisions

**Locked for Slice 1:**
- Top-level folder structure (§3) is the official V2 layout. No new top-level folders without a rule-doc update.
- Import-boundary rules (§4) are enforced via ESLint and CI checks. Violations block PRs.
- Client/server boundary (§5): client never imports server-only modules. Path is **component → feature hook / slice action → `lib/api/<domain>.ts` → API route → service → repository → database**.
- File-size rule (§6): target < 300 lines, hard cap < 500 lines with PR-comment exception process per master plan §8. No method > 50 lines without justification.
- Single-source-of-truth ownership (§7) is locked. New code with overlapping ownership lands in the existing owner, not a new file.
- Naming conventions (§8) are locked.
- Required lint / CI guards (§10) implemented as part of repo skeleton.

**Deferred decisions:**
- Whether to add `dependency-cruiser` for graph-level boundary checking in addition to ESLint. Slice 1: ESLint-only, revisit if violations slip through.
- Granularity of leaf-folder file-count check (currently 50). Tunable post-Slice 1.

**Decisions requiring product-owner input:**
- None for Slice 1.

## Current V1 problem being solved

V1's structure is the root cause of most of the issues the other rule docs address:

- **Monolithic files** — `WorkflowBuilderV2.tsx` (8,032 lines), `useWorkflowBuilder.ts` (3,640 lines), `provider-registry.ts` (1,595 lines), `webhooks/microsoft/route.ts` (2,475 lines).
- **Unclear ownership boundaries** — no rule for what goes in `lib/` vs `services/` vs `hooks/` vs `stores/`. The same logic appears in three places.
- **React components import backend concerns** — components calling `fetch()` directly, components reading database state, components implementing business rules in `useEffect`.
- **Duplicated logic across `lib/`, `app/api/`, `hooks/`, `stores/`** — variable resolution exists in three independent paths; OAuth scopes are defined in two files.
- **Provider logic spread across multiple trees** — Slack handlers in `lib/workflows/actions/`, Slack schemas in `lib/workflows/nodes/providers/slack/`, Slack OAuth in `lib/integrations/`, Slack webhooks in `app/api/webhooks/slack/`. No single Slack folder.
- **Service / repository / domain logic mixed together** — route handlers do business logic, services touch DB directly, "core" logic lives in stores.
- **Dead scripts / docs / trash** — `scripts/trash/` is a self-acknowledged dumping ground.
- **No clear answer to "where do I put this?"** — onboarding takes weeks.

V2 fixes this by giving every concern a single, named owner.

## V2 top-level folder structure

```
chainreact-v2/
├── app/
├── features/
├── components/
├── core/
├── workflow-engine/
├── integrations/
├── services/
├── repositories/
├── contracts/
├── stores/
├── lib/api/
├── tests/
├── docs/
├── scripts/
└── supabase/migrations/
```

### `app/` — Next.js routes only

- Pages, layouts, API route shells.
- API route files are **thin** — typically < 50 lines.
- No business logic. Routes parse input, dispatch to a service, format the response.
- No `supabase.from()`. No direct repository writes from a route.
- Server actions land here too, with the same thinness rule.

### `features/` — feature-level UI, hooks, client orchestration

- One folder per feature: `workflow-builder/`, `integrations/`, `billing/`, `admin/`, `auth/`.
- Each feature owns its UI, hooks, and feature-local state slices.
- May call typed client API functions in `lib/api/`.
- May NOT import repositories or server services directly.
- Feature-local state slices live under `features/<feature>/state/`, NOT in top-level `stores/`.

### `components/` — reusable presentational UI

- shadcn/ui wrappers, layout components, generic form/field renderers.
- No business logic.
- No `fetch()`.
- No `supabase.*` access.
- No domain knowledge — `components/` does not know about workflows, billing, or integrations.

### `core/` — pure business rules

- Lifecycle rules, billing rules, auth/session rules, error classification and humanization, trigger lifecycle rules, admin authorization rules, AI shared utilities (clients, retry, models).
- Framework-agnostic where possible (no Next.js, no React imports).
- Heavily unit-tested per testing-strategy.md.

### `workflow-engine/` — execution orchestration

- Execution engine, variable resolution, run lifecycle, execution context, session-side-effects idempotency, cost preview / calculation.
- The **only owner** of runtime execution behavior. No execution branches in routes, services, or stores.

### `integrations/` — provider-specific adapters

- One folder per provider.
- Each provider folder contains: `manifest.ts`, `oauth.ts`, `client.ts`, `actions/`, `triggers/`, `webhooks/`, optional `ui.ts`.
- No cross-provider dependency. A Slack file never imports a Gmail file.
- Provider-specific action / trigger Zod schemas live next to the handlers (`integrations/<p>/actions/<action>.schema.ts`), NOT in `contracts/`.

### `services/` — application orchestration

- API routes call services. Services compose core + workflow-engine + integrations + repositories.
- Services enforce authorization, lifecycle preconditions, billing gates, and workflow rules.
- Server-side only. Never imported by client code.

### `repositories/` — database access only

- All Supabase reads/writes live here.
- No business rules.
- No React, no hooks, no UI imports.
- Server-side only. Never imported by client code.
- The single service-role client helper lives at `repositories/supabase/serviceRoleClient.ts`. Other repositories import from here when they legitimately need RLS bypass — they never construct their own service-role client. (See [database-security.md](./database-security.md).)

### `contracts/` — shared cross-layer types and Zod schemas

- Generic platform contracts: `handler.ts` (Q1-Q12 codified), `trigger.ts` (TriggerLifecycle interface), `workflow.ts`, `integration.ts` (ProviderManifest), `billing.ts`, `triggerEvent.ts`, `billingEvent.ts`, `providerEvent.ts`.
- Provider-specific action / trigger schemas do NOT live here — they stay colocated with the provider.

### `stores/` — global client stores only

- `authStore.ts`, `authBootMachine.ts`, `uiStore.ts`. Anything truly app-global.
- Feature-specific stores live under `features/<feature>/state/`, not here.

### `lib/api/` — typed client API functions

- Thin wrappers over `fetch` against V2 server routes.
- Used by feature hooks and client-side slice actions.
- No business rules. No `supabase.*` access.
- The single bridge between client code and server routes.

### `tests/` — unit, integration, parity, e2e

- Layout per testing-strategy.md.
- Mirrors source tree structure where practical.

### `docs/` — rules, architecture, runbooks, handler contracts

- `docs/rules/` — per-subsystem rule docs (this doc and the seven peers).
- `docs/handler-contracts.md` — Q1-Q12 carried forward from V1.
- `docs/architecture/` — design notes that don't fit a single rule.
- `docs/runbooks/` — operational procedures (cutover, incident response).

### `scripts/` — operational scripts only

- No `trash/` folder in V2. Disposable scripts are deleted, not retained.
- Each script needs a clear purpose, documented inputs, and safe execution instructions in a header comment.

### `supabase/migrations/` — clean V2 migration sequence

- No blind replay of V1's incremental migration history. V2 starts with a consolidated initial migration plus forward-only additions.
- **Every migration that creates a user-data or tenant-data table MUST enable RLS and define at least one policy in the same migration.** CI lints for this. See [database-security.md](./database-security.md) for the migration template, encryption rules, service-role boundaries, and per-table policy tests.

## Import boundary rules

Allowed import directions, by source folder:

| Source | May import from |
|---|---|
| `components/` | `contracts/`, `components/`, UI utility libraries, NOT business or backend code |
| `features/` | `components/`, `contracts/`, `lib/api/`, `features/<self>/`, `core/` (read-only utilities only) |
| `lib/api/` | `contracts/`, fetch primitives. Nothing else. |
| `app/api/` | `services/`, `contracts/`, framework primitives |
| `services/` | `core/`, `workflow-engine/`, `integrations/`, `repositories/`, `contracts/` |
| `workflow-engine/` | `core/`, `integrations/`, `contracts/`, `repositories/` only via services where possible (direct repo access permitted only for run/lineage persistence that has no service layer) |
| `core/` | `contracts/`. No app, features, components, repositories, services, or stores. |
| `integrations/<p>/` | `contracts/`, `core/` helpers, `integrations/<p>/` siblings |
| `repositories/` | Supabase client, `contracts/`. No services, no domain logic. |
| `stores/` | `contracts/`, `lib/api/` if client-safe. Never repositories or services. |

**Explicitly forbidden:**

- Components importing repositories.
- Components importing server services.
- Features importing repositories.
- Zustand slices (anywhere) importing repositories or server services.
- API route files containing business logic — only validation, dispatch, and response shaping.
- Repositories importing services.
- Core importing from `app/`, `features/`, `components/`, `repositories/`, `services/`, or `stores/`.
- Integrations importing another provider's implementation files.
- Direct Supabase access outside `repositories/`, `core/auth/`, and test helpers.
- Duplicate helper implementations when a `core/` or `lib/api/` helper already exists.
- `services/` imported into client-side code at all (any file under `app/(app)/`, `app/(marketing)/`, `features/`, `components/`, `stores/`, or `lib/api/`).

## Client/server boundary

The locked end-to-end flow for any client action that touches the server:

```
Client component
   ↓ (feature hook or slice action)
Feature hook / slice action
   ↓ (calls typed client API)
lib/api/<domain>.ts          ← only client-side caller of the server
   ↓ (HTTP)
Next.js API route or server action          ← thin shell, no business logic
   ↓
service in services/<domain>/
   ↓
repository in repositories/<domain>.ts
   ↓
database (Supabase)
```

Server-side flows (cron jobs, server-rendered pages, server actions) may call services directly — they are already on the server side. They still **never** call repositories without going through a service.

The single exception is `core/auth/` for cached-token / session reads on the client; this is the PR-AUTH series invariant and is documented in the auth rule.

## File-size and monolith rules

- **Target file size:** under 300 lines.
- **Hard cap:** under 500 lines, with a PR-comment exception process per master plan §8 (the exception comment must explain why the file genuinely cannot be split).
- **Method / function size:** no function over 50 lines without justification.
- **Provider config UI files:** split by tab or by section if they grow.
- **Route handlers:** typically under 50 lines. API routes do not contain business logic.
- **Leaf-folder count:** no directory leaf may exceed 50 files. CI check enforces this.

## Single-source-of-truth rules

Each row below names the canonical owner of one concern. New code with overlapping ownership belongs in the existing owner; if the existing owner is too large, split *within* its module before creating a parallel implementation.

| Concern | Single owner |
|---|---|
| Workflow lifecycle rules | `core/workflows/lifecycle.ts` |
| Lifecycle projections (UI display, executable, billable) | `core/workflows/projections.ts` |
| Variable resolution | `workflow-engine/variables/resolveValue.ts` |
| Provider capabilities + scopes | `integrations/<provider>/manifest.ts` |
| Provider registry aggregation | `integrations/_registry.ts` |
| OAuth flow (generic + per-provider) | `services/oauth/dispatcher.ts` + `integrations/<provider>/oauth.ts` |
| Webhook signature verification + parsing | `integrations/<provider>/webhooks/receive.ts` |
| Webhook event normalization | `integrations/<provider>/webhooks/normalize.ts` |
| Trigger event dispatch | `core/triggers/dispatch.ts` |
| Trigger lifecycle (activate/deactivate/poll/webhook) | `core/triggers/TriggerLifecycleManager.ts` |
| Billing gate | `core/billing/executionBillingGate.ts` + Postgres RPC `deduct_tasks_if_available` |
| Cost preview / calculation | `workflow-engine/cost/cost-preview.ts` |
| Execution behavior | `workflow-engine/` |
| Run history / lineage | `workflow-engine/runs/` |
| Idempotency (session side effects) | `workflow-engine/idempotency/` |
| Error humanization | `core/errors/humanizeActionError.ts` |
| Health transition engine | `core/integrations/healthTransitionEngine.ts` |
| Notification fan-out | `services/notifications/` |
| Auth header / token cache | `core/auth/getAuthHeader.ts` + `stores/authStore.ts` |
| Admin authorization | `core/admin/` |
| Builder state | `features/workflow-builder/state/` |
| Client API calls | `lib/api/<domain>.ts` |
| Database access | `repositories/<table>.ts` |
| Service-role Supabase client (RLS bypass) | `repositories/supabase/serviceRoleClient.ts` (sole construction point) |
| Application-layer token encryption | `core/encryption/tokens.ts` |
| Database security policy (RLS, tenant isolation, encryption, audit) | [database-security.md](./database-security.md) |

## Naming conventions

- **Provider folders** use stable provider IDs from V1: `slack`, `gmail`, `discord`, `notion`, `airtable`, `stripe`, etc. Backward compat for token rows during migration depends on these names.
- **Action files** use kebab-case: `send-channel-message.ts`, `create-record.ts`.
- **Trigger files** use kebab-case: `new-message-in-channel.ts`, `record-created.ts`.
- **Schema files** sit next to their handler with `.schema.ts`: `send-channel-message.schema.ts`.
- **React components** use PascalCase: `WorkflowCanvas.tsx`, `ConfigModalShell.tsx`.
- **Hooks** start with `use`: `useWorkflowGraph`, `useChannelList`, `useExecutionStatus`.
- **Services** use domain/action verbs: `services/workflows/saveNodeConfig.ts`, `services/oauth/dispatcher.ts`.
- **Repositories** use table or domain names: `repositories/workflows.ts`, `repositories/integrations.ts`.
- **Test files** name the behavior being protected (per testing-strategy.md §9): `keeps-workflow-disabled-after-reconnect.test.ts` is fine; `workflow.test.ts` is not.
- **Zustand slice files** end in `Slice.ts`: `graphSlice.ts`, `executionSlice.ts`.

## New code placement checklist

Before adding a file, every contributor answers:

- [ ] **What domain owns this?** (Workflows, integrations, billing, auth, admin, AI, ...)
- [ ] **What kind of code is this?** UI / feature orchestration / business rule / execution / provider adapter / service orchestration / database access / shared contract.
- [ ] **Does a single source of truth already exist?** If yes, the code goes there. Adding a parallel implementation needs an explicit reason.
- [ ] **Am I crossing a forbidden import boundary?** If yes, restructure before writing.
- [ ] **Could this become a monolith?** If a new file is plausibly going to exceed 500 lines, design the split now.
- [ ] **What tests prove the business behavior?** Per testing-strategy.md, name the rule and the matrix coverage before writing the test.

If any answer is unclear, the file does not get added until it is. Ask in review or update the relevant rule doc.

## Required lint / CI guards

Implemented as part of the repo skeleton:

- **No direct Supabase imports outside `repositories/`, `core/auth/`, and test helpers** (ESLint `no-restricted-imports`).
- **No `fetch(` in `components/`** (custom ESLint rule or grep-based CI check).
- **No `repositories/` imports from `features/`, `components/`, `stores/`, `lib/api/`** (ESLint `no-restricted-imports` per source folder).
- **No server `services/` imports from client-side code** (ESLint `no-restricted-imports` per source folder, mirroring the workflow-state-store boundary lint guard).
- **No zero-arg `getSession()` / `getUser()`** outside the auth allowlist (PR-AUTH-7 ESLint rule, ported forward).
- **File-size warning** at 400 lines, **error** at 500 lines (custom ESLint rule or CI check; exception via PR comment).
- **Leaf-folder file-count check** — no leaf > 50 files (CI bash check on `find <leaf> -maxdepth 1 -type f | wc -l`).
- **No `console.log` in `components/`, `hooks/`, `stores/`** (ESLint `no-console` with allow-list for server-side logger).
- **Provider folder without manifest fails CI** — every directory in `integrations/` must contain a `manifest.ts`.
- **Provider manifest not registered in `_registry.ts` fails CI** — a provider directory exists but is not imported in `_registry.ts` is a build error.
- **Migration RLS lint** — every migration creating a user-data or tenant-data table must include `ENABLE ROW LEVEL SECURITY` and at least one `CREATE POLICY` in the same file (per [database-security.md](./database-security.md)).
- **Service-role import guard** — `createClient` calls with `SERVICE_ROLE_KEY` are restricted to `repositories/supabase/serviceRoleClient.ts`.
- **No service-role exposure in client bundle** — static check scans the build output for any reference to `SUPABASE_SERVICE_ROLE_KEY`. Fails if found.

## Required tests

Boundary tests / static checks that complement the lint guards:

1. **Client / server import test:** scan files under client-side roots (`features/`, `components/`, `stores/`, `lib/api/`) for any import path matching `services/` or `repositories/`. Fails with the offending path if any are found.
2. **Repository purity test:** scan `repositories/*.ts` for imports of `services/` or any business-rule module. Fails with the offending path if any are found.
3. **Route thinness test:** for each `app/api/**/route.ts`, fail if the file exceeds 100 lines or contains any `supabase.from(` / direct DB query string. (Threshold tuned post-skeleton.)
4. **Provider manifest validation test:** every manifest under `integrations/<p>/manifest.ts` validates against `contracts/integration.ts`. Build fails on a malformed manifest.
5. **Workflow-builder slice isolation test:** no `import { use*Slice } from '../<other-slice>'` across builder slice files (per workflow-state-store rule).
6. **Slice-action repo/service guard:** scan `features/**/state/**` for imports of `repositories/` or `services/`. Fails if any are found (per workflow-state-store rule).
7. **Integration cross-provider import test:** a file under `integrations/slack/` may not import from `integrations/gmail/`, etc. Fails with the offending path.
8. **`core/` purity test:** `core/**` files may not import from `app/`, `features/`, `components/`, `repositories/`, `services/`, or `stores/`. Fails with the offending path.
9. **Service-role single-construction test:** scan the codebase for `createClient(...SERVICE_ROLE_KEY...)` calls; fail if any exist outside `repositories/supabase/serviceRoleClient.ts`.
10. **No service-role in client bundle:** scan `.next/static/**` after build for the literal string `SUPABASE_SERVICE_ROLE_KEY` or any service-role JWT pattern. Fails if found.

These tests live in `tests/structure/` and run on every PR. RLS-policy and tenant-isolation tests live in `tests/integration/security/` per [database-security.md](./database-security.md).

## Open questions

No open questions remain that block Slice 1. Any unclear structure issue gets decided in the final architecture baseline before implementation.
