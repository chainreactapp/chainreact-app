# Rule: Testing Strategy

## Purpose

Define how ChainReactV2 tests are designed so they catch real issues, validate expected behavior, cover both good and bad paths, verify error handling, and protect known V1 regressions.

This doc is the **central testing philosophy** for V2. The other rule docs each list specific required tests for their subsystem; this doc defines what makes any test acceptable. Every test in V2 must justify its existence against the principles below — both at PR-review time and during periodic test-suite audits.

Tests in V2 must validate **business behavior and expected system outcomes**, not implementation details, file structure, or the bare fact that a function was called.

## Resolved Decisions

**Locked for Slice 1:**
- Tests prove business behavior, not implementation. Every test answers: *"What real failure would this catch?"*
- The good-path / bad-path / error-handling matrix (§5) is required for every important feature.
- Mocks are restricted to external boundaries only (§7). Mocking the function under test or the rule being tested is forbidden.
- Parity tests for known V1 regressions are mandatory (§8). The list seeds with: resolver drift, auth refresh deadlock, auto-resume after reconnect, duplicate webhook delivery, billing RPC parity, session-side-effects idempotency.
- Test naming follows the convention in §9 — names describe business behavior, not surface action.
- Every PR answers the test-acceptance checklist (§10) before merge.
- Slice 1's minimum test set (§11) is the floor; no slice-1 work merges without it.
- The anti-patterns in §12 are grounds for blocking a PR or removing a test.

**Deferred decisions:**
- Whether to add mutation testing (e.g. Stryker) once the suite stabilizes. Slice 1: not required.
- Whether to enforce the test-acceptance checklist via a PR-template bot or a manual reviewer pass. Slice 1: manual reviewer pass.

**Decisions requiring product-owner input:**
- None for Slice 1.

## Current V1 problem being solved

V1's test suite has accumulated patterns that pass without proving anything useful:

- Generated tests often prove only that a mocked function returns what the mock told it to return.
- Some tests are happy-path only and silently miss error and edge-case behavior.
- Some tests are tautological — flipping the assertion still produces a passing test, or removing the function under test still produces a passing test.
- Some tests validate file structure or implementation details (`expect(file).toContain('useState')`) instead of product behavior.
- Error handling, bad inputs, disconnected integrations, billing failures, missing variables, webhook replay, and lifecycle edge cases are systematically under-covered. Most production incidents in V1 came from these paths.
- Test names like "works", "handles error", "renders" don't tell you what business rule is at risk if the test fails.

The result: a suite that is green most of the time but doesn't prevent the bugs that matter.

## V2 testing principles

1. **Every test answers: "What real failure would this catch?"** If the answer is "none" or "implementation moved", delete the test.
2. **Test the business rule first, implementation second.** The rule lives in the rule doc; the test cites it.
3. **Every major feature needs good-path, bad-path, and error-handling coverage.** Not "we'll add bad-path tests later." All three at the same PR.
4. **Tests prove the system behaves correctly when dependencies fail.** Disconnected integrations, expired tokens, 5xx responses, missing variables, billing exhaustion — these are first-class test targets, not afterthoughts.
5. **Tests protect known V1 regressions.** Each named in `tests/parity/` with a comment naming the V1 incident.
6. **Prefer testing through public boundaries:** service APIs, route handlers, engine entrypoints, provider adapters, UI flows. Avoid testing private implementation details.
7. **Do not mock the function under test.** Ever.
8. **Do not write tests that only assert "truthy" or "called once"** unless that is part of a meaningful behavior. "called once" is meaningful when "called twice" would be a duplicate side effect; otherwise it is noise.
9. **Do not write tests that pass even when the core logic is removed.** A useful sanity check during review: comment out the body of the function under test and see if the test still passes. If it does, the test is wrong.
10. **A test should fail for the right reason** if the expected business rule is broken. The failure message should point a reader at the rule, not at a stack trace deep in test plumbing.
11. **Tests must cover user-facing error behavior**, not just thrown exceptions. "Throws on bad input" is rarely enough; the user-visible error code, message, and CTA matter.

## Required test categories

### A. Unit tests — pure business rules

Lives in `tests/unit/core/`, `tests/unit/workflow-engine/`. Examples:
- Lifecycle transition rules (allowed transitions, preconditions, rollback)
- Variable resolver behavior (strict / soft, missing, AI_FIELD classification)
- Cost calculation
- Error humanizer (category → title, description, hint, action)
- Provider manifest validation (each manifest validates against the contract)
- Scope validation (granted scopes vs `manifest.scopes.required`)

### B. Service / domain tests — orchestration rules

Lives in `tests/unit/services/`. Examples:
- Activation runs preconditions before persisting state.
- Disabled workflow does not execute.
- Billing gate blocks execution.
- OAuth refresh lock prevents duplicate refresh calls.
- Lifecycle orchestrator rolls back trigger registration on failure.

### C. Integration tests — real subsystem interaction

