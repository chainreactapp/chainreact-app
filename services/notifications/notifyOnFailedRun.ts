import * as notificationsRepo from "@/repositories/notifications";
import type { HumanizedError } from "@/core/errors/humanizeActionError";

/**
 * Insert an in-app notification for a failed workflow run.
 *
 * Per master plan §10 Slice 1: in-app only — email/Slack/Discord/SMS fan-out
 * is deferred to a later slice. The humanized error_classification produced
 * by core/errors/humanizeActionError is the source of the user-facing copy;
 * this service just persists it as a durable user-scoped record.
 *
 * Idempotency / dedup is intentionally NOT in scope here. The engine calls
 * this exactly once per finalized failed run inside persistRun. Multiple
 * notifications for the same workflow over time are correct (each run is a
 * distinct event the user should know about); the dedup question is "should
 * a single failed run produce multiple rows" and the answer is no — it
 * doesn't, because there's exactly one call site.
 */

export interface NotifyOnFailedRunInput {
  userId: string;
  workflowId: string;
  runId: string;
  errorClassification: HumanizedError;
}

export async function notifyOnFailedRun(
  input: NotifyOnFailedRunInput,
): Promise<void> {
  await notificationsRepo.create({
    userId: input.userId,
    type: "workflow_failed",
    severity: input.errorClassification.severity,
    title: input.errorClassification.title,
    body: buildBody(input.errorClassification),
    actionUrl: `/workflows/${input.workflowId}?historyRun=${input.runId}`,
    metadata: {
      workflowId: input.workflowId,
      runId: input.runId,
      ...(input.errorClassification.action !== undefined
        ? { action: input.errorClassification.action }
        : {}),
    },
  });
}

/**
 * Combine description + hint (if present) into a single body string. The
 * notification list UI is one row per notification; we'd rather inline the
 * hint than nest sub-content. Hint is the user's action recommendation
 * ("Reconnect Slack", "Pick a different channel"), so it's load-bearing.
 */
function buildBody(err: HumanizedError): string {
  if (err.hint) return `${err.description} ${err.hint}`;
  return err.description;
}
