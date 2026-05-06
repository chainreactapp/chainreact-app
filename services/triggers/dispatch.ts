import type { TriggerEvent } from "@/contracts/triggerEvent";
import * as triggerResourcesRepo from "@/repositories/triggerResources";
import { getStateForDispatch } from "@/repositories/workflows";
import * as dedup from "@/repositories/webhookEventDedup";
import { enqueueRun } from "@/services/execution/enqueue";

/**
 * Provider-agnostic webhook dispatcher.
 *
 * Per docs/rules/webhook-receipt-routes.md §"V2 intended behavior":
 *   - Reads the canonical TriggerEvent shape; provider quirks end at
 *     normalize.ts.
 *   - Dedup keyed on (provider, eventId).
 *   - Drops events for non-active workflows even when the trigger row
 *     still exists (paused retains registration; provider deregistration
 *     may lag for disabled / deleted).
 *   - Async dispatch only — calls enqueueRun and returns; never executes
 *     synchronously inside the route.
 *
 * Dedup outage policy is fail-open per the rule (Q4 session-side-effects
 * idempotency catches duplicate side effects further down the chain). When
 * markSeen throws, we log a structured outage marker and proceed with
 * dispatch.
 */

export interface DispatchResult {
  /** Number of trigger_resources rows that matched (provider, eventType). */
  matched: number;
  /** Number of runs actually enqueued (matched minus filtered drops). */
  enqueued: number;
  /** True iff this event was already in the dedup table. */
  duplicate: boolean;
  /** True iff dedup encountered an error and we proceeded anyway. */
  dedupOutage: boolean;
}

export async function dispatchTriggerEvent(
  event: TriggerEvent,
): Promise<DispatchResult> {
  // 1. Idempotency dedup.
  let dedupOutage = false;
  let fresh = true;
  try {
    const result = await dedup.markSeen(event.provider, event.eventId);
    fresh = result.fresh;
  } catch (err) {
    dedupOutage = true;
    console.warn(
      JSON.stringify({
        event: "webhook.dedup.outage",
        provider: event.provider,
        eventId: event.eventId,
        error: (err as Error).message,
      }),
    );
  }

  if (!fresh) {
    console.debug(
      JSON.stringify({
        event: "webhook.dedup.duplicate",
        provider: event.provider,
        eventId: event.eventId,
      }),
    );
    return { matched: 0, enqueued: 0, duplicate: true, dedupOutage };
  }

  // 2. Find trigger_resources for (provider, eventType).
  const resources = await triggerResourcesRepo.listForDispatch(
    event.provider,
    event.eventType,
  );
  if (resources.length === 0) {
    return { matched: 0, enqueued: 0, duplicate: false, dedupOutage };
  }

  // 3. For each candidate, gate on workflow state and enqueue.
  let enqueued = 0;
  for (const resource of resources) {
    const state = await getStateForDispatch(resource.workflowId);
    if (state !== "active") {
      console.debug(
        JSON.stringify({
          event: "webhook.dispatch.dropped_inactive",
          workflowId: resource.workflowId,
          state,
          provider: event.provider,
          eventType: event.eventType,
        }),
      );
      continue;
    }
    await enqueueRun({
      workflowId: resource.workflowId,
      triggerNodeId: resource.nodeId,
      event,
    });
    enqueued += 1;
  }

  return { matched: resources.length, enqueued, duplicate: false, dedupOutage };
}
