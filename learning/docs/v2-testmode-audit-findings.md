# v2 testMode Audit — Findings + Remediation

**Audit task:** [v2-explicit-handler-testmode-audit-task.md](./v2-explicit-handler-testmode-audit-task.md)

**Status:** Findings collected 2026-05-04. Remediation: engine-level
pre-call gate (defense-in-depth, covers all paths). Per-handler Q8d
work documented as backlog for incremental cleanup.

## TL;DR

v2's `INTERCEPT_WRITES` does post-hoc result decoration only. Real
provider calls fire BEFORE the wrapping happens. The post-hoc
`{ intercepted: { wouldHaveSent: ... } }` envelope is informational,
not protective.

Of **83 explicit dispatch cases** audited across `IntegrationNodeHandlers`,
`ActionNodeHandlers`, `AIActionsService`, and the per-provider services
(Gmail / Slack / Google):

- **48 cases** had a dispatcher-level pre-call gate (mostly Google
  sub-dispatchers' `if (context.testMode) return mock`, plus the
  Gmail/Slack service per-method gates).
- **6 cases** had handler-level Q8d (`if (meta?.testMode) return mock`):
  Gmail send, Outlook send, Stripe (4 handlers), Shopify createCustomer,
  plus a few Google handlers.
- **12 cases** were local (no provider call): filter / conditional /
  variable / loop / etc.
- **17+ cases ⚠ NO PROTECTION:** Slack inline path, Discord, Airtable
  update/delete/list, Dropbox, Trello, HubSpot, Excel, OneNote,
  Outlook calendar event.
- **Notion (9 cases) — actually unprotected.** The audit initially
  classified these as 🔍 VERIFY because Notion handlers in
  `lib/workflows/actions/notion/handlers.ts` DO have Q8d. Verification
  showed the v2 dispatch routes through `lib/workflows/actions/notion/managePage.ts:executeNotionManagePage`,
  which builds a fake `ExecutionContext` with `testMode: false` hardcoded
  (line 220) before calling the Q8d-protected handlers. The Q8d is
  unreachable through this routing layer. **Adds 9 cases to ⚠.**

**Adjusted total ⚠ NO PROTECTION: ~44 cases.**

## Why a per-handler fix is wrong here

Adding Q8d to 44 individual handler files would cost ~22 hours of
mechanical edits. It would also leave the gap open for any
**future** handler that doesn't follow the discipline. The correct
architectural fix is **engine-enforced pre-call gating**.

## Remediation: engine-level pre-call gate

Implemented in [`lib/services/nodeExecutionService.ts`](../../lib/services/nodeExecutionService.ts)
in the `executeNode` method, BEFORE the dispatch to `executeNodeByType`.

Gate logic:

```ts
const shouldGate =
  context.testMode &&
  this.isExternalAction(node.data.type) &&
  context.testModeConfig?.actionMode !== ActionTestMode.EXECUTE_ALL

if (shouldGate) {
  // Engine pre-call gate. Refuses to invoke external-action handlers
  // in test mode unless EXECUTE_ALL is explicitly requested. Returns a
  // deterministic mock; the existing post-hoc INTERCEPT_WRITES wrapping
  // still applies on top so the UI sees the expected
  // { intercepted: {...} } envelope shape.
  nodeResult = {
    success: true,
    output: {
      __testModePreCallGate: true,
      simulated: true,
      message: `${node.data.type} blocked by engine pre-call gate`,
    },
    message: `Test mode: ${node.data.type} would have executed`,
  }
} else {
  nodeResult = await this.executeNodeByType(...)
}
```

Properties:

- **Single source of truth.** One check protects all 44 currently-
  unprotected cases plus any future handler that lacks Q8d.
- **`isExternalAction` semantics preserved.** Read-only operations
  (`fetch`, `get`, `list`, `search`, `find`) still execute, matching
  the existing `INTERCEPT_WRITES` semantics. Writes block before any
  network call.
- **EXECUTE_ALL escape hatch.** Live-mode-style testing
  (`actionMode === EXECUTE_ALL`) bypasses the gate. Used by the
  test framework when intentionally exercising real providers.
