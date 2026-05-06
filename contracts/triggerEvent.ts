import { z } from "zod";

/**
 * Canonical workflow trigger event.
 *
 * Per docs/rules/webhook-receipt-routes.md §"Single source of truth":
 *   - This is the shape every provider's `normalize.ts` produces.
 *   - The dispatcher in `core/triggers/dispatch.ts` reads this contract;
 *     provider-specific quirks end at `normalize`.
 *   - Distinct from billing/system events (contracts/billingEvent.ts ships
 *     with the Stripe slice).
 *
 * Fields:
 *   - `provider`: registry id ("slack", "gmail", …). Must match
 *     trigger_resources.provider for dispatch.
 *   - `eventType`: provider-scoped type ("message_received",
 *     "channel.created", …). The trigger configuration's `type` matches
 *     against this.
 *   - `eventId`: provider-supplied stable id used for idempotency dedup
 *     keyed on `(provider, eventId)`. Where the provider has no stable id
 *     the manifest declares a deterministic-hash strategy (rule §
 *     "Provider event-id field").
 *   - `occurredAt`: ISO-8601 timestamp from the provider payload (or our
 *     receipt time if the provider doesn't supply one).
 *   - `accountId`: provider account scope (Slack team_id, Notion
 *     workspace_id). Disambiguates events when one user has multiple
 *     accounts on the same provider.
 *   - `payload`: the original provider payload, opaque at this layer.
 *     Action handlers / variable resolver consume specific fields.
 */
export const TriggerEventSchema = z.object({
  provider: z.string().min(1),
  eventType: z.string().min(1),
  eventId: z.string().min(1),
  occurredAt: z.string().min(1),
  accountId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});
export type TriggerEvent = z.infer<typeof TriggerEventSchema>;
