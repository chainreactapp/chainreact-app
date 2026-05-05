# Rule: Workflow Builder UI

## Purpose

Define how the V2 workflow builder is composed of small, focused components — not a single mega-file — while preserving V1's exact visual layout, terminology, and interaction model.

## Resolved Decisions

**Locked for Slice 1:**
- Builder lives at `features/workflow-builder/`, decomposed into `canvas/`, `panels/`, `config-modal/`, `state/`, `hooks/`.
- V1's visual layout (three-pane: library / canvas / config) and interaction model preserved exactly.
- Provider config files cap at < 500 lines; split by tab/section if they grow.
- Field-renderer registry hand-maintained: explicit `field-type → component` map, type-safe.
- **Data access pattern (resolves "no fetch in components"):**
  - **Components:** never call raw `fetch` or `supabase.from`.
  - **Feature hooks:** may call **typed client API functions** (e.g. `apiClient.workflows.save()`) or feature services. Hooks are orchestration adapters, NOT places for business rules.
  - **Typed client API functions** live in `lib/api/<domain>.ts` — thin wrappers over `fetch` against V2 server routes.
  - **Server mutations and provider data calls** are always behind services and routes. Repositories are server-side only (see workflow-state-store rule).
- Real-time collaboration deferred. Undo/redo deferred (audit V1 to confirm parity scope). AI panel deferred.
- FlowEdges alignment algorithm preserved verbatim from V1 (DO NOT TOUCH zone — `DEFAULT_COLUMN_X = 400` invariant). Lives behind the canvas/edges interface; does not force the rest of the builder to mirror V1's structure.

**Deferred decisions:**
- Real-time collaboration architecture (when un-deferred).
- Builder performance budget for large workflows (50+ nodes) — measure when virtualization is needed.
- Configuration validation split: field-level (debounced renderer) vs cross-field (save-time Zod) — pattern is final, specifics at implementation.

**Decisions requiring product-owner input:**
- AI panel placement in the layout when un-deferred.

## Current V1 problem being solved

V1's workflow builder is concentrated in:
- `components/workflows/builder/WorkflowBuilderV2.tsx` — **8,032 lines**, 7 inline `fetch()` calls, 37 `useEffect`s, business logic mixed with rendering.
- `hooks/workflows/useWorkflowBuilder.ts` — **3,640 lines** in one hook. Owns builder state, node configuration, action plumbing, UI mode state.
- `components/workflows/configuration/providers/AirtableConfiguration.tsx` — 4,428 lines, plus 58 `console.log` calls.
- `components/workflows/configuration/fields/FieldRenderer.tsx` — 3,398 lines.

Every change to one concern (a node-config field, a canvas behavior, an execution status indicator) risks breaking unrelated concerns. Onboarding to the builder code requires reading thousands of lines.

## V2 intended behavior

The builder is a feature module at `features/workflow-builder/` decomposed into independent areas, each with a clear responsibility:

```
features/workflow-builder/
├── canvas/                 # ReactFlow surface + custom node renderers
│   ├── WorkflowCanvas.tsx          # the surface
│   ├── nodes/                      # one file per node type (action, trigger, logic)
│   ├── edges/                      # FlowEdges algorithm (preserved verbatim from V1)
│   └── controls/                   # zoom, fit-to-view, mini-map
├── panels/
│   ├── NodeLibraryPanel.tsx        # left panel: searchable list of triggers + actions
│   ├── NodeConfigPanel.tsx         # right panel: shell for the active config modal
│   └── ExecutionStatusPanel.tsx    # bottom or right strip: run progress + error display
├── config-modal/
│   ├── ConfigModalShell.tsx        # generic modal frame (header, save/cancel)
│   ├── providers/                  # one file per provider, < 500 lines each
│   │   ├── SlackConfig.tsx
│   │   ├── GmailConfig.tsx
│   │   └── ...
│   └── fields/                     # one file per field-type renderer
│       ├── TextField.tsx
│       ├── SelectField.tsx
│       ├── KeyValueField.tsx
│       └── ...
├── state/                  # Zustand slices (see workflow-state-store rule)
└── hooks/
    ├── useWorkflowGraph.ts         # read-only graph access
    ├── useNodeConfig.ts            # config CRUD
    └── useExecutionStatus.ts       # running state
```

