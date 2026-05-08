import { refreshAndRetry } from "@/services/oauth/refreshAndRetry";
import { enqueueRun } from "@/services/execution/enqueue";
import { getActiveForExecution } from "@/repositories/integrations";
import * as triggerResourcesRepo from "@/repositories/triggerResources";
import type { PollingHandler } from "@/services/triggers/pollingRegistry";
import { DEFAULT_INTERVAL_MS } from "@/services/cron/pollingIntervals";
import {
  HistoryListStaleCursorError,
  usersHistoryList,
  type GmailHistoryRecord,
} from "../../api/usersHistoryList";
import { usersGetProfile } from "../../api/usersGetProfile";
import { usersMessagesGet } from "../../api/usersMessagesGet";
import { advanceCheckpoint } from "./historyState";
import { checkAndMarkSeen } from "./dedup";
import { matchesFilters } from "./filters";
import { buildTriggerEvent } from "./messageHydration";
import { GmailNewEmailConfigSchema } from "./schema";

/**
 * Gmail new_email polling handler.
 *
 * Slice 2e: this is the orchestrator that ties together the small files
 * by concern (schema / filters / history state / hydration / dedup /
 * API wrappers). It's the V2 analog of V1 gmail-processor.ts but pruned
 * to the polling case — no Pub/Sub plumbing, no AI filter, no STORED_AHEAD
 * race handling.
 *
 * Per-tick flow:
 *   1. Parse the row's config through GmailNewEmailConfigSchema. Bad
 *      config throws → the cron records this as an error and moves on.
 *   2. Walk users.history.list from snapshot.historyId. On stale cursor
 *      (404/410) → re-snapshot via getProfile, log the gap, return — the
 *      gap is the messages we missed in the in-between window.
 *   3. Collect new message ids from the history pages
 *      (messagesAdded + labelsAdded), de-duped within the page.
 *   4. For each new message id:
 *      - dedup check via webhook_event_dedup (cross-tick safe).
 *      - users.messages.get with format=metadata.
 *      - matchesFilters() guard.
 *      - enqueueRun() with the canonical TriggerEvent.
 *   5. Persist updated config: snapshot.historyId advanced via
 *      advanceCheckpoint(); polling.lastPolledAt set to now.
 *
 * Errors from any one message are logged and skipped; one bad message
 * does not abort the tick.
 */

const HANDLER_ID = "gmail/new_email";

