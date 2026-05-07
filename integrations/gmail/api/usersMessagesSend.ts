import { Unauthorized401Error } from "@/services/oauth/refreshAndRetry";

/**
 * Wrapper for Gmail's `users.messages.send`.
 *
 * Per docs/rules/oauth-dispatcher.md §"Allowed flows" — handler-level API
 * helpers throw `Unauthorized401Error` on HTTP 401 so the
 * `refreshAndRetry` wrapper can detect and trigger one refresh + retry
 * cycle. Other HTTP errors propagate verbatim with Google's error code
 * surfaced when available.
 *
 * Endpoint: POST {GMAIL_API_BASE}/gmail/v1/users/me/messages/send
 * Body:     application/json — `{ raw: <base64url-encoded RFC 5322> }`
 */

function gmailApiBase(): string {
  return process.env.GMAIL_API_BASE ?? "https://gmail.googleapis.com";
}

export interface UsersMessagesSendInput {
  /** Decrypted access token; supplied by `refreshAndRetry`. */
  accessToken: string;
  /**
   * Base64url-encoded RFC 5322 message. Build via
   * `buildRfc5322Message` + `encodeBase64Url` from `../utils/rfc5322.ts`.
   */
  rawMessage: string;
}

export interface UsersMessagesSendResult {
  id: string;
  threadId: string;
  labelIds?: readonly string[];
}

interface GmailErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export async function usersMessagesSend(
  input: UsersMessagesSendInput,
): Promise<UsersMessagesSendResult> {
  const res = await fetch(
    `${gmailApiBase()}/gmail/v1/users/me/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: input.rawMessage }),
    },
  );

  if (res.status === 401) {
    // refreshAndRetry catches this, refreshes the token via
    // dispatcher.refresh, refetches the row, and retries this call once.
    throw new Unauthorized401Error(
      "Gmail users.messages.send returned HTTP 401",
    );
  }

  if (!res.ok) {
    const text = await res.text();
    let detail = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as GmailErrorPayload;
      if (parsed?.error?.message) {
        detail = parsed.error.message;
      } else if (parsed?.error?.status) {
        detail = parsed.error.status;
      }
    } catch {
      // not JSON — keep HTTP status
    }
    throw new Error(`Gmail send failed: ${detail}`);
  }

  return (await res.json()) as UsersMessagesSendResult;
}
