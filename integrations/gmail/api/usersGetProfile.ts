import { Unauthorized401Error } from "@/services/oauth/refreshAndRetry";

/**
 * Wrapper for Gmail's `users.getProfile`.
 *
 * Slice 2e: this is the canonical "fetch the current historyId" call. The
 * activation hook calls it once at trigger registration so the polling
 * baseline is set BEFORE any poll runs (V1 CLAUDE.md "first poll miss"
 * rule). It's also the recovery path when `users.history.list` returns
 * 404 due to a 7-day-stale cursor — re-snapshot via this call, log the
 * gap, continue from the new cursor.
 *
 * Endpoint: GET {GMAIL_API_BASE}/gmail/v1/users/me/profile
 * Required scope: gmail.readonly (already in the manifest).
 *
 * Returns historyId as a string — the API delivers it that way and the
 * BigInt comparison in historyState.ts wants a string anyway.
 */

function gmailApiBase(): string {
  return process.env.GMAIL_API_BASE ?? "https://gmail.googleapis.com";
}

export interface UsersGetProfileInput {
  /** Decrypted access token; supplied by `refreshAndRetry`. */
  accessToken: string;
}

export interface UsersGetProfileResult {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

interface GmailErrorPayload {
  error?: { code?: number; message?: string; status?: string };
}

export async function usersGetProfile(
  input: UsersGetProfileInput,
): Promise<UsersGetProfileResult> {
  const res = await fetch(
    `${gmailApiBase()}/gmail/v1/users/me/profile`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.accessToken}` },
    },
  );

  if (res.status === 401) {
    throw new Unauthorized401Error(
      "Gmail users.getProfile returned HTTP 401",
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
      // not JSON — keep HTTP status
    }
    throw new Error(`Gmail getProfile failed: ${detail}`);
  }

  return (await res.json()) as UsersGetProfileResult;
}