async function poll(input: {
  trigger: import("@/repositories/triggerResources").TriggerResourceRecord;
  userRole: string;
  now: number;
}): Promise<void> {
  const { trigger } = input;
  const config = GmailNewEmailConfigSchema.parse(trigger.config);

  if (!config.snapshot) {
    // Activation hook should have populated this; defensive log + skip.
    console.warn(
      JSON.stringify({
        event: "gmail.poll.no_snapshot",
        triggerId: trigger.id,
        workflowId: trigger.workflowId,
      }),
    );
    return;
  }

  // Resolve the integration's email up-front. trigger_resources.account_id
  // is intentionally NULL per services/triggers/lifecycle.ts — the design
  // is "account_id resolved on-demand" so that account swaps don't leave
  // stale rows. Webhook dispatchers read it from the inbound payload;
  // polling reads it here, once per cycle. The resolved email becomes
  // both TriggerEvent.accountId (so action handlers can target the right
  // inbox) AND the explicit accountId on refreshAndRetry calls (avoids
  // the multi-account ambiguity case).
  const integration = await getActiveForExecution(
    trigger.userId,
    "gmail",
    null,
  );
  if (!integration) {
    console.warn(
      JSON.stringify({
        event: "gmail.poll.no_integration",
        triggerId: trigger.id,
        workflowId: trigger.workflowId,
        userId: trigger.userId,
      }),
    );
    return;
  }
  const accountId = integration.providerAccountId;

  let cursor = config.snapshot.historyId;

  // Walk all pages. Page through with nextPageToken until exhausted.
  const collectedMessageIds: string[] = [];
  let pageToken: string | undefined;
  let latestApiHistoryId = cursor;
  let cursorReset = false;

  while (true) {
    let page;
    try {
      page = await refreshAndRetry({
        userId: trigger.userId,
        provider: "gmail",
        accountId,
        apiCall: async (accessToken) =>
          usersHistoryList({
            accessToken,
            startHistoryId: cursor,
            pageToken,
          }),
      });
    } catch (err) {
      if (err instanceof HistoryListStaleCursorError) {
        // Re-snapshot. Per Slice 2e plan: log the gap, no recovery
        // heuristic, continue from new cursor on the next tick.
        const profile = await refreshAndRetry({
          userId: trigger.userId,
          provider: "gmail",
          accountId,
          apiCall: async (accessToken) => usersGetProfile({ accessToken }),
        });
        console.warn(
          JSON.stringify({
            event: "gmail.poll.stale_cursor_resnapshot",
            triggerId: trigger.id,
            workflowId: trigger.workflowId,
            previousHistoryId: cursor,
            newHistoryId: profile.historyId,
          }),
        );
        latestApiHistoryId = profile.historyId;
        cursorReset = true;
        break;
      }
      throw err;
    }

    latestApiHistoryId = page.historyId;
    for (const id of extractMessageIds(page.history)) {
      collectedMessageIds.push(id);
    }

    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  // Dedup the message-id list within this tick (history pages can
  // surface the same message via both messagesAdded and labelsAdded).
  const uniqueIds = Array.from(new Set(collectedMessageIds));

  if (!cursorReset) {
    for (const messageId of uniqueIds) {
      try {
        await processOneMessage({ trigger, accountId, messageId });
      } catch (err) {
        console.warn(
          JSON.stringify({
            event: "gmail.poll.message_failed",
            triggerId: trigger.id,
            messageId,
            error: (err as Error).message,
          }),
        );
      }
    }
  }

  // Persist updated config. Note: when cursorReset is true (stale-cursor
  // path), advanceCheckpoint correctly takes the larger of the two —
  // latestApiHistoryId came from getProfile and is always >= the stored
  // cursor, so we move forward.
  const newCursor = advanceCheckpoint({
    startHistoryId: cursor,
    apiHistoryId: latestApiHistoryId,
  });
  await triggerResourcesRepo.updateConfig(trigger.id, {
    ...config,
    snapshot: {
      historyId: newCursor,
      capturedAt: cursorReset
        ? new Date().toISOString()
        : (config.snapshot?.capturedAt ?? new Date().toISOString()),
    },
    polling: {
      lastPolledAt: new Date(input.now).toISOString(),
    },
  });
}

async function processOneMessage(input: {
  trigger: import("@/repositories/triggerResources").TriggerResourceRecord;
  accountId: string;
  messageId: string;
}): Promise<void> {
  const { trigger, accountId, messageId } = input;
  const config = GmailNewEmailConfigSchema.parse(trigger.config);

  const dedupOutcome = await checkAndMarkSeen(messageId);
  if (dedupOutcome.outage) return; // fail-closed (see dedup.ts)
  if (!dedupOutcome.fresh) return; // already processed in a prior tick

  const message = await refreshAndRetry({
    userId: trigger.userId,
    provider: "gmail",
    accountId,
    apiCall: async (accessToken) => usersMessagesGet({ accessToken, messageId }),
  });

  if (!matchesFilters(message, config)) return;

  const event = buildTriggerEvent({
    emailAddress: accountId,
    message,
  });

  await enqueueRun({
    workflowId: trigger.workflowId,
    triggerNodeId: trigger.nodeId,
    event,
  });
}

function extractMessageIds(
  history: readonly GmailHistoryRecord[],
): string[] {
  const ids: string[] = [];
  for (const entry of history) {
    if (entry.messagesAdded) {
      for (const m of entry.messagesAdded) ids.push(m.message.id);
    }
    if (entry.labelsAdded) {
      for (const m of entry.labelsAdded) ids.push(m.message.id);
    }
    // V1 also flattened entry.messages as a defensive fallback (V1
    // gmail-processor.ts:885) — preserve that.
    if (entry.messages) {
      for (const m of entry.messages) ids.push(m.id);
    }
  }
  return ids;
}

export const gmailNewEmailPollingHandler: PollingHandler = {
  id: HANDLER_ID,
  canHandle: (trigger) =>
    trigger.provider === "gmail" && trigger.eventType === "new_email",
  getIntervalMs: () => DEFAULT_INTERVAL_MS,
  poll,
};