Every component is presentational by default. Components read state through hooks and dispatch actions through hook-returned callbacks. No component performs `fetch()` or `supabase.from()`.

The visual layout — three-pane (library / canvas / config), bottom execution strip, modal-based field editing — is unchanged from V1. Only the internal decomposition is new.

## Single source of truth

- Builder state: `features/workflow-builder/state/` (slices: graph, selection, config, execution).
- Workflow data persistence: `repositories/workflows.ts` (called by services, not directly by components).
- Field rendering: `features/workflow-builder/config-modal/fields/`.
- Per-provider config UI: `features/workflow-builder/config-modal/providers/<provider>.tsx`.

## Allowed flows

- **Add node:** user drags from library → `state.graph.addNode(node)` → canvas re-renders from state.
- **Open config:** user clicks node → `state.selection.select(nodeId)` → `NodeConfigPanel` mounts the matching provider config component.
- **Edit config:** user types into a field → `state.config.update(field, value)` (in-progress edits separate from saved state).
- **Save config:**
  1. Component calls a hook action (e.g. `useNodeConfig().save()`).
  2. Hook / slice action calls the typed client API function `apiClient.workflows.saveNodeConfig(...)`.
  3. The API route at `app/api/workflows/[id]/nodes/[nodeId]/route.ts` calls `services/workflows.saveNodeConfig(...)`.
  4. Service calls `repositories/workflows.update(...)`.
  5. Repository performs the database write.
  6. On success, `state.graph` reflects the saved value and `state.config` resets.
- **Trigger run:**
  1. Component calls `useExecutionStatus().triggerTestRun()`.
  2. Hook calls `apiClient.execution.triggerTestRun(workflowId)`.
  3. The API route at `app/api/workflows/execute/route.ts` calls `services/execution.triggerTestRun(...)`.
  4. Service invokes the workflow engine.
  5. Engine executes; `state.execution` updates via SSE or polling on the engine's published progress.
- **Activate workflow:**
  1. Component calls `useWorkflowGraph().activate()`.
  2. Hook calls `apiClient.workflows.activate(workflowId)`.
  3. The API route at `app/api/workflows/[id]/activate/route.ts` calls `services/workflows.activate(...)`.
  4. Service runs the lifecycle orchestrator (per the workflow-lifecycle rule).
  5. Repository persists the new state and trigger registration.
  6. On success, `state.graph` reflects the new lifecycle state.

The boundary in every flow above: components only know about hooks; hooks only know about typed client API functions; server services and repositories are reached **only** via API routes. Hooks never import services or repositories.

## Disallowed behavior

- Direct `fetch()` inside any component. Always go through a hook → service.
- Direct `supabase.from()` inside any component.
- Business logic inside `useEffect`. `useEffect` is for DOM/lifecycle effects only (focus management, event listeners, scroll position). Anything that decides *what* should happen, not *when* it happens, belongs in a service or a slice action.
- State duplicated across components. Any two components rendering the same field both read from the slice; neither caches a copy.
- Cross-cutting `useEffect` chains (an effect that fires on N unrelated dependencies). One effect per concern.
- Implicit cross-component coupling via shared refs. Use slices for cross-component state.
- Components doing variable resolution. Use the canonical resolver from the workflow engine (always soft mode in builder).
- Configuration components > 500 lines. Provider configs split by tab/section if they grow.

## Edge cases

