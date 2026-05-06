import * as notificationsRepo from "@/repositories/notifications";
import {
  buildPlainTextBody,
  type WorkflowFailurePayload,
} from "../buildWorkflowFailurePayload";
import type { NotificationChannel, ChannelDeliveryResult } from "../channel";

/**
 * In-app notification channel.
 *
 * Persists a row in the `notifications` table for the user's in-app feed
 * (the /notifications page + the home-page badge). One channel
 * implementation among the planned email / Slack / Discord / SMS set
 * (Slice 2). Channel.send returns a delivery result; throws are caught
 * inside this implementation and surfaced as { delivered: false } so the
 * orchestrator can fan out to other channels independently.
 *
 * Per V2 notifications platform plan §6 — channel implementations live
 * under services/notifications/channels/, separately from the orchestrator.
 */

export const inAppChannel: NotificationChannel = {
  name: "in_app",

  async send(payload: WorkflowFailurePayload, userId: string): Promise<ChannelDeliveryResult> {
    try {
      await notificationsRepo.create({
        userId,
        type: "workflow_failed",
        severity: payload.errorClassification.severity,
        title: payload.errorClassification.title,
        body: buildPlainTextBody(payload.errorClassification),
        actionUrl: payload.ctaUrl,
        metadata: {
          workflowId: payload.workflowId,
          workflowName: payload.workflowName,
          runId: payload.runId,
          ...(payload.errorClassification.action !== undefined
            ? { action: payload.errorClassification.action }
            : {}),
        },
      });
      return { delivered: true };
    } catch (err) {
      return {
        delivered: false,
        reason: err instanceof Error ? err.message : "unknown error",
      };
    }
  },
};
