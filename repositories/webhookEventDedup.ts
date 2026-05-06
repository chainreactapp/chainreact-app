import { getServiceRoleClient } from "./supabase/serviceRoleClient";

/**
 * Repository for webhook_event_dedup.
 *
 * Per docs/rules/webhook-receipt-routes.md:
 *   - Idempotency dedup keyed by (provider, event_id) with TTL cleanup.
 *   - Service-role only — system table; no per-user access.
 *   - Dedup outage policy: callers treat unexpected errors as fail-open
 *     (dispatch proceeds; Q4 session-side-effects idempotency catches
 *     duplicate side effects downstream).
 */

export interface MarkSeenResult {
  /** True iff the (provider, eventId) pair was newly inserted. */
  fresh: boolean;
}

/**
 * Insert (provider, eventId) with ON CONFLICT DO NOTHING. Returns
 * `{ fresh: true }` when the insert took, `{ fresh: false }` when the
 * row already existed (a duplicate event delivery).
 *
 * Throws on connection / query errors; the caller (dispatcher) decides
 * whether to fail-open per the rule.
 */
export async function markSeen(
  provider: string,
  eventId: string,
): Promise<MarkSeenResult> {
  const supabase = getServiceRoleClient(
    `webhook dedup: markSeen ${provider}/${eventId}`,
  );
  // Postgres returns the inserted row on success; on conflict + ignoreDuplicates,
  // .select() returns an empty array. We map empty -> not fresh.
  const { data, error } = await supabase
    .from("webhook_event_dedup")
    .upsert(
      { provider, event_id: eventId },
      { onConflict: "provider,event_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    throw new Error(`webhook_event_dedup.markSeen failed: ${error.message}`);
  }
  return { fresh: (data?.length ?? 0) > 0 };
}

/**
 * Delete rows whose `expires_at` is in the past. Used by the daily cleanup
 * cron (Slice 1J wires this; the cron route ships in a later slice).
 */
export async function purgeExpired(): Promise<number> {
  const supabase = getServiceRoleClient("webhook dedup: purgeExpired cron");
  const { data, error } = await supabase
    .from("webhook_event_dedup")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");
  if (error) {
    throw new Error(`webhook_event_dedup.purgeExpired failed: ${error.message}`);
  }
  return data?.length ?? 0;
}
