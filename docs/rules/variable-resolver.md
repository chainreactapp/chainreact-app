# Rule: Variable Resolver

## Purpose

Define a single canonical runtime variable resolver for ChainReactV2. The resolver substitutes `{{nodeId.field}}` and `{{AI_FIELD:fieldName}}` template references in workflow node configurations with concrete values at execution time.

Every place in V2 that resolves variables — engine pre-resolution, design-time preview, AI planner suggestions, builder field rendering — uses this one resolver, with explicit strict vs soft mode.

## Resolved Decisions

**Locked for Slice 1:**
- One canonical resolver module at `workflow-engine/variables/resolveValue.ts` exporting `resolveStrict` and `resolveSoft`.
- Strict mode is for runtime engine pre-resolution; soft mode is for builder / preview / planner.
- **Soft-mode missing-reference behavior is exact:**
  - **Single-reference template** (`"{{node1.value}}"`) returns `undefined` when missing.
  - **Mixed-string template** (`"Hello {{user.name}}"`) preserves the literal unresolved token in the string when missing.
  - When `unresolvedCollector` is supplied, every missing reference is recorded in either case.
- The resolver **detects and classifies** `AI_FIELD` references but does NOT call AI clients itself. AI generation is delegated to a separate AI field service / orchestrator (TBD when AI is un-deferred).
- For Slice 1, `AI_FIELD` references are placeholder-only because the AI subsystem is deferred per the master plan.
- Q5 invariant: `0`, `false`, `""` are explicit values, never treated as missing.
- `MissingVariableError` is thrown by the resolver and caught + converted to the standardized config-failure shape **at the engine layer**, not in the resolver.

**Deferred decisions:**
- Whether soft-mode `AI_FIELD` previews ever call the AI client to render real values. Slice 1: placeholder only.
- V1 production-workflow JSONB audit for undocumented template syntax (custom delimiters, helpers).
- Optional `getReferencedNodeIds(value)` helper for planner / dependency-graph builder. Likely yes; small follow-up.

**Decisions requiring product-owner input:**
- None for Slice 1.

## Current V1 problem being solved

V1 has resolver drift across at least three independent code paths:

1. The action-layer `resolveValue` used by some handlers directly.
2. The engine-layer `DataFlowManager.resolveObjectStrict` used by the V2 execution engine.
3. Integration-layer ad-hoc resolution (per-provider quirks scattered across `lib/workflows/actions/core/` and `lib/execution/variableResolver.ts`).

Each path has slightly different semantics for: missing values, type coercion, AI_FIELD substitution, and nested-path resolution. This produces bugs that look like "the same workflow runs differently depending on which path it goes through."

V1's `resolveValueWithTracking` and the `unresolvedCollector` pattern compound the problem because callers can opt into tracking but the rules for what counts as "unresolved" differ.

## V2 intended behavior

One resolver module at `workflow-engine/variables/resolveValue.ts` exports two functions:

- `resolveStrict(value, context)` — used by the engine pre-resolution layer before action handler dispatch. Throws `MissingVariableError` when a required reference cannot be resolved. The engine catches it and converts it to the standardized config-failure shape.
- `resolveSoft(value, context)` — used by builder, preview, AI planner. Missing-reference rule: single-reference templates return `undefined`; mixed-string templates preserve the literal `{{...}}` token in place. Optionally populates an `unresolvedCollector` for UI hints in either case.

Both share the same dot/bracket-path resolution rules, the same AI_FIELD detection / classification, and the same type-coercion behavior. The only difference is the missing-value policy.

Handlers never invoke the resolver directly. By the time a handler runs, its `config` object is already fully resolved (Q2). Handlers receiving raw `{{...}}` strings is a bug.

## Single source of truth

`workflow-engine/variables/resolveValue.ts` exports `resolveStrict` and `resolveSoft`, plus a small set of helpers (`extractReferences`, `validateReference`). No other module re-implements resolution.

The Q2 contract document (`docs/handler-contracts.md`) is the canonical specification of the strict-runtime rule that handlers depend on.

## Allowed flows

- **Engine pre-resolution (strict):** `nodeExecutionService` resolves the entire `config` object via `resolveStrict` before invoking the handler. Missing → standardized config-failure shape returned to the engine, never reaches the handler.
- **Builder / preview (soft):** UI components and the preview API call `resolveSoft` with the in-progress workflow context. Missing values render as undefined or as the original literal so the user sees the unresolved reference.
- **AI planner / suggestion (soft):** Planner code calls `resolveSoft` to peek at a value during planning. Same rules.
- **AI_FIELD detection (resolver responsibility):** the resolver recognizes `{{AI_FIELD:fieldName}}` references and classifies them as AI fields. The resolver does NOT call AI clients. In strict mode, the resolver returns a typed `AIFieldRef` sentinel (or equivalent classified marker); the engine then hands the sentinel to a dedicated AI field service that owns OpenAI/Anthropic clients. In soft mode, AI_FIELD resolves to a placeholder string for preview purposes. Slice 1 ships placeholder-only because the AI subsystem is deferred.

## Disallowed behavior

