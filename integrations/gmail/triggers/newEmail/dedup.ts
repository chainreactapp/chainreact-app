import * as dedupRepo from "@/repositories/webhookEventDedup";

/**
 * Polling-side dedup wrapper around `webhook_event_dedup`.
 *
 * Slice 2e: V1 used a per-process Map with a 5-minute TTL
 * (gmail-processor.ts:21-82). That works in V1's long-lived webhook
 * server context but is useless in serverless polling — every cron
 * invocation is a fresh process. We replace the in-memory map with the
 * existing `webhook_event_dedup` table, keyed on the Gmail message id.
 *
 * The dispatch-side dedup pattern is identical (see
 * services/triggers/dispatch.ts) so we get behavioral parity between
 * webhook and polling event sources without two competing dedup stores.
 *
 * Outage policy: V2's webhook dispatcher fails-open on dedup errors
 * (Q4 session-side-effects idempotency catches duplicate side effects
 * downstream). Polling has no such Q4 backstop yet, so we fail-CLOSED:
 * if markSeen throws, we skip enqueue for that message and rely on the
 * next poll tick to retry. Rationale: a transient dedup failure that
 * causes a duplicate run could fire user-facing actions twice; failing
 * closed delays-but-doesn't-double on retry.
 */

export interface DedupOutcome {
  /** True iff this is the first time we've seen this Gmail message id. */
  fresh: boolean;
  /** True iff dedup itself errored — caller skips this message. */
  outage: boolean;
}

export async function checkAndMarkSeen(
  gmailMessageId: string,
): Promise<DedupOutcome> {
  try {
    const { fresh } = await dedupRepo.markSeen("gmail", gmailMessageId);
    return { fresh, outage: false };
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "gmail.poll.dedup.outage",
        messageId: gmailMessageId,
        error: (err as Error).message,
      }),
    );
    return { fresh: false, outage: true };
  }
}
