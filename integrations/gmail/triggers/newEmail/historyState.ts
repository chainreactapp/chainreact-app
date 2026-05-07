/**
 * Gmail historyId checkpoint state machine.
 *
 * Slice 2e: ported from V1 gmail-processor.ts:495-572 + 785-837.
 *
 * V1's STORED_AHEAD branch defended against a Pub/Sub race: notification
 * historyIds could arrive out of order, so V1 had to re-query from the
 * notification's historyId without regressing the stored cursor. V2 polls
 * on a cron tick — there's no out-of-order notification stream, so we
 * only need STORED_BEHIND (advance) and EQUAL (no-op). The V2 code path
 * is much smaller than V1 by design.
 *
 * Cursor advancement rule (preserved from V1): the new stored historyId
 * is `max(originalStored, apiResponse.historyId)`. This guards against
 * any future case where the API response somehow returns an older
 * historyId; we never regress.
 */

export interface AdvanceCheckpointInput {
  /** The cursor we sent in (BigInt-as-string). */
  startHistoryId: string;
  /**
   * The historyId echoed in the API response. Gmail sets this to the
   * latest mailbox historyId, even when `history` is empty.
   */
  apiHistoryId: string;
}

/**
 * Pure function: returns the historyId we should persist next, never
 * regressing below `startHistoryId`. Caller writes the result back via
 * `triggerResourcesRepo.updateConfig`.
 */
export function advanceCheckpoint(input: AdvanceCheckpointInput): string {
  const stored = safeBigInt(input.startHistoryId);
  const fromApi = safeBigInt(input.apiHistoryId);
  if (stored === null && fromApi === null) {
    // Both unparseable — preserve the start value (defensive fallback).
    return input.startHistoryId;
  }
  if (stored === null) return input.apiHistoryId;
  if (fromApi === null) return input.startHistoryId;
  return fromApi > stored
    ? input.apiHistoryId
    : input.startHistoryId;
}

function safeBigInt(value: string): bigint | null {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
