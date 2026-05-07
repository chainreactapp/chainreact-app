import { randomBytes } from "node:crypto";

/**
 * RFC 5322 message builder for Gmail's users.messages.send API.
 *
 * Produces a plain RFC 5322 message string with CRLF line endings. The
 * caller is responsible for base64url-encoding the result via
 * `encodeBase64Url` and passing it to the Gmail API as the `raw` field.
 *
 * Body modes (per Slice 2d Decision 2d-1 Option C):
 *   - text only → `Content-Type: text/plain; charset="UTF-8"`
 *   - html only → `Content-Type: text/html;  charset="UTF-8"`
 *   - both      → `Content-Type: multipart/alternative; boundary="..."` with
 *                 the text part first (per RFC 2046 §5.1.4: parts in
 *                 increasing order of preference; text/plain is fallback,
 *                 text/html is preferred — order plain → html so that
 *                 receiving clients pick html when they support it).
 *
 * Subject encoding (Decision 2d-2 Option B):
 *   - ASCII-only subjects pass through verbatim.
 *   - Non-ASCII subjects (emoji, accented chars) are RFC 2047 base64-
 *     encoded as `=?UTF-8?B?<base64>?=` so the header stays 7-bit.
 *
 * From header is intentionally OMITTED — Gmail fills it server-side from
 * the authenticated account. Including it would require a separate
 * users.getProfile call or user-supplied from-address; server-side fill
 * is the right call for this slice.
 */

export interface BuildRfc5322Input {
  to: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  cc?: string;
  bcc?: string;
  /**
   * Override boundary for tests. Production callers omit and the builder
   * generates a fresh random boundary.
   */
  boundary?: string;
}

const CRLF = "\r\n";

/**
 * Generate a MIME boundary string. RFC 2046 §5.1.1 allows up to 70
 * boundary chars from a fixed set; we use a long random hex string with
 * a chainreact-specific prefix to make collisions with body content
 * astronomically unlikely AND grep-friendly when debugging captured
 * messages.
 */
function generateBoundary(): string {
  return `----=_chainreact_${randomBytes(16).toString("hex")}`;
}

function isAscii(s: string): boolean {
  // Printable ASCII range 0x20-0x7E plus tab is fine in a header value.
  // Anything outside that needs RFC 2047 encoding for header safety.
  return !/[^\x20-\x7E\t]/.test(s);
}

/**
 * RFC 2047 base64-encode a header value when it contains non-ASCII.
 * Returns the value unchanged when ASCII-only.
 */
export function encodeRfc2047HeaderValue(value: string): string {
  if (isAscii(value)) return value;
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

export function buildRfc5322Message(input: BuildRfc5322Input): string {
  const hasText = input.textBody !== undefined && input.textBody.length > 0;
  const hasHtml = input.htmlBody !== undefined && input.htmlBody.length > 0;
  if (!hasText && !hasHtml) {
    throw new Error(
      "buildRfc5322Message: at least one of textBody or htmlBody must be provided.",
    );
  }

  const headers: string[] = [];
  headers.push(`To: ${input.to}`);
  if (input.cc !== undefined && input.cc.length > 0) {
    headers.push(`Cc: ${input.cc}`);
  }
  if (input.bcc !== undefined && input.bcc.length > 0) {
    headers.push(`Bcc: ${input.bcc}`);
  }
  headers.push(`Subject: ${encodeRfc2047HeaderValue(input.subject)}`);
  headers.push("MIME-Version: 1.0");

  if (hasText && hasHtml) {
    const boundary = input.boundary ?? generateBoundary();
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    return [
      ...headers,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.textBody!,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.htmlBody!,
      `--${boundary}--`,
    ].join(CRLF);
  }

  if (hasText) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: 8bit");
    return [...headers, "", input.textBody!].join(CRLF);
  }

  // hasHtml only
  headers.push('Content-Type: text/html; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: 8bit");
  return [...headers, "", input.htmlBody!].join(CRLF);
}

/**
 * Base64url-encode a UTF-8 string. URL-safe alphabet (`-` `_`), no
 * padding — the format Gmail's `users.messages.send` expects for its
 * `raw` field.
 */
export function encodeBase64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}
