import { z } from "zod";

/**
 * Resolved-config schema for the Gmail send_email action.
 *
 * The engine pre-resolves all `{{...}}` references via the variable
 * resolver before dispatching the handler, so by the time this schema
 * runs every value is already a concrete string.
 *
 * Body fields (Slice 2d Decision 2d-1, Option C):
 *   - `textBody` only → handler sends `text/plain`.
 *   - `htmlBody` only → handler sends `text/html`.
 *   - both         → handler sends `multipart/alternative` with
 *                    text/plain first and text/html second.
 *   - At least one MUST be present and non-empty (refine guard below).
 *
 * Recipients (Decision 2d-3, Option A):
 *   - `to` is a single string. CSV-style multi-recipient input
 *     (`"alice@x.com, bob@x.com"`) is preserved verbatim into the RFC
 *     5322 `To:` line. No parsing in this slice.
 *   - `cc` and `bcc` follow the same convention; both are optional.
 */
export const SendEmailConfigSchema = z
  .object({
    to: z.string().min(1, "Recipient is required."),
    subject: z.string(), // may be empty per Slice 2d additional decision
    textBody: z.string().optional(),
    htmlBody: z.string().optional(),
    cc: z.string().optional(),
    bcc: z.string().optional(),
  })
  .strict()
  .refine(
    (val) => Boolean(val.textBody) || Boolean(val.htmlBody),
    { message: "At least one of textBody or htmlBody must be provided." },
  );

export type SendEmailConfig = z.infer<typeof SendEmailConfigSchema>;
