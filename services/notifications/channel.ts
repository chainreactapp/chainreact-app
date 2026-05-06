import type { WorkflowFailurePayload } from "./buildWorkflowFailurePayload";

/**
 * NotificationChannel interface — the shape every channel implementation
 * conforms to. Channels live under services/notifications/channels/.
 *
 * send() MUST NOT throw. Channel-specific failures (Slack API down, SMTP
 * refused, in-app DB error) return { delivered: false, reason } so the
 * orchestrator can fan out to other channels independently. A throw
 * propagates to the orchestrator which logs but doesn't block other
 * channels — see notifyWorkflowFailure.ts.
 */

export type ChannelName = "in_app" | "email" | "slack" | "discord" | "sms";

export type ChannelDeliveryResult =
  | { delivered: true }
  | { delivered: false; reason: string };

export interface NotificationChannel {
  readonly name: ChannelName;
  send(payload: WorkflowFailurePayload, userId: string): Promise<ChannelDeliveryResult>;
}