- **Concurrent edits in two tabs:** last-write-wins with optimistic UI. If the server rejects (revision-id mismatch), surface a "this workflow was modified elsewhere — reload?" prompt. No silent overwrite.
- **Unsaved changes navigation:** `state.config` exposes `isDirty`; the page navigation guard prompts before leaving.
- **Large workflows (50+ nodes):** the canvas should remain responsive. Virtualized rendering of nodes off-screen is a future concern; for slice 1 a small workflow is fine, but design the slices so virtualization can be added without restructuring.
- **Disabled fields:** when the workflow lifecycle state is `disabled` or `eligible_to_resume`, fields render disabled. The UI consumes the lifecycle projection helpers, not raw columns.
- **Real-time collaboration (multi-user editing):** deferred. V1 has `collaborationStore`; V2 ports it later. Slice 1 ships single-user editing only.
- **AI assistant panel:** deferred. Slice 1 ships without AI affordances. The builder's left panel surface should accommodate the future AI panel without restructuring.
- **Provider config that shares fields with another provider:** field-renderer components are generic by `type`. A new provider that uses only existing field types needs zero new field code.
- **Provider config with a unique widget (e.g. a calendar picker):** the provider's config component renders the widget directly; the field-type renderer registry stays minimal.
- **Field with an external data source (e.g. Slack channel list):** field component calls a hook (`useChannelList(integrationId)`); the hook calls a typed client API function (`apiClient.integrations.listChannels(integrationId)`), which hits a server route, which calls a service, which calls the repository. Components never fetch directly. Hooks never call repositories — repositories are server-side only.
- **FlowEdges alignment:** the algorithm is preserved verbatim. Custom-node sizing must not break the `DEFAULT_COLUMN_X = 400` invariant.

## Required tests

Component tests in `tests/unit/features/workflow-builder/`:

1. `WorkflowCanvas` renders the nodes from `state.graph` (read-only test).
2. Adding a node through the slice action causes the canvas to re-render.
3. `NodeConfigPanel` mounts the correct provider config when selection changes.
4. `ConfigModalShell` displays unsaved indicator when `state.config.isDirty`.
5. Save action calls the typed client API function (`apiClient.workflows.saveNodeConfig`); on success the config slice resets. A separate **server-side integration test** verifies the matching API route calls `services/workflows`, and the service calls `repositories/workflows.update()`. Client tests do not mock services or repositories — clients never see them.
6. Save action surfaces an error toast on failure; config slice retains the in-progress edits.
7. No component imports from `@supabase/...` directly (lint check).
8. No component contains `fetch(` (lint check).
9. No component file exceeds 500 lines (CI check, with PR-comment exception process).
10. `useEffect` audit: each effect's body is < 30 lines and operates on a single concern.

Integration test in `tests/integration/builder-flow.test.tsx` (RTL):

11. End-to-end render: load a workflow → see canvas → click node → config panel opens → edit field → save → see updated value.

E2E test in `tests/e2e/playwright/builder-slack.spec.ts`:

12. Sign in → create workflow → drag Slack trigger → configure → drag Slack action → configure → activate → see "Active" status.

## V1 behavior to preserve

- Visual layout: three-pane (library / canvas / config), bottom execution strip.
- Interaction model: drag nodes from palette, click to configure, modal-based field editing.
- Terminology: "trigger," "action," "step," "configuration," "test run."
- ReactFlow controls and behaviors (zoom, pan, mini-map, fit-to-view).
- FlowEdges alignment algorithm — preserved verbatim. Do not let it force the old builder structure into V2; it lives behind the canvas/edges interface.
- Optimistic UI patterns for save / activation (V1 mostly does this well).
- Error display in the bottom strip when a run fails.

## V1 behavior to drop

- 8,032-line monolith component.
- Inline `fetch()` calls.
- 37 `useEffect`s in one file.
- Business logic interleaved with rendering.
- Provider config files > 500 lines (split by tab or by sub-section).
- Direct Zustand store mutation from components (use slice actions).
- `console.log` in components (logging goes through Admin Debug Panel server-side or `useDebugStore` client-side).

## Open questions

(Real-time collaboration, AI panel placement, field-renderer registry, configuration validation split, and builder performance budget are now resolved or deferred — see "Resolved Decisions" above.)

1. **Undo / redo:** audit V1 to confirm whether it exists for the builder and whether it is parity-critical. If not parity-critical, defer until after Slice 1. The state-slice design should accommodate an undo-stack slice without restructuring graph or selection slices.
