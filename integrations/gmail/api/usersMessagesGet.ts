import { Unauthorized401Error } from "@/services/oauth/refreshAndRetry";

/**
 * Wrapper for Gmail's `users.messages.get`.
 *
 * Slice 2e: hydrates a message id discovered via `users.history.list`.
 * Format = `metadata` (Slice 2 decision) — returns headers, labelIds,
 * snippet, internalDate, sizeEstimate, mimeType but NOT the body.
 *
 * Tradeoffs we're accepting:
 *   - The TriggerEvent payload omits the email body. Workflows that need
 *     body-based logic must add a future GetEmail action node.
 *   - `payload.parts` is not in metadata responses, so V1's exact
 *     attachment-detection (walks payload.parts looking for filenames) is
 *     not reproducible. We approximate via the top-level `payload.mimeType`:
 *     `multipart/mixed` ≈ has attachment; everything else ≈ no attachment.
 *     This is documented as a heuristic in filters.ts.
 *
 * Endpoint: GET {GMAIL_API_BASE}/gmail/v1/users/me/messages/{id}?format=metadata
 */

function gmailApiBase(): string {
  return process.env.GMAIL_API_BASE ?? "https://gmail.googleapis.com";
}

export interface UsersMessagesGetInput {
  /** Decrypted access token; supplied by `refreshAndRetry`. */
  accessToken: string;
  /** Gmail message id (from history.list). */
  messageId: string;
  /**
   * Header names to extract. Gmail honors this when format=metadata.
   * Slice 2e default covers the headers needed for filters + payload.
   */
  metadataHeaders?: readonly string[];
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface UsersMessagesGetResult {
  id: string;
  threadId: string;
  labelIds: readonly string[];
  snippet: string;
  /** Milliseconds since epoch as a string (Gmail's wire format). */
  internalDate: string;
  sizeEstimate: number;
  payload: {
    mimeType: string;
    headers: readonly GmailHeader[];
  };
}

const DEFAULT_METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Bcc",
  "Subject",
  "Date",
  "Delivered-To",
  "Message-ID",
] as const;

interface GmailErrorPayload {
  error?: { code?: number; message?: string; status?: string };
}

export async function usersMessagesGet(
  input: UsersMessagesGetInput,
): Promise<UsersMessagesGetResult> {
  const headers = input.metadataHeaders ?? DEFAULT_METADATA_HEADERS;
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of headers) {
    params.append("metadataHeaders", h);
  }

  const res = await fetch(
    `${gmailApiBase()}/gmail/v1/users/me/messages/${encodeURIComponent(
      input.messageId,
    )}?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.accessToken}` },
    },
  );

  if (res.status === 401) {
    throw new Unauthorized401Error(
      "Gmail users.messages.get returned HTTP 401",
    );
  }

  if (!res.ok) {
    const text = await res.text();
    let detail = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as GmailErrorPayload;
      if (parsed?.error?.message) detail = parsed.error.message;
      else if (parsed?.error?.status) detail = parsed.error.status;
    } catch {
      // not JSON
    }
    throw new Error(`Gmail messages.get failed: ${detail}`);
  }

  return (await res.json()) as UsersMessagesGetResult;
}