Lives in `tests/integration/`. Examples:
- API route → service → repository (real Supabase test schema).
- Webhook receive → normalize → dispatch → run enqueued.
- OAuth callback → token storage → connection status.
- Workflow save → revision created → builder reloads saved state.

### D. Provider contract tests

Lives in `tests/unit/integrations/<p>/`. Examples:
- Slack `send_channel_message`: success, provider error, 401, missing channel, rate limit (each as a separate test).
- Provider manifests expose required scopes and capabilities.
- Webhook signatures validate; forged requests rejected.

### E. Engine tests

Lives in `tests/unit/workflow-engine/`. Examples:
- Execution order (topological).
- Variable pre-resolution before handler invocation (Q2).
- Missing variables produce the standardized config-failure shape (handler not invoked).
- Handler failures classify correctly (Q1 categories).
- Retry behavior is explicit; no implicit retry.

### F. UI / component tests

Lives in `tests/unit/features/`. Examples:
- Builder renders state correctly.
- Config save calls the typed client API (not the service or repository directly).
- Disabled fields render disabled based on the lifecycle projection helper.
- Error banner displays the humanized error from the classifier.

### G. E2E tests

Lives in `tests/e2e/playwright/`. Reserved for **critical user journeys only**:
- Sign up.
- Connect Slack.
- Create workflow.
- Configure trigger / action.
- Activate.
- Receive event.
- Run succeeds.
- Run failure displays a useful, humanized error.

E2E is not for edge cases. Edge cases live in unit / integration layers.

### H. Parity / regression tests

Lives in `tests/parity/`. Tests created from known V1 bugs. Each named after the V1 incident. Initial seed list:
- `auth-refresh-deadlock` — `getSession()` lock contention scenario from PR-AUTH-1.
- `scope-drift` — dual-scope-source-of-truth bug.
- `resolver-drift-missing-value` — multi-path resolver returning different values for the same template.
- `auto-resume-after-reconnect` — workflow auto-becoming-active after integration reconnect (must NOT happen in V2).
- `duplicate-webhook-delivery` — same provider event causing two runs.
- `billing-rpc-parity` — ledger sum drifting from profile counters.
- `session-side-effects-idempotency` — replay producing duplicate side effects.

## Good-path / bad-path / error-handling matrix

For every important feature, require at least these six cases:

| Case | What it covers |
|---|---|
| **Good path** | Valid input produces the expected result. |
| **Bad path** | Invalid input is rejected with the documented error. |
| **Missing dependency** | Disconnected integration, missing token, missing variable, missing billing entitlement → typed failure. |
| **Provider failure** | 401, 403, 429, 500, timeout from the upstream provider → handled per Q3 / Q9 contract. |
| **User-facing error** | Correct user-visible error code, message, and CTA. (Throwing the right exception is not enough.) |
| **State integrity** | After failure, no partial writes, no invalid lifecycle transitions, no duplicate side effects, no leaked locks. |

A feature with only good-path tests is not done.

## Error handling requirements

Every feature that can fail must test:
- The **typed error code** returned.
- The **user-facing message** or **CTA** rendered.
- Whether a **log or metric** is emitted (and at what level).
- The **system state after failure** (was anything persisted? Did locks release? Did the integration row stay healthy?).
- **Rollback behavior** if applicable (failed activation does not leave a half-registered trigger).
- **Retry behavior** if applicable (refreshable provider 401 → refresh once; non-refreshable → no retry).
- That **no secrets / tokens leak** into the error message, log, or response body.

Examples:
- OAuth callback fails → integration row not created; user sees a humanized message; log records the failure category but not the token.
- Trigger registration fails → workflow remains `draft`; user sees the registration error; trigger_resources stays clean.
- Webhook dedup store fails → fail-open policy applies; `event-dedup-outage` metric emits; downstream Q4 catches duplicates.
- Slack action returns 401 → non-refreshable provider emits `action_required`; no refresh attempt; health engine updates.
- Missing variable in handler config → standardized config-failure shape; handler is not invoked; user sees the missing-reference path in the run history.

## Mocking rules

**Allowed:**
- Mock external provider APIs (Slack, Gmail, Stripe, OpenAI HTTP calls).
- Mock network failures, timeouts, latency.
- Mock time / clock for time-sensitive logic.
- Mock queues when testing service behavior (queue-write side effects can be asserted directly).
- Mock the typed client API in UI tests (the UI test verifies the component → hook → API contract; the API contract is verified separately).

**Not allowed:**
- Mock the function under test.
- Mock the business rule being tested. Lifecycle transitions, billing decisions, variable resolution, error classification — these are tested against the real implementation.
- Mock so deeply that the test only proves the mock was called (e.g. mocking the resolver inside a handler test that claims to verify resolution).
- Replace the actual resolver / lifecycle / billing logic with stubs in tests that claim to verify those rules.

When in doubt, mock at the **HTTP boundary** or the **provider SDK call**. Mock as little as possible and as far out as possible.

