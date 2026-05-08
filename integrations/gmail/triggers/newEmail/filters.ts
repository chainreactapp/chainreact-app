import type { UsersMessagesGetResult, GmailHeader } from "../../api/usersMessagesGet";
import type { GmailNewEmailConfig } from "./schema";

/**
 * Client-side filter matching for the Gmail new_email trigger.
 *
 * Slice 2e: ported from V1 gmail-processor.ts:1038-1108 and 148-170 with
 * three deltas:
 *   - V1 normalized `from` from four input shapes; the schema now enforces
 *     `string[]` upstream, so this file just lower-cases and matches.
 *   - hasAttachment uses a top-level mimeType heuristic (multipart/mixed)
 *     because format=metadata responses don't include payload.parts. V1
 *     had access to format=full and walked parts looking for filenames;
 *     V2's heuristic is "good enough" for the mainstream filter case and
 *     documented as such.
 *   - The AI content filter (V1 lines 1111-1126) is not ported in 2e.
 *
 * Match semantics match V1:
 *   - labelIds: AND-with-any (the email must carry at least one of the
 *     configured labels). Empty configured array means "no label
 *     constraint".
 *   - from: OR-match across configured senders, case-insensitive
 *     (compares the email-only token in the From header).
 *   - subject: substring or exact match per `subjectExactMatch`.
 *   - hasAttachment: 'any' = pass; 'yes' = mimeType startsWith
 *     'multipart/mixed'; 'no' = NOT mimeType startsWith 'multipart/mixed'.
 */

export function matchesFilters(
  message: UsersMessagesGetResult,
  config: GmailNewEmailConfig,
): boolean {
  if (!matchesLabels(message.labelIds, config.labelIds)) return false;

  const headers = message.payload.headers;
  if (!matchesFrom(headerValue(headers, "From"), config.from)) return false;
  if (
    !matchesSubject(
      headerValue(headers, "Subject"),
      config.subject,
      config.subjectExactMatch,
    )
  ) {
    return false;
  }
  if (!matchesAttachment(message.payload.mimeType, config.hasAttachment)) {
    return false;
  }
  return true;
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

function matchesLabels(
  emailLabels: readonly string[],
  configLabels: readonly string[],
): boolean {
  if (configLabels.length === 0) return true; // no constraint
  const set = new Set(emailLabels);
  for (const want of configLabels) {
    if (set.has(want)) return true;
  }
  return false;
}

function matchesFrom(
  rawFromHeader: string,
  configFrom: readonly string[],
): boolean {
  if (configFrom.length === 0) return true;
  const emailFrom = extractEmailAddress(rawFromHeader).toLowerCase();
  if (!emailFrom) return false;
  for (const candidate of configFrom) {
    if (candidate.toLowerCase() === emailFrom) return true;
  }
  return false;
}

/**
 * Extract the email address from a `From` header that may carry a display
 * name: `"Alice" <alice@example.com>` → `alice@example.com`. If the header
 * is already a bare address, return it unchanged.
 */
function extractEmailAddress(headerValue: string): string {
  const angle = headerValue.match(/<([^>]+)>/);
  if (angle) return angle[1]!.trim();
  return headerValue.trim();
}

function matchesSubject(
  emailSubject: string,
  configSubject: string,
  exact: boolean,
): boolean {
  if (configSubject === "") return true;
  if (exact) return emailSubject === configSubject;
  return emailSubject.toLowerCase().includes(configSubject.toLowerCase());
}

/**
 * Attachment filter — heuristic via top-level mimeType.
 *
 * Why this is a heuristic, not exact: format=metadata responses omit
 * payload.parts. V1 used format=full and inspected parts; we accept the
 * tradeoff (smaller responses, faster polls, body not exposed downstream)
 * and document the cost.
 *
 * Most user-attached files produce `multipart/mixed`. Inline images that
 * don't render as attachments produce `multipart/related`; messages with
 * just text+html produce `multipart/alternative`. Plain-text-only messages
 * have a non-multipart top-level mimeType.
 */
function matchesAttachment(
  mimeType: string,
  mode: GmailNewEmailConfig["hasAttachment"],
): boolean {
  if (mode === "any") return true;
  const looksAttached = mimeType.toLowerCase().startsWith("multipart/mixed");
  return mode === "yes" ? looksAttached : !looksAttached;
}
