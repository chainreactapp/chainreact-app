import * as workflowRunsRepo from "@/repositories/workflowRuns";
import type { HumanizedError } from "@/core/errors/humanizeActionError";
import { buildWorkflowFailurePayload } from "./buildWorkflowFailurePayload";
import { getEnabledChannelsForUser } from "./channelRegistry";
import type { ChannelName } from "./channel";

/**
 * Workflow-failure notification orchestrator.
 *
 * Per V2 notifications platform plan §1 (Target architecture): one
 * classified failure event → atomic dedup claim → one payload → fan out
 * to enabled channels in parallel-but-isolated → return aggregate.
 *
 * Algorithm:
 *   1. Atomically claim the dedup slot on workflow_runs. If another caller
 *      already claimed (engine retry, future resume-from-failed-node,
 *      durable-queue redelivery), return early — channels NOT invoked.
 *   2. Build the per-channel payload via the pure builder.
 *   3. Resolve enabled channels for the user (Slice 1: hardcoded in-app).
 *   4. Invoke each channel's send(). Channel exceptions are caught here so
 *      one channel failing doesn't block the others.
 *   5. Return per-channel results so the caller can log.
 *
 * Engine integration: called from services/execution/engine.ts:persistRun
 * exactly once per finalized failed run. Notification failures are logged
 * by the engine but never propagate (the run already persisted; the user
 * can still see the failure on the workflow-detail run history).
 */

export interface NotifyWorkflowFailureInput {
  userId: string;
  workflowId: string;
  workflowName: string;
  runId: string;
  errorClassification: HumanizedError;
}

export interface PerChannelOutcome {
  channel: ChannelName;
  delivered: boolean;
  reason?: string;
}

export type NotifyWorkflowFailureResult =
  | { claimed: true; results: readonly PerChannelOutcome[] }
  | { claimed: false; reason: "already_fired" };

export async function notifyWorkflowFailure(
  input: NotifyWorkflowFailureInput,
): Promise<NotifyWorkflowFailureResult> {
  const claimed = await workflowRunsRepo.claimNotificationFanout(input.runId);
  if (!claimed) {
    return { claimed: false, reason: "already_fired" };
  }

  const payload = buildWorkflowFailurePayload({
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    runId: input.runId,
    errorClassification: input.errorClassification,
  });

  const channels = getEnabledChannelsForUser(input.userId);
  const results: PerChannelOutcome[] = [];
  for (const channel of channels) {
    try {
      const result = await channel.send(payload, input.userId);
      results.push(
        result.delivered
          ? { channel: channel.name, delivered: true }
          : { channel: channel.name, delivered: false, reason: result.reason },
      );
    } catch (err) {
      // Defense-in-depth: channel.send() shouldn't throw per the contract,
      // but if one does, isolate the failure so other channels still run.
      results.push({
        channel: channel.name,
        delivered: false,
        reason: err instanceof Error ? err.message : "unknown channel exception",
      });
    }
  }

  return { claimed: true, results };
}
