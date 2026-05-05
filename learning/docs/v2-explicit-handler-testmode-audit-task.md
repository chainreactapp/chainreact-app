# Audit: v2 explicit handler testMode / Q8d write interception

**Status:** **Audit complete + remediation shipped 2026-05-04** via the
engine-level pre-call gate (option 2 in the original task brief: "true
pre-call interception layer that prevents outbound provider writes
before invocation").

Findings + remediation: [v2-testmode-audit-findings.md](./v2-testmode-audit-findings.md).

Per-handler Q8d remains backlog work (defense-in-depth) — the engine
gate covers all 44 cases the audit identified, plus any future case.
Original audit goals achieved:

- ✅ Enumerated 83 explicit dispatch cases across all 6 dispatchers.
- ✅ Confirmed each path either has Q8d, has a pre-call gate, or
  newly has the engine-level gate.
- ✅ Parity tests for all 7 representative cases (plus 6 semantic-
  property tests) at
  [`__tests__/workflows/v2-testmode-pregate.test.ts`](../../__tests__/workflows/v2-testmode-pregate.test.ts).
- ✅ Does not rely on post-hoc `nodeExecutionService` decoration —
  the engine gate is genuine pre-call interception.

The remainder of this doc is the original task brief (preserved for
reference).

---

**Companion to:** [v2-canonical-execution-engine-plan.md](./v2-canonical-execution-engine-plan.md)

## Why this audit exists

PR-V2C added a registry fallback to v2's integration handlers so unknown
node types route through `executeAction` instead of throwing. That work
verified test-mode safety **for the fallback path** by short-circuiting
when `context.testMode === true`.

In doing so, it surfaced a pre-existing concern in v2's **explicit
case** handlers: v2's `INTERCEPT_WRITES` is post-hoc wrapping at
[`nodeExecutionService.ts:87-107`](../../lib/services/nodeExecutionService.ts).
The integration handler runs first, then the result is decorated with
`{ intercepted: {...} }`. The underlying provider call is **not**
blocked by the wrapper — safety in test mode relies entirely on each
handler implementing the Q8d contract (an early-return when
`meta?.testMode === true`).

A grep for `meta?.testMode` in `lib/workflows/actions/` confirmed only
12 handlers self-abort today. v2 explicitly invokes far more handlers
than that. The gap may or may not be real (some service-level
dispatchers like `executeGoogleSheetsAction` perform their own
top-of-method `if (context.testMode)` short-circuit before calling
handlers), but no end-to-end audit has been performed.

## Scope

For every code path in v2 that dispatches to a provider handler,
confirm one of these is true:

1. The handler itself implements Q8d — early-returns a deterministic
   simulated `ActionResult` when `meta?.testMode === true`. (Existing
   contract: see [handler-contracts.md](./handler-contracts.md) Q8d.)
2. A pre-call interception layer **above** the handler refuses to
   invoke it when `context.testMode === true`. The layer must run
   **before** the handler executes — post-hoc result decoration in
   `nodeExecutionService.ts` does NOT count.

**Code paths to enumerate exhaustively:**

- [lib/services/executionHandlers/integrationHandlers.ts](../../lib/services/executionHandlers/integrationHandlers.ts) —
  every explicit `case` in the top-level `execute()` and in every
  per-provider sub-dispatcher (OneNote, Discord, Airtable, Notion,
  Trello, HubSpot, Excel, plus the inline OneDrive / Dropbox / send
  email / webhook call cases).
- [lib/services/executionHandlers/actionHandlers.ts](../../lib/services/executionHandlers/actionHandlers.ts) —
  every explicit `case` in `execute()` (filter, delay, conditional,
  loop, custom_script, variable_set/get, if_condition, switch_case,
  data_transform, template, javascript, try_catch, retry, the AI
  action cases, hitl_conversation).
- [lib/services/integrations/gmailIntegrationService.ts](../../lib/services/integrations/gmailIntegrationService.ts) —
  9 explicit cases.
- [lib/services/integrations/slackIntegrationService.ts](../../lib/services/integrations/slackIntegrationService.ts) —
  5 explicit cases.
- [lib/services/integrations/googleIntegrationService.ts](../../lib/services/integrations/googleIntegrationService.ts) —
  Drive (6), Sheets (6), Docs (5), Calendar (1 implemented).
- [lib/services/aiActionsService.ts](../../lib/services/aiActionsService.ts) —
  6 ai_action_* + ai_agent + ai_router.

For each path, classify:

- **✅ Q8d in handler** — handler self-aborts cleanly. Cite the
  handler file + line.
- **✅ Pre-call gate in dispatcher** — the dispatcher checks
  `context.testMode` and returns a mock before the handler is invoked.
  Cite the gate's file + line.
- **⚠ No protection** — handler invoked unconditionally; no Q8d
  early-return. Risk of real provider call in test mode. Action: add
  Q8d to the handler.
- **🔍 Unknown** — couldn't determine without runtime tracing.

## Parity tests required

Add or extend tests so each of the following representative explicit
cases proves "no provider call in test mode" via a mocked SDK +
assertion that the SDK was not invoked:

- Slack `slack_action_send_message` — the explicit case in
  `integrationHandlers.ts` line 32-42.
- Google Sheets `google_sheets_action_append` (and equivalent
  `sheets_append`) — through `googleIntegrationService.executeGoogleSheetsAction`.
- Discord `discord_action_send_message` — through
  `executeDiscordAction`.
- Airtable `airtable_action_create_record` — through
  `executeAirtableAction`.
- Notion `notion_action_create_page` and a database action —
  through `executeNotionAction`.
- Gmail `gmail_action_send_email` — through
  `gmailIntegrationService.executeSendEmail`.
- Google Calendar `google_calendar_action_create_event` — through
  `googleIntegrationService.executeGoogleCalendarAction`.

Each test:
1. Mocks the underlying SDK / fetch (e.g. `jest.mock('@/lib/integrations/slack/...')`).
2. Builds an `ExecutionContext` with `testMode: true`.
3. Calls the dispatcher directly (`new IntegrationNodeHandlers().execute(...)`,
   `new ActionNodeHandlers().execute(...)`, etc.).
4. Asserts the mocked SDK / fetch was **not** called.
5. Asserts the returned shape is what the rest of v2 expects (an
   `intercepted` envelope from `nodeExecutionService` post-hoc
   wrapping is fine, but the underlying call must not have happened).

## Out of scope

- The PR-V2C registry fallback path. That is already covered by
  [`v2-integration-fallback.test.ts`](../../__tests__/workflows/v2-integration-fallback.test.ts).
- Trigger handlers (`triggerHandlers.ts`). Triggers don't write to
  providers; their test-mode story is the mock data registry, which
  is a separate concern.
- v1's `executeAction` testMode behavior. v1 is being deleted; if a v1
  handler lacks Q8d, it's only a problem during the cutover window
  while v1 still serves live traffic.

## Why "do not rely only on post-hoc decoration"

The user's directive is unambiguous: a real provider call in test
mode is a defect. Wrapping the result with `{ intercepted: ... }`
**after** Stripe charges a card or Slack posts a message does not
make the test mode safe — it makes the test mode mislabeled.

Where today's v2 currently relies on post-hoc decoration for safety,
the audit must surface that and propose either (a) adding Q8d to the
relevant handler, or (b) adding a pre-call gate in the dispatcher.

## Suggested implementation order

1. Run the audit (write the doc enumerating every path with the
   classification table). ~1 day.
2. For each ⚠ row: add Q8d to the handler (small per-handler edits
   following the existing pattern in `lib/workflows/actions/gmail/sendEmail.ts:33-...`).
3. Write the parity tests listed above. They double as regression
   coverage for any future Q8d additions.
4. Optionally add a strict pre-call gate in `nodeExecutionService.ts`
   that refuses to invoke any external action in test mode unless
   either Q8d is detected OR the dispatcher has explicitly opted in.
   This is defense in depth — turns the per-handler discipline into
   an engine-enforced contract.

## Tracking

This task is referenced from:
- [CLAUDE.md](../../CLAUDE.md) §10
- [v2-canonical-execution-engine-plan.md](./v2-canonical-execution-engine-plan.md) (Phase 4 dependency)
