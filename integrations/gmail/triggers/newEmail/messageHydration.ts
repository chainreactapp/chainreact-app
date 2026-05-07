import type { TriggerEvent } from "@/contracts/triggerEvent";
import type {
  GmailHeader,
  UsersMessagesGetResult,
} from "../../api/usersMessagesGet";

/**
 * Build the canonical TriggerEvent payload from a hydrated Gmail message.
 *
 * Slice 2e: ports V1 gmail-processor.ts:311-358 (parseGmailMessage) but
 * adapts to V2's TriggerEvent contract and the format=metadata response
 * shape. The payload omits the email body (format=metadata doesn't
 * include it) — workflows needing body content add a follow-up GetEmail
 * action node.
 *
 * Field map from Gmail metadata response → TriggerEvent.payload:
 *   - id, threadId           → straight passthrough
 *   - labelIds, snippet       → straight passthrough
 *   - From / To / Cc / Bcc / Subject / Date / Message-ID / Delivered-To
 *                            → header lookup; case-insensitive
 *   - internalDate (ms)      → exposed as ISO 8601 in `receivedAt`
 *   - sizeEstimate           → straight passthrough (useful for filters)
 *   - hasAttachments         → mimeType heuristic (filters.ts also uses)
 */

export function buildTriggerEvent(input: {
  emailAddress: string;
  message: UsersMessagesGetResult;
}): TriggerEvent {
  const { message, emailAddress } = input;
  const headers = message.payload.headers;
  const internalMs = Number(message.internalDate);
  const occurredAt = Number.isFinite(internalMs)
    ? new Date(internalMs).toISOString()
    : new Date().toISOString();

  return {
    provider: "gmail",
    eventType: "new_email",
    // Gmail message id is unique per mailbox and stable across history
    // walks — perfect dedup key for webhook_event_dedup.
    eventId: message.id,
    occurredAt,
    accountId: emailAddress,
    payload: {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds,
      snippet: message.snippet,
      sizeEstimate: message.sizeEstimate,
      mimeType: message.payload.mimeType,
      hasAttachments: looksAttached(message.payload.mimeType),
      from: headerValue(headers, "From"),
      to: headerValue(headers, "To"),
      cc: headerValue(headers, "Cc"),
      bcc: headerValue(headers, "Bcc"),
      subject: headerValue(headers, "Subject"),
      date: headerValue(headers, "Date"),
      messageId: headerValue(headers, "Message-ID"),
      deliveredTo: headerValue(headers, "Delivered-To"),
      receivedAt: occurredAt,
    },
  };
}

function headerValue(
  headers: readonly GmailHeader[],
  name: string,
): string {
  for (const h of headers) {
    if (h.name.toLowerCase() === name.toLowerCase()) return h.value;
  }
  return "";
}

function looksAttached(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("multipart/mixed");
}