- Provider-specific resolution rules. There is no "Slack-flavored variable resolution." If a provider needs special handling, that handling lives in the handler after the value is resolved, not inside the resolver.
- Multiple resolver implementations with subtly different semantics.
- Handlers performing template resolution on their own inputs.
- Silent fallback to empty string for a missing required variable in strict mode.
- Truthy-only checks that drop explicit zero, empty string, or false. Q5 invariant: `0`, `false`, `""` are valid explicit values.
- Mutating the input value object during resolution. Resolver returns new objects.
- Reading from any global state inside the resolver. All inputs come through the `context` parameter.

## Edge cases

- **Nested path resolution:** `{{node1.field.subfield}}` — dot-path through nested objects. Missing intermediate object treated as missing reference.
- **Array index resolution:** `{{node1.items[0]}}` and `{{node1.items[0].name}}`. Out-of-bounds → missing reference (not silent undefined).
- **Mixed templates:** `"Hello {{user.name}}, your order is {{order.id}}"` — string interpolation. Each reference resolved independently. Strict mode throws on first missing; soft mode replaces missing with the original literal.
- **Single-reference-only templates:** `"{{node1.value}}"` resolves to the underlying value's actual type (number, boolean, object), not coerced to string.
- **Type coercion:** Mixed-template substitution coerces non-string values via `String(value)`. `undefined` is never coerced — it's a missing reference.
- **AI_FIELD nesting:** `{{AI_FIELD:summaryOf:{{node1.text}}}}` — the resolver resolves the inner reference first, then emits an `AIFieldRef` sentinel carrying the resolved inner value as a parameter. The engine's AI field service consumes the sentinel and performs generation (out of scope for the resolver).
- **Self-reference / cycles:** A node referencing its own field — engine prevents this by resolving in topological order; resolver itself has no cycle detection (relies on engine ordering).
- **Optional vs required fields:** Resolver does not know which fields are required; that's the schema's job. Resolver always strict-throws on missing in strict mode; engine wraps required-vs-optional logic outside.
- **Empty-string and zero preservation (Q5):** `{ retries: 0 }` and `{ enabled: false }` are valid explicit values, not "missing." Distinguish `undefined` (missing) from `null`/`0`/`false`/`""` (explicit).
- **Whitespace inside references:** `{{ node1.field }}` (with spaces) is the same as `{{node1.field}}` — whitespace inside `{{...}}` trimmed.
- **Escaped delimiters:** No escape syntax in V1. V2 declares `\{{...}}` reserved for escape in case a workflow ever needs to ship literal `{{` text — but until that need is real, escape is unimplemented and using `\{{` produces an explicit error message, not silent passthrough.

## Required tests

Unit tests in `tests/unit/workflow-engine/variables/resolveValue.test.ts`:

1. Strict mode raises `MissingVariableError` for missing reference.
2. Soft mode missing behavior follows the locked rule: single-reference missing template returns `undefined`; mixed-string missing reference preserves the literal unresolved token in the string; `unresolvedCollector` records the missing reference in both cases.
3. Soft mode populates `unresolvedCollector` when provided.
4. AI_FIELD: resolver detects/classifies AI_FIELD and returns a typed `AIFieldRef` sentinel in strict mode; soft mode returns a placeholder string. Resolver does NOT call AI clients.
5. Nested dot-path resolution succeeds for `a.b.c`.
6. Array bracket resolution succeeds for `items[0]`.
7. Out-of-bounds array index → missing reference.
8. Mixed-template string interpolation: resolves all references; strict throws on any missing; soft replaces missing with literal.
9. Single-reference-only template preserves underlying type (not coerced to string).
10. Q5 invariant: `0`, `false`, `""` resolve as explicit values, never treated as missing.
11. Whitespace inside `{{ ... }}` is trimmed.
12. Resolver does not mutate input.
13. Identical input + context produces identical output (deterministic).
14. AI_FIELD nested with inner reference: the inner reference resolves first; the resolver emits an `AIFieldRef` sentinel carrying the resolved inner value; no AI client call occurs inside the resolver.

Parity tests in `tests/parity/resolver-drift.test.ts`:

15. A workflow that V1 resolved differently across paths (specific known case to be identified during V1 audit) resolves identically through V2's strict path.

## V1 behavior to preserve

- Q2 strict-runtime contract: handlers never see unresolved templates.
- Q5 explicit-zero / explicit-false preservation.
- Pre-resolution at engine layer, not handler layer.
- Soft mode availability for design-time UX.
- Mixed-template interpolation semantics (string → string with substituted segments).

## V1 behavior to drop

- Multiple resolver implementations.
- Provider-specific resolver paths.
- Handler-level template resolution.
- Silent missing-variable fallbacks in strict-mode-equivalent contexts.
- The split between `resolveValue` and `resolveValueWithTracking` — V2 has one function with an optional collector parameter.

## Open questions

(AI_FIELD soft-mode previews, soft-mode-for-handlers, and where `MissingVariableError` gets caught are now resolved — see "Resolved Decisions" above.)

1. Are there V1 production workflows using template syntax not yet documented (custom delimiters, helpers, conditional expressions)? An audit of V1 workflow JSONB before V2 cutover should catch this.
2. Should the resolver expose a `getReferencedNodeIds(value)` helper for the planner / dependency-graph builder? Likely yes; cheap and useful. Final answer at the time the planner needs it.
