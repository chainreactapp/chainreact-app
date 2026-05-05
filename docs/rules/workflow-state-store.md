# Rule: Workflow State Store

## Purpose

Define how Zustand state is organized for the workflow builder in V2. Replace V1's monolithic builder hook and store with a small set of independent slices, each owning a single concern.

## Resolved Decisions

**Locked for Slice 1:**
- Builder state split into independent slices under `features/workflow-builder/state/`: `graphSlice`, `selectionSlice`, `configSlice`, `executionSlice`. Cross-feature stores at top-level `stores/` (auth, UI).
- **Zustand store shape:** **separate small Zustand stores per slice** for Slice 1. If cross-slice orchestration becomes painful, refactor to a single composed builder store. The slice-file boundary holds in either model.
- **Slices may NOT import each other**, in either model. Cross-slice orchestration lives in `features/workflow-builder/orchestrators/` (builder-internal) or `services/workflows/` (cross-feature).
- Components access only slice selectors and actions, never the internal slice state shape.
- **Repository boundary:** **repositories are server-side only.** Client-side slice actions call **typed client API functions / feature services**, NOT repositories. Server services call repositories. Slice actions never import from `repositories/`.
- Slices target ≤ 300 lines, hard cap < 500 lines (with PR-comment exception process per master plan §8).
- Saved/pending field separation: `saved*` for server-synced state, `pending*` for in-progress edits. Save actions reconcile.
- Optimistic updates: snapshot prior state, apply update, call client API, roll back on error, surface toast via `uiStore`.
- Server reconciliation: 409 Conflict surfaces "modified elsewhere" prompt; no silent overwrite.
- Persisted slices: only UI prefs (theme, panel widths). Never workflow data; never tokens or secrets.
- Cross-tab broadcast lives in `authStore` only (per PR-AUTH-1 pattern). Builder slices are not cross-tab.
- **Slice naming for Slice 1:** four slices — `graphSlice`, `selectionSlice`, `configSlice`, `executionSlice`. `graphSlice` owns both nodes and edges. Split nodes / edges into separate slices later only if `graphSlice` grows past ~300 lines or testing becomes hard.
- **Action composition:** actions MAY call other actions inside the **same** slice (they are plain functions on the slice's get/set). Actions MAY NOT call actions across slices. Cross-slice action composition goes through an orchestrator.
- **DevTools:** Zustand DevTools enabled in development only, disabled in production builds. Stores holding any sensitive data must not be exposed to DevTools — even in dev — without an explicit redactor.

**Deferred decisions:**
- Selector co-location: in-slice for small slices, sibling `selectors.ts` once a slice grows. Trigger at implementation time.
- Selector memoization: `useShallow` for object selectors; manual `useMemo` for expensive derivations; no `reselect` dependency.

**Decisions requiring product-owner input:**
- None for Slice 1.

## Current V1 problem being solved

V1 concentrates builder state in two oversized files:

- `hooks/workflows/useWorkflowBuilder.ts` — **3,640 lines**. One hook owns: graph state, node configuration, action plumbing, UI mode (edit / preview / execute), selection, in-progress edits, dirty-tracking, save coordination.
- `stores/workflowStore.ts` — **1,338 lines**. Mixes workflow CRUD (server-synced), builder runtime (client-only), and a workflow-list cache.

Coupling between concerns means a small change (renaming a field, adding a tab to a config modal) ripples across thousands of lines. State changes have non-obvious ordering dependencies. Tests are hard to write because there is no isolated unit.

V1 also has stores well over 400 lines elsewhere (`integrationStore.ts` 1,454, `authStore.ts` 786, `billingStore.ts` 442) that the same rule applies to.

## V2 intended behavior

State is split into small Zustand slices, each owning one concern. Builder slices live under `features/workflow-builder/state/`:

```
features/workflow-builder/state/
├── graphSlice.ts          # nodes, edges, layout positions (server-synced)
├── selectionSlice.ts      # selected node id, panel mode
├── configSlice.ts         # in-progress config edits (separate from saved config)
└── executionSlice.ts      # running run id, step status, output, errors
```

Cross-feature stores live at the top level under `stores/` and are limited to truly global state:

```
stores/
├── authStore.ts           # auth state (cached token, user, profile)
├── authBootMachine.ts     # auth boot pipeline
└── uiStore.ts             # global UI: theme, command palette, toasts
```

Per-domain client state (integration list cache, billing cache, etc.) lives next to its feature, not in `stores/`.

Each slice is a small Zustand store (≤ 300 lines as a target, hard cap < 500 lines). Slices do not import each other. Cross-slice coordination, when needed, happens via explicit subscriptions inside services or hooks — not by one slice reading another's state directly.

## Single source of truth

- **Each slice** owns its state. Components read via `useGraphSlice(s => s.nodes)`. Components write via slice actions (`useGraphSlice.getState().addNode(node)`).
- **Selectors** are pure projections (`isExecutable(workflow)`, `selectedNode(state)`). Selectors live in the slice file or in a sibling `selectors.ts`.
- **Actions** are the only write API. Client-side actions call **typed client API functions** (`lib/api/<domain>.ts`) or feature services for server-synced effects. Actions NEVER import from `repositories/` — repositories are server-side only.
- **Server-synced data** lives in slice fields prefixed `saved` (e.g. `savedNodes`); in-progress edits live in `pending` fields (e.g. `pendingNodeChanges`). Save actions reconcile.

## Allowed flows

- **Read state from a component:** `const nodes = useGraphSlice(s => s.nodes)`. Selector is a pure function on slice state.
- **Read derived state:** components use `useExecutableNodes()` (a custom hook that reads the slice and applies a projection from `core/workflows/projections.ts`).
- **Write state from a component:** call the action via the hook: `useGraphSlice.getState().addNode(newNode)`.
- **Server reconciliation:** save action calls `apiClient.workflows.update(...)` (a typed client API function that hits a server route → service → repository) → on success, slice updates `saved*` fields → resets `pending*` fields. Optimistic update pattern: the action immediately updates `saved*` and rolls back on server error.
- **Cross-slice coordination:** when an execution-slice update should clear the selection slice, the orchestrating service subscribes to both (or the calling action explicitly invokes both slice actions). Slices do not import each other.
- **Initial hydration:** on workflow open, a service fetches the workflow + integrations + history, then dispatches `useGraphSlice.getState().hydrate(...)` etc. Components mount against already-hydrated state.

## Disallowed behavior

- A slice imports another slice. Forbidden — even for "read-only" cross-slice access.
- Components mutate slice state directly (set fields without going through an action).
- Business logic inside selectors. Selectors are pure projections.
- Slice actions that span multiple slices. Cross-slice work belongs in a service.
- Storing component-local state in a slice (e.g. "is this dropdown open"). Use `useState` for component-local UI state.
- Storing server-only data in a slice (e.g. cron schedules, admin-only metadata). Server data flows through service calls, not slices.
- Subscribing to slice changes from outside React without cleanup. Use `subscribe(...)` returning an unsubscribe function and tear down on caller cleanup.
- Persisting tokens or secrets to a slice's localStorage `partialize` allowlist. Tokens are in-memory only (PR-AUTH-2 invariant).
- Using slices as a router for service calls. Slices hold state. Services orchestrate. Don't blur the boundary.

## Edge cases

- **Optimistic update + server failure:** the slice action snapshots the previous state, applies the optimistic update, calls the typed client API, and rolls back on error. Surface a toast through `uiStore`. The slice's UI re-renders with the rolled-back state.
- **Concurrent edits in two browser tabs:** slice does not cross-tab broadcast (auth slice does, per PR-AUTH-1). On save, the server returns `409 Conflict` with the latest revision id; the action surfaces a "this workflow was modified elsewhere" prompt and offers reload.
- **Hydration race:** workflow open dispatches hydration; user clicks before hydration completes. Slice exposes `isHydrated` flag; components show skeletons until ready.
- **Subscription cleanup:** services that subscribe to a slice (e.g. an execution status watcher) must clean up on workflow close. The orchestrator owns the subscription lifecycle.
- **Selectors used at render time vs computed once:** memoize expensive selectors. Use `useShallow` for object selectors to avoid re-render churn.
- **Slice persistence:** by default, slices are in-memory only. If a slice persists (e.g. UI prefs), the persist `partialize` allowlist is explicit and excludes any tokens, secrets, or PII.
- **Slice reset on workflow close:** unmounting the builder calls `useGraphSlice.getState().reset()` etc. Do not leak prior workflow state into the next open.
- **Schema migration of persisted state:** if a slice changes its persisted shape, include a `version` and migration function via Zustand's persist middleware.

## Required tests

Unit tests in `tests/unit/features/workflow-builder/state/<slice>.test.ts`:

1. Each slice unit-tested in isolation (no imports of other slices).
2. Initial state matches the documented shape.
3. Each action transitions state correctly.
4. Optimistic update + rollback restores prior state.
5. Hydrate replaces slice state cleanly.
6. Reset clears slice state to initial.
7. Selectors return expected projections (table-driven tests).
8. Slice has no `import { use*Slice }` from another slice (lint or test guard).
9. **Boundary lint guard (one of the most important protections in this rule):**
   - Slice action files do NOT import from `repositories/`.
   - Slice action files do NOT import from server-side `services/` (anything that is server-only must be reached through a typed client API).
   - Slice action files may import only: typed client API functions (`lib/api/<domain>.ts`), feature-local helpers, contracts/types, and other in-slice code.
   - Implemented as an ESLint `no-restricted-imports` rule plus a CI test that scans slice files.

Integration tests in `tests/integration/builder-state/`:

9. Save flow: edit field → save action → typed client API called → server route → service → repository → `saved*` reflects new value, `pending*` cleared.
10. Save failure: edit field → save action errors → state rolled back, toast emitted via `uiStore`.
11. Hydration race: open workflow + click before hydrated → component shows skeleton, no crash.

Cross-slice tests in `tests/integration/builder-orchestration/`:

12. Execution starts → service subscribes to executionSlice → updates ExecutionStatusPanel without coupling slices.
13. Workflow close → orchestrator tears down subscriptions → no memory leaks (verified via test memory profiler if available, or by counting active subscriptions).

## V1 behavior to preserve

- Optimistic UI on save (V1 mostly does this well).
- Server reconciliation on save success.
- Cross-tab session broadcast for auth state (PR-AUTH-1 pattern, in `authStore` only).
- The conceptual separation of "saved server state" vs "in-progress edits."

## V1 behavior to drop

- Monolithic stores mixing concerns.
- Hook-level ownership of complex state (move to slices; hooks become thin adapters).
- Business logic in selectors.
- Cross-store implicit dependencies (one store reads another).
- `useState`-stored complex objects that should be slice state (and vice versa).
- Persisted state that includes tokens or other secrets.

## Open questions

(Slice naming, cross-slice services, action composition, persistence policy, and DevTools are now resolved — see "Resolved Decisions" above. Selector co-location and selector memoization are now in "Deferred decisions" above.)

No open questions remain that block Slice 1.
