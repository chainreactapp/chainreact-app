import { randomUUID } from "node:crypto";
import type { TriggerEvent } from "@/contracts/triggerEvent";
import { resolveStrict } from "@/workflow-engine/variables/resolveValue";
import { WorkflowEngine } from "./engine";

/**
 * Webhook → execution handoff.
 *
 * Per docs/rules/webhook-receipt-routes.md §"Async dispatch only":
 *   - Webhook routes enqueue and return; execution runs asynchronously.
 *   - The route MUST return 200 once events are durably enqueued (here:
 *     once we've assigned a runId and kicked off the engine). The engine's
 *     own failures are logged out-of-band and never propagate back to the
 *     provider's webhook delivery.
 *
 * For Slice 1 the "queue" is in-process: we fire-and-forget the engine
 * promise. This trades durability for simplicity — a node restart between
 * enqueue and engine completion drops the run. Real durability lands when
 * the queue (BullMQ / Inngest / equivalent) ships, with no API change to
 * the dispatcher (it still calls enqueueRun and gets back { runId }).
 */

export interface EnqueueRunInput {
  workflowId: string;
  triggerNodeId: string;
  event: TriggerEvent;
}

export interface EnqueueRunResult {
  runId: string;
  enqueuedAt: string;
}

export async function enqueueRun(input: EnqueueRunInput): Promise<EnqueueRunResult> {
  const runId = randomUUID();
  const enqueuedAt = new Date().toISOString();

  console.info(
    JSON.stringify({
      event: "execution.run.enqueued",
      runId,
      workflowId: input.workflowId,
      triggerNodeId: input.triggerNodeId,
      provider: input.event.provider,
      eventType: input.event.eventType,
      eventId: input.event.eventId,
    }),
  );

  // Fire-and-forget. The webhook caller already returned 200; the engine
  // owns its own errors via structured logs.
  void runWorkflowInBackground(input, runId);

  return { runId, enqueuedAt };
}

async function runWorkflowInBackground(
  input: EnqueueRunInput,
  runId: string,
): Promise<void> {
  try {
    const engine = new WorkflowEngine({ resolveStrict });
    await engine.runWorkflow({
      workflowId: input.workflowId,
      triggerNodeId: input.triggerNodeId,
      triggerEvent: input.event,
      runId,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "execution.run.crashed",
        runId,
        workflowId: input.workflowId,
        error: (err as Error).message,
      }),
    );
  }
}
