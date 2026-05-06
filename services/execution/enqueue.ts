import type { TriggerEvent } from "@/contracts/triggerEvent";

/**
 * Stub for the execution enqueue path.
 *
 * Per docs/rules/webhook-receipt-routes.md §"Async dispatch only": webhook
 * routes enqueue and return; execution runs asynchronously.
 *
 * Slice 1J ships the trigger lifecycle + dispatch path. Slice 1K wires this
 * function to the real execution engine. For now it logs a structured event
 * and returns immediately so the dispatcher's contract can be exercised
 * end-to-end (webhook → dedup → match → "enqueued").
 *
 * The signature is intentional: the executor will receive workflowId,
 * triggerNodeId (so it knows which node fired), and the canonical event
 * payload that variable resolution will read from.
 */
export interface EnqueueRunInput {
  workflowId: string;
  triggerNodeId: string;
  event: TriggerEvent;
}

export interface EnqueueRunResult {
  /** Server-assigned id for the queued run; `null` from the stub. */
  runId: string | null;
  enqueuedAt: string;
}

export async function enqueueRun(input: EnqueueRunInput): Promise<EnqueueRunResult> {
  // Structured log so the Slice 1J observability path is visible end-to-end.
  // PII-safe: we log shape (provider, eventType, workflowId), never the full payload.
  console.info(
    JSON.stringify({
      event: "execution.enqueue.stub",
      workflowId: input.workflowId,
      triggerNodeId: input.triggerNodeId,
      provider: input.event.provider,
      eventType: input.event.eventType,
      eventId: input.event.eventId,
    }),
  );
  return { runId: null, enqueuedAt: new Date().toISOString() };
}
