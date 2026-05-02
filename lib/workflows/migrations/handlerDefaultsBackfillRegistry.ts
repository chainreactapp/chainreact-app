/**
 * PR-G0 — registry of backfill entries.
 *
 * Each PR-Gn that removes a silent handler default appends entries here.
 * `runHandlerDefaultsBackfill` reads this file (or an injected override
 * for tests) and applies every entry whose `pr` is in scope.
 *
 * Empty in PR-G0. Entries land starting in PR-G2 (Calendar Require rows),
 * PR-G3 (Drive/Docs Require rows), PR-G4 (Slack/Teams/Monday/OneDrive),
 * PR-G5 (Mailchimp/Shopify/AI), PR-G6 (GitHub default-branch — likely no
 * backfill needed since it's a `Change` row, not a `Require` row).
 *
 * When adding entries:
 *   1. The `nodeType` value must EXACTLY match the workflow_nodes.node_type
 *      string used by the registry / availableNodes. Confirm by querying
 *      `SELECT DISTINCT node_type FROM workflow_nodes WHERE node_type LIKE
 *      '<provider>%'` against staging before shipping.
 *   2. The `legacyDefault` MUST equal the previous handler-side default
 *      value, byte-for-byte. The whole point of this framework is to
 *      preserve existing behavior — a wrong value is a silent regression.
 *   3. The `auditRef` is the file:line from learning/docs/handler-defaults-audit.md
 *      so future readers can find the row that motivated the entry.
 *   4. Entries do NOT need to be in any particular order. The runner
 *      groups by nodeType internally for query efficiency.
 *
 * Contract: learning/docs/handler-contracts.md Q11.
 */

import type { BackfillEntry } from './handlerDefaultsBackfill'

