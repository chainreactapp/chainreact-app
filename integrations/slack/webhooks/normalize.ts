import {
  TriggerEventSchema,
  type TriggerEvent,
} from "@/contracts/triggerEvent";

/**
 * Slack event payload → canonical TriggerEvent.
 *
 * Per docs/rules/webhook-receipt-routes.md §"V2 intended behavior":
 *   - Pure function. No I/O.
 *   - The output is validated against TriggerEventSchema; a parse failure
 *     means the Slack payload was unexpectedly shaped (drop & log
 *     upstream, do not throw silently).
 *
 * Slack Events API payload shape we consume:
 *   {
 *     type: "event_callback",
 *     team_id: "T0001",
 *     event_id: "Ev123",
 *     event_time: 1730000000,           // unix seconds
 *     event: { type: "message", channel: "C123", user: "U1", text: "hi", ... },
 *     ...
 *   }
 *
 * The canonical eventType is Slack's `event.type` directly (e.g. "message",
 * "channel_created"). Trigger configurations select on this string with
 * provider="slack" namespacing — no translation table is needed.
 */

export interface SlackEventCallbackPayload {
  type: "event_callback";
  team_id: string;
  event_id: string;
  event_time: number;
  event: {
    type: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function normalizeSlackEvent(
  payload: SlackEventCallbackPayload,
): TriggerEvent {
  const candidate: TriggerEvent = {
    provider: "slack",
    eventType: payload.event.type,
    eventId: payload.event_id,
    occurredAt: new Date(payload.event_time * 1000).toISOString(),
    accountId: payload.team_id,
    payload: payload.event,
  };
  // Defense-in-depth: validate the canonical shape so a malformed Slack
  // payload doesn't reach the dispatcher.
  return TriggerEventSchema.parse(candidate);
}