## Regression / parity test process

Any known V1 bug that influenced V2 architecture should get a parity test before the related subsystem is considered done.

Each parity test must include:
- **Short name** of the V1 bug (matches the file name, e.g. `auto-resume-after-reconnect.test.ts`).
- **Expected V2 behavior** stated up front in the test description.
- **Why the test exists** — a one-paragraph comment at the top of the file naming the V1 incident.
- **The business rule it protects** — link or reference to the rule doc.

When a new V1 incident is discovered after V2 work begins, it gets a parity test before the bug fix lands.

## Test naming convention

Test names describe the **business behavior** the test protects.

**Good names:**
- `keeps workflow disabled after integration reconnect until user explicitly resumes`
- `does not invoke action handler when required variable is missing`
- `rolls back activation when trigger registration fails`
- `drops webhook for disabled workflow even if provider registration lags`
- `Slack 401 emits action_required without attempting refresh`
- `mixed-string template with missing reference preserves the literal token in soft mode`

**Bad names** (will be rejected in review):
- `returns true`
- `calls function`
- `renders component`
- `works`
- `handles error`
- `test 1` / `it should work`

If you cannot describe what the test protects in a sentence, the test should not exist.

## PR test acceptance checklist

Every PR with test changes answers, in the description or in PR comments:

- [ ] What business rule is being tested?
- [ ] What good path is covered?
- [ ] What bad path is covered?
- [ ] What error path is covered?
- [ ] What state-integrity condition is verified?
- [ ] What known regression does this protect, if any?
- [ ] Would this test fail if the real logic broke? (If you commented out the function body, would the test detect it?)
- [ ] Are mocks limited to external boundaries?
- [ ] Are user-facing errors tested where relevant?

A PR that adds tests but cannot answer these is not ready.

## Slice 1 minimum test requirements

Slice 1 (Slack vertical slice) does not merge without:

- **Slack manifest validation** — manifest passes Zod against `contracts/integration.ts`.
- **OAuth flow:** connect → callback → encrypted token storage; failed callback handled.
- **Slack non-refreshable 401 behavior** → dispatcher throws `RefreshNotSupported`, emits `action_required`, no refresh attempt.
- **Refreshable mock provider Q3** → connect → 401 → refresh → retry → success cycle (since Slack default v2 cannot prove this; covered in oauth-dispatcher.md tests #14 + #15).
- **Slack webhook signature verification** — valid accepted, forged rejected, expired-timestamp rejected.
- **Slack webhook normalization** — Slack event → canonical `triggerEvent` shape (table-driven across event types).
- **Webhook dedup** — duplicate `(provider, event_id)` is dropped.
- **Disabled workflow webhook drop** — provider delivers webhook for a disabled workflow, dispatcher drops, no run enqueued (shared invariant from workflow-lifecycle and webhook-receipt-routes rules).
- **Workflow lifecycle** — activate, pause, disable, eligible_to_resume, resume; per-integration cascade; multi-integration cascade matrix (4 cases).
- **Canonical variable resolver** — strict raises `MissingVariableError`; soft preserves literal in mixed-string and returns undefined for single-ref; AI_FIELD classified to sentinel without AI call.
- **Slack `send_channel_message`** — success, provider error, 401, missing channel, rate limit (Q3, Q9 paths verified).
- **Billing gate** — RPC deduction succeeds; cap-exhausted refuses; ledger row written.
- **Run history** — execution_steps written on success; humanized error written on failure.
- **Builder save flow through typed client API** — component → hook → `apiClient.workflows.saveNodeConfig()` → server route → service → repository (split into client test + server-side integration test per workflow-builder-ui rule).
- **E2E happy path** (Playwright): sign up → connect Slack → create workflow → activate → trigger event → run succeeds.
- **E2E failure visibility:** force a run failure → user sees a humanized error with the right CTA.

## Anti-patterns

The following are explicitly rejected. PRs containing them will be blocked, and existing tests matching these patterns are removal candidates during audits:

- **Tautology tests** — assert truthy on a value that the production code can never produce as falsy.
- **Mock-callcount-only tests** — only assert that a mock was called N times, with no behavior verification.
- **Implementation-mirror tests** — duplicate the production code's logic in the assertion (the test breaks any time you refactor, but doesn't catch behavior changes).
- **Structure-only tests** — assert "this file exists" or "this function is exported" without exercising it.
- **Hide-the-failure tests** — wrap the system under test in a broad `try/catch` that swallows real errors.
- **Happy-path-only tests for high-risk features** — billing, OAuth, lifecycle, webhook receipt, variable resolution, execution all need bad-path and error coverage.
- **No-business-purpose tests** — tests that exist to satisfy coverage tooling but cannot be tied to a business rule.

When in doubt during review: ask "if I delete this test, what will break?" If the answer is "nothing real", the test is the problem.

## Open questions

No open questions remain that block Slice 1.