export const HANDLER_DEFAULTS_BACKFILL_REGISTRY: readonly BackfillEntry[] = [
  // ─── PR-G2 — Calendar Require rows ────────────────────────────────────────
  // Each entry preserves the previous handler-side default value so existing
  // workflows continue to behave identically post-PR-G2 (the handler now
  // hard-fails on undefined, but backfilled configs supply the legacy value).
  {
    pr: 'PR-G2',
    nodeType: 'google_calendar_action_create_event',
    fieldName: 'sendNotifications',
    legacyDefault: 'all',
    auditRef: 'createEvent.ts:42',
  },
  {
    pr: 'PR-G2',
    nodeType: 'google_calendar_action_create_event',
    fieldName: 'guestsCanInviteOthers',
    legacyDefault: true,
    auditRef: 'createEvent.ts:43',
  },
  {
    pr: 'PR-G2',
    nodeType: 'google_calendar_action_create_event',
    fieldName: 'guestsCanSeeOtherGuests',
    legacyDefault: true,
    auditRef: 'createEvent.ts:44',
  },
  {
    pr: 'PR-G2',
    nodeType: 'google_calendar_action_update_event',
    fieldName: 'sendNotifications',
    legacyDefault: 'all',
    auditRef: 'updateEvent.ts:43',
  },
  {
    pr: 'PR-G2',
    nodeType: 'google_calendar_action_add_attendees',
    fieldName: 'sendNotifications',
    legacyDefault: 'all',
    auditRef: 'addAttendees.ts:29',
  },
  {
    pr: 'PR-G2',
    nodeType: 'google_calendar_action_remove_attendees',
    fieldName: 'sendNotifications',
    legacyDefault: 'all',
    auditRef: 'removeAttendees.ts:30',
  },
  {
    pr: 'PR-G2',
    nodeType: 'google_calendar_action_move_event',
    fieldName: 'sendNotifications',
    legacyDefault: 'all',
    auditRef: 'moveEvent.ts:30',
  },
  {
    pr: 'PR-G2',
    nodeType: 'google_calendar_action_delete_event',
    fieldName: 'sendNotifications',
    // deleteEvent / quickAddEvent defaulted to 'none' (different from the
    // other Calendar handlers' 'all'). Backfill preserves THAT specific
    // default — not a uniform 'all' across Calendar.
    legacyDefault: 'none',
    auditRef: 'deleteEvent.ts:29',
  },
  {
    pr: 'PR-G2',
    nodeType: 'google_calendar_action_quick_add_event',
    fieldName: 'sendNotifications',
    legacyDefault: 'none',
    auditRef: 'quickAddEvent.ts:29',
  },
  // ─── PR-G3 — Drive/Docs sharing notification Require rows ────────────────
  {
    pr: 'PR-G3',
    nodeType: 'google-drive:share_file',
    fieldName: 'sendNotification',
    legacyDefault: true,
    auditRef: 'shareFile.ts:24',
  },
  {
    pr: 'PR-G3',
    nodeType: 'google-drive:create_file',
    fieldName: 'shareNotification',
    legacyDefault: true,
    auditRef: 'uploadFile.ts:449',
    // Conditional: only backfill upload-file nodes that supply `shareWith`.
    // Nodes without shareWith never reach the share branch, so adding
    // shareNotification would pollute their config without behavior change.
    applyWhen: (config) => {
      const sw = config.shareWith
      return Array.isArray(sw) && sw.length > 0
    },
  },
  {
    pr: 'PR-G3',
    nodeType: 'google_docs_action_share_document',
    fieldName: 'sendNotification',
    legacyDefault: true,
    auditRef: 'googleDocs.ts:540',
  },
  // ─── PR-G4 — Slack/Teams/Monday/OneDrive visibility & notification ───────
  {
    pr: 'PR-G4',
    nodeType: 'slack_action_create_channel',
    fieldName: 'visibility',
    legacyDefault: 'public',
    auditRef: 'slack.ts:448',
  },
  {
    // slack/createChannel.ts is currently dead-coded out of the registry
    // (slack.ts:432's positional handler is what gets dispatched), but the
    // alternate handler still has a `Require` decision in the audit. The
    // backfill is harmless if the alternate handler isn't running, and
    // safety-net if it ever gets wired in. Same nodeType — both handlers
    // process `slack_action_create_channel` configs.
    pr: 'PR-G4',
    nodeType: 'slack_action_create_channel',
    fieldName: 'isPrivate',
    legacyDefault: false,
    auditRef: 'slack/createChannel.ts:29',
  },
  {
    pr: 'PR-G4',
    nodeType: 'slack_action_invite_users_to_channel',
    fieldName: 'sendInviteNotification',
    legacyDefault: true,
    auditRef: 'slack/inviteUsersToChannel.ts:22',
  },
  {
    pr: 'PR-G4',
    nodeType: 'teams_action_create_group_chat',
    fieldName: 'sendInvitationEmail',
    legacyDefault: true,
    auditRef: 'teams/createGroupChat.ts:100',
  },
  {
    pr: 'PR-G4',
    nodeType: 'monday_action_create_board',
    fieldName: 'boardKind',
    legacyDefault: 'public',
    auditRef: 'monday/createBoard.ts:15',
  },
  {
    pr: 'PR-G4',
    nodeType: 'onedrive_action_create_sharing_link',
    fieldName: 'linkScope',
    legacyDefault: 'anonymous',
    auditRef: 'onedrive/createSharingLink.ts:21',
  },
  // ─── PR-G5 — Mailchimp/Shopify/AI compliance Require rows ────────────────
  {
    pr: 'PR-G5',
    nodeType: 'mailchimp_action_add_subscriber',
    fieldName: 'status',
    legacyDefault: 'subscribed',
    auditRef: 'mailchimp/addSubscriber.ts:22',
  },
  {
    pr: 'PR-G5',
    nodeType: 'shopify_action_update_order_status',
    fieldName: 'notify_customer',
    legacyDefault: false,
    auditRef: 'shopify/updateOrderStatus.ts:29',
  },
  {
    pr: 'PR-G5',
    nodeType: 'ai_agent',
    fieldName: 'respondInstructions',
    // Prior silent fallback when actionType='respond'. Backfill applies
    // ONLY to nodes configured for the 'respond' action — other action
    // types use different fields (extractFields, summarizeFormat, etc.)
    // and aren't affected by this row.
    legacyDefault: 'Respond helpfully to the incoming message',
    auditRef: 'aiAgentAction.ts:213',
    applyWhen: (config) => config.actionType === 'respond',
  },
]
