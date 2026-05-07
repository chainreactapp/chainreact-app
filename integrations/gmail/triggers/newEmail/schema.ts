import { z } from "zod";

/**
 * Zod schema for the Gmail "new_email" trigger config.
 *
 * Slice 2e: ports the V1 newEmail.schema.ts field set, with three deltas:
 *   - The AI content filter fields (`aiContentFilter`, `aiFilterConfidence`,
 *     `aiFailClosed`, `aiUseEmbeddingPrefilter`) are intentionally omitted —
 *     out of scope for Slice 2e (avoids the @anthropic-ai/sdk dep + the
 *     "fails open" behavior that bypasses user filters on AI errors).
 *     Restored in a follow-up slice.
 *   - `from` is a single string[] (V1 accepted four input shapes via
 *     brittle normalization at runtime — see V1 gmail-processor.ts:88-132).
 *     We standardize on the array shape here.
 *   - `pollingEnabled` and `snapshot` live alongside the user-set fields.
 *     `pollingEnabled` is set by the activation hook; `snapshot.historyId`
 *     is the cursor advanced after each poll.
 *
 * The schema is the runtime validator AT the polling boundary — when the
 * orchestrator reads a trigger_resources row, it parses `config` through
 * this schema before passing to the poll handler. A malformed row throws
 * and the cron records an error for that trigger; the rest of the batch
 * proceeds.
 */

export const HasAttachmentSchema = z.enum(["any", "yes", "no"]).default("any");
export type HasAttachmentMode = z.infer<typeof HasAttachmentSchema>;

export const GmailNewEmailConfigSchema = z.object({
  /**
   * Sender filter — array of email addresses (case-insensitive, OR-match).
   * Empty array means "any sender".
   */
  from: z.array(z.string().min(1)).default([]),
  /** Subject filter — substring or exact match (see `subjectExactMatch`). */
  subject: z.string().default(""),
  /** When true, `subject` must equal the email's subject; else substring match. */
  subjectExactMatch: z.boolean().default(true),
  /** Attachment filter — heuristic via top-level mimeType. See filters.ts. */
  hasAttachment: HasAttachmentSchema,
  /**
   * Label filter — array of Gmail label ids; AND-match (the email must
   * carry at least one of these labels). Defaults to ["INBOX"].
   */
  labelIds: z.array(z.string().min(1)).default(["INBOX"]),

  // Polling-state fields (set by activation hook + advanced by poll loop)
  pollingEnabled: z.boolean().default(false),
  snapshot: z
    .object({
      historyId: z.string().min(1),
      capturedAt: z.string().min(1),
    })
    .optional(),
  polling: z
    .object({
      lastPolledAt: z.string().min(1),
    })
    .optional(),
});
export type GmailNewEmailConfig = z.infer<typeof GmailNewEmailConfigSchema>;
