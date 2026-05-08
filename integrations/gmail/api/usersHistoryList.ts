import { Unauthorized401Error } from "@/services/oauth/refreshAndRetry";

/**
 * Wrapper for Gmail's `users.history.list`.
 *
 * Slice 2e: walks Gmail's incremental change feed since `startHistoryId`.
 * Returns the new message ids the trigger should hydrate.
 *
 * V1 parity:
 *   - `historyTypes` includes `messageAdded` AND `labelAdded` (V1
 *     gmail-processor.ts:842 — caught label-only changes that look like
 *     "the message arrived" from the user's perspective when a label was
 *     applied post-receipt).
 *   - No `labelId` parameter — V1 also omitted it. Multi-label filtering
 *     happens client-side in filters.ts so an array of labelIds works
 *     without provider-side cardinality issues.
 *
 * Stale-cursor signal: Gmail returns HTTP 404 (or 410 in older docs) when
 * `startHistoryId` has aged past the ~7-day retention window. The Slice
 * 2e poll orchestrator catches `HistoryListStaleCursorError` and
 * re-snapshots via `usersGetProfile`.
 *
 * Endpoint: GET {GMAIL_API_BASE}/gmail/v1/users/me/history
 */

function gmailApiBase(): string {
  return process.env.GMAIL_API_BASE ?? "https://gmail.googleapis.com";
}

export interface UsersHistoryListInput {
  /** Decrypted access token; supplied by `refreshAndRetry`. */
  accessToken: string;
  /** Last seen historyId (BigInt-as-string). Gmail returns changes after this. */
  startHistoryId: string;
  /** Optional pagination token from a prior page. */
  pageToken?: string;
  /** Optional maxResults — Gmail caps at 500; default 100. */
  maxResults?: number;
}

export interface GmailHistoryRecord {
  id: string;
  messages?: Array<{ id: string; threadId: string }>;
  messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
  labelsAdded?: Array<{
    message: { id: string; threadId: string };
    labelIds: string[];
  }>;
}

export interface UsersHistoryListResult {
  /** Each entry in change-order. */
  history: readonly GmailHistoryRecord[];
  /** Next page if Gmail returned `nextPageToken`. */
  nextPageToken?: string;
  /** Latest historyId from the API response (caller advances the cursor). */
  historyId: string;
}

/**
 * Thrown when Gmail says the cursor is too old to walk from. Caught by
 * poll.ts → re-snapshots via getProfile.
 */
export class HistoryListStaleCursorError extends Error {
  constructor(message?: string) {
    super(message ?? "Gmail history.list rejected startHistoryId as stale.");
    this.name = "HistoryListStaleCursorError";
  }
}

interface GmailErrorPayload {
  error?: { code?: number; message?: string; status?: string };
}

export async function usersHistoryList(
  input: UsersHistoryListInput,
): Promise<UsersHistoryListResult> {
  const params = new URLSearchParams({
    startHistoryId: input.startHistoryId,
    maxResults: String(input.maxResults ?? 100),
  });
  // Gmail's API accepts repeated `historyTypes` query params.
  params.append("historyTypes", "messageAdded");
  params.append("historyTypes", "labelAdded");
  if (input.pageToken) params.set("pageToken", input.pageToken);

  const res = await fetch(
    `${gmailApiBase()}/gmail/v1/users/me/history?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.accessToken}` },
    },
  );

  if (res.status === 401) {
    throw new Unauthorized401Error(
      "Gmail users.history.list returned HTTP 401",
    );
  }

  // Gmail returns 404 with `error.code === 404` or status text "Not Found"
  // when startHistoryId is too old. 410 is documented in older API docs;
  // catch both.
  if (res.status === 404 || res.status === 410) {
    throw new HistoryListStaleCursorError(
      `Gmail users.history.list returned HTTP ${res.status} (stale startHistoryId).`,
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
    throw new Error(`Gmail history.list failed: ${detail}`);
  }

  const json = (await res.json()) as {
    history?: GmailHistoryRecord[];
    nextPageToken?: string;
    historyId?: string;
  };

  return {
    history: json.history ?? [],
    nextPageToken: json.nextPageToken,
    historyId: json.historyId ?? input.startHistoryId,
  };
}