- **Defense in depth.** Existing post-hoc `INTERCEPT_WRITES` /
  `SKIP_ALL` wrapping still applies on top of the gated result. The
  UI continues to see `{ intercepted: { wouldHaveSent: ... } }` (with
  the gate's mock as `wouldHaveSent`).
- **No per-handler edits required.** The 44 handlers stay as-is for
  now. Per-handler Q8d remains a desirable contract for additional
  defense (and for the v1 path that PR-V2C's fallback uses), but it's
  no longer the only barrier.

## Resolved-by-this-PR cases

All 44 ⚠ cases listed below are now protected by the engine pre-call
gate. Per-handler Q8d remains backlog work to add belt-and-suspenders
protection.

**Inline / direct integration paths:**
- `slack_action_send_message` (integrationHandlers.ts:33-43, inline)
- `slack_action_create_channel` (integrationHandlers.ts:45-55, inline)

**Discord (executeDiscordAction):**
- `discord_action_send_message` / `send_channel_message` / `discord_send_channel_message`
- `discord_action_send_dm` / `discord_send_dm`
- `discord_action_edit_message`
- `discord_action_delete_message`
- `discord_action_fetch_messages` (read; gate skips by design)

**Airtable (executeAirtableAction):**
- `airtable_update_record` / `airtable_action_update_record`
- `airtable_delete_record` / `airtable_action_delete_record`
- `airtable_list_records` / `airtable_action_list_records` (read; gate skips)

**Notion (executeNotionAction → managePage wrapper):**
- All 9 cases route through wrappers that hardcode `testMode: false`,
  bypassing the Q8d in `notion/handlers.ts`. Gate now intercepts before
  the wrapper is reached.

**Trello (executeTrelloAction):**
- `trello_action_create_card`
- `trello_action_create_list`
- `trello_action_move_card`
- `trello_action_create_board`

**HubSpot (executeHubSpotAction):**
- `hubspot_action_create_contact` / `_dynamic`
- `hubspot_action_create_company`
- `hubspot_action_create_deal`
- `hubspot_action_add_contact_to_list`
- `hubspot_action_update_deal`

**Microsoft Excel (executeMicrosoftExcelAction):**
- `microsoft_excel_action_create_workbook` / `microsoft-excel_*`
- `microsoft_excel_action_create_row` / `microsoft-excel_*`
- `microsoft_excel_action_update_row` / `microsoft-excel_*`
- `microsoft_excel_action_delete_row` / `microsoft-excel_*`
- `microsoft_excel_action_export_sheet` / `microsoft-excel_*`
- `microsoft_excel_action_manage_data` / `microsoft_excel_unified_action`

**Microsoft OneNote (inline switch in execute()):**
- `microsoft-onenote_action_create_notebook`
- `microsoft-onenote_action_create_section`
- `microsoft-onenote_action_create_page`
- `microsoft-onenote_action_update_page`
- `microsoft-onenote_action_get_page_content` (read; gate skips)
- `microsoft-onenote_action_list_pages` (read; gate skips)
- `microsoft-onenote_action_copy_page`
- `microsoft-onenote_action_delete_page`

**Outlook action:**
- `microsoft-outlook_action_create_calendar_event`

**Dropbox:**
- `dropbox_upload_file` / `dropbox_action_upload_file`

## Backlog: per-handler Q8d (defense in depth)

Adding Q8d to individual handlers remains valuable for two reasons:

1. **PR-V2C's fallback path** routes unknown node types through v1's
   `executeAction`. The fallback short-circuits in test mode (see
   [registryFallback.ts](../../lib/services/executionHandlers/registryFallback.ts))
   so it's already safe. But ANY handler the engine reaches without
   passing through `nodeExecutionService.executeNode` (e.g., direct
   test harnesses, alternate dispatch surfaces in webhook entry paths)
   will skip the engine gate and fall back to per-handler Q8d.

2. **Belt and suspenders.** Even with the engine gate, a future
   refactor that moves the gate or adds a new dispatch entry point
   could re-expose handlers to test-mode bugs.

Tracked work: add `if (meta?.testMode) return { simulated: true }`
early-return to each of the following handler files. Pattern reference:
[lib/workflows/actions/gmail/sendEmail.ts:33-...](../../lib/workflows/actions/gmail/sendEmail.ts).

| Provider | Handler files (count) | Priority |
|---|---|---|
| Discord | `lib/workflows/actions/discord.ts` (5 functions) | High — common in workflows |
| HubSpot | `lib/workflows/actions/hubspot.ts` (5 functions) | High — payment-adjacent CRM ops |
| Notion | `lib/workflows/actions/notion/{managePage,manageDatabase,manageUsers,manageComments,...}.ts` (~10 functions) | High — must also fix the `testMode: false` hardcode in the wrappers |
| Excel | `lib/workflows/actions/microsoft-excel.ts` (6 functions) | Medium |
| OneNote | `lib/workflows/actions/microsoft-onenote/*.ts` (8 files) | Medium |
| Trello | `lib/workflows/actions/trello.ts` (4 functions) | Medium |
| Slack inline | `lib/workflows/actions/slack.ts` (`slackActionSendMessage`, `createSlackChannel`) | Medium |
| Airtable | `lib/workflows/actions/airtable/{updateRecord,deleteRecord,listRecords}.ts` | Medium |
| Outlook calendar | `lib/workflows/actions/microsoft-outlook/createEvent.ts` | Medium |
| Dropbox | `lib/workflows/actions/dropbox/uploadFile.ts` | Low |

Estimated total: ~22-25 hours of mechanical edits + per-handler tests.
Ship incrementally; each provider's batch is independent.

## Parity tests

Added [`__tests__/workflows/v2-testmode-pregate.test.ts`](../../__tests__/workflows/v2-testmode-pregate.test.ts)
covering the 7 representative cases from the audit task brief:

- Slack `slack_action_send_message`
- Google Sheets `google_sheets_action_append`
- Discord `discord_action_send_message`
- Airtable `airtable_action_create_record`
- Notion `notion_action_create_page` and `notion_action_manage_database`
- Gmail `gmail_action_send_email`
- Google Calendar `google_calendar_action_create_event`

For each: builds a `NodeExecutionService`, mocks the underlying SDK
boundary, calls `nodeExecutionService.executeNode` with `testMode: true`,
asserts the mocked SDK was **not** invoked, and asserts the returned
shape includes the `__testModePreCallGate` marker. The tests prove
behavior at the realistic call path (engine → dispatcher → handler),
not at an intermediate layer.

## What this finding does NOT change

- **PR-V2C's fallback** is unaffected. The fallback's own testMode
  short-circuit was already in place (PR-V2C); the engine gate is a
  parallel defense for explicit dispatch paths.
- **Q8d in handlers that have it** (Gmail send, Outlook send, Stripe,
  Shopify, etc.) continues to function. The engine gate fires before
  the handler is reached, so Q8d's early-return is dead code in v2's
  test mode going forward — but it's still load-bearing on the v1
  path during the cutover window.
- **`SKIP_ALL` mode** behaves the same. The engine gate fires first
  with `__testModePreCallGate`; the existing post-hoc `SKIP_ALL` layer
  at `nodeExecutionService.ts:110-120` then overwrites with the
  `skipped: true` mock. Net result identical to today.
- **`EXECUTE_ALL` mode** behaves the same. Gate respects EXECUTE_ALL
  by skipping itself.
