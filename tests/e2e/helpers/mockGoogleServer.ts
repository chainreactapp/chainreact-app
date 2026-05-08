import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { Buffer } from "node:buffer";

/**
 * Standalone mock Google server for the Slice 2f Gmail e2e walkthrough.
 *
 * Routes (sized to V2's actual call patterns — nothing more):
 *   GET  /o/oauth2/v2/auth                       → 302 to V2's
 *                                                  /api/integrations/oauth/gmail/callback
 *                                                  with the preserved state +
 *                                                  a synthetic code.
 *   POST /token                                  → canned token-exchange
 *                                                  response with a recognizable
 *                                                  access + refresh token.
 *   GET  /gmail/v1/users/me/profile              → emailAddress + currentHistoryId.
 *                                                  Used by Slice 2c's OAuth
 *                                                  callback for accountId AND
 *                                                  by Slice 2e's activation
 *                                                  hook for the snapshot.
 *   GET  /gmail/v1/users/me/history              → history.list, returns one
 *                                                  messageAdded entry per email
 *                                                  injected since startHistoryId.
 *   GET  /gmail/v1/users/me/messages/{id}        → format=metadata response for
 *                                                  the injected email by id.
 *   POST /gmail/v1/users/me/messages/send        → records the base64url raw
 *                                                  body decoded into headers +
 *                                                  body parts; returns a fake
 *                                                  send id.
 *
 * Control plane (test-only):
 *   POST /__injectEmail   — inject an email into the mock store and bump
 *                           historyId; the next history.list returns it.
 *   POST /__replayLastEmail — re-queue the most recently injected email
 *                           WITHOUT bumping historyId. Used by the dedup
 *                           probe so the spec proves the same Gmail message
 *                           id seen twice does not produce two runs.
 *   POST /__reset         — clear calls + email store + reset historyId.
 *   GET  /__inspect       — dump calls + store state; cross-process seam.
 *
 * Listens on a fixed port (default 9877, override via GMAIL_MOCK_PORT).
 * Different port from Slack (9876) so both can run simultaneously under
 * the same global-setup. If the port is busy, fail loud at start.
 *
 * Stateful: tracks an in-memory `currentHistoryId` (BigInt) and a queue
 * of `pendingHistoryEntries` so the spec controls exactly which messages
 * surface on each history.list call. The `replayLastEmail` knob exists
 * specifically for the dedup test — re-queues an entry without bumping
 * the cursor, exactly like a stored-historyId-rewound scenario.
 */

const SEED_HISTORY_ID = "100000";

export interface RecordedAuthorize {
  state: string;
  scope: string;
  codeChallenge: string | null;
}

export interface RecordedTokenExchange {
  body: string;
  parsedBody: Record<string, string>;
}

export interface RecordedProfile {
  authorization: string | undefined;
  responseHistoryId: string;
}

export interface RecordedHistoryList {
  authorization: string | undefined;
  url: string;
  startHistoryId: string;
  pageToken: string | null;
  historyTypes: string[];
  responseEntries: number;
}

export interface RecordedMessagesGet {
  authorization: string | undefined;
  url: string;
  messageId: string;
  format: string;
}

export interface RecordedMessagesSend {
  authorization: string | undefined;
  raw: string;
  decoded: string;
  parsed: ParsedRfc5322;
}

/**
 * Minimal RFC 5322 parse — splits headers / body on the first blank line,
 * extracts header name/value pairs case-insensitively, and pulls the
 * primary mimeType. For multipart/alternative we also bucket parts by
 * Content-Type so the spec can grep the plain-text leaf.
 */
export interface ParsedRfc5322 {
  headers: Record<string, string>;
  mimeType: string;
  partsByMimeType: Record<string, string>;
}

export interface InjectedEmail {
  id: string;
  threadId: string;
  labelIds: readonly string[];
  snippet: string;
  internalDate: string;
  sizeEstimate: number;
  mimeType: string;
  headers: Array<{ name: string; value: string }>;
  /** historyId that was current when the email was injected. */
  historyIdAtInsert: string;
}

export interface MockGoogleHandle {
  port: number;
  baseUrl: string;
  /** Cumulative call records since last reset. */
  calls: {
    authorize: RecordedAuthorize[];
    tokenExchange: RecordedTokenExchange[];
    profile: RecordedProfile[];
    historyList: RecordedHistoryList[];
    messagesGet: RecordedMessagesGet[];
    send: RecordedMessagesSend[];
  };
  /** Map of injected emails by id. */
  emails: Map<string, InjectedEmail>;
  /**
   * historyId entries pending delivery on the next history.list call.
   * Each entry pairs a message id with the historyId it was added at.
   * `replayLastEmail` re-pushes the most recent pending without bumping.
   */
  pendingHistoryEntries: Array<{ historyId: string; messageId: string }>;
  /** Current historyId — returned by getProfile + history.list. */
  currentHistoryId: string;
  /** Most recently injected message id (for replay). */
  lastInjectedMessageId: string | null;
  reset(): void;
  stop(): Promise<void>;
}

const DEFAULT_PORT = Number(process.env.GMAIL_MOCK_PORT ?? "9877");

export async function startMockGoogleServer(opts: {
  appBaseUrl: string;
  port?: number;
}): Promise<MockGoogleHandle> {
  const port = opts.port ?? DEFAULT_PORT;

  const state: Pick<
    MockGoogleHandle,
    "calls" | "emails" | "pendingHistoryEntries" | "currentHistoryId" | "lastInjectedMessageId"
  > = freshState();

  const server: Server = createServer((req, res) => {
    handleRequest(req, res, opts.appBaseUrl, state).catch((err) => {
      console.error("[mock-google] handler crashed", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("mock-google handler crashed");
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    get calls() {
      return state.calls;
    },
    get emails() {
      return state.emails;
    },
    get pendingHistoryEntries() {
      return state.pendingHistoryEntries;
    },
    get currentHistoryId() {
      return state.currentHistoryId;
    },
    get lastInjectedMessageId() {
      return state.lastInjectedMessageId;
    },
    reset: () => Object.assign(state, freshState()),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function freshState(): Pick<
  MockGoogleHandle,
  "calls" | "emails" | "pendingHistoryEntries" | "currentHistoryId" | "lastInjectedMessageId"
> {
  return {
    calls: {
      authorize: [],
      tokenExchange: [],
      profile: [],
      historyList: [],
      messagesGet: [],
      send: [],
    },
    emails: new Map(),
    pendingHistoryEntries: [],
    currentHistoryId: SEED_HISTORY_ID,
    lastInjectedMessageId: null,
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  appBaseUrl: string,
  state: Pick<
    MockGoogleHandle,
    "calls" | "emails" | "pendingHistoryEntries" | "currentHistoryId" | "lastInjectedMessageId"
  >,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://placeholder");

  // ── Authorize ──
  if (req.method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
    const stateParam = url.searchParams.get("state");
    const scope = url.searchParams.get("scope") ?? "";
    const codeChallenge = url.searchParams.get("code_challenge");
    if (!stateParam) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("missing state");
      return;
    }
    state.calls.authorize.push({ state: stateParam, scope, codeChallenge });
    const callback = new URL(
      "/api/integrations/oauth/gmail/callback",
      appBaseUrl,
    );
    callback.searchParams.set("code", `mock-google-code-${Date.now()}`);
    callback.searchParams.set("state", stateParam);
    res.writeHead(302, { location: callback.toString() });
    res.end();
    return;
  }

  // ── Token exchange ──
  if (req.method === "POST" && url.pathname === "/token") {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const parsed: Record<string, string> = {};
    for (const [k, v] of params.entries()) parsed[k] = v;
    state.calls.tokenExchange.push({ body, parsedBody: parsed });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        access_token: "ya29.mock-e2e-access",
        refresh_token: "1//mock-e2e-refresh",
        expires_in: 3600,
        scope:
          "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
        token_type: "Bearer",
      }),
    );
    return;
  }

  // ── users.getProfile ──
  if (
    req.method === "GET" &&
    url.pathname === "/gmail/v1/users/me/profile"
  ) {
    state.calls.profile.push({
      authorization: req.headers.authorization,
      responseHistoryId: state.currentHistoryId,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        emailAddress: "alice@e2e.test",
        messagesTotal: state.emails.size,
        threadsTotal: state.emails.size,
        historyId: state.currentHistoryId,
      }),
    );
    return;
  }

  // ── users.history.list ──
  if (
    req.method === "GET" &&
    url.pathname === "/gmail/v1/users/me/history"
  ) {
    const startHistoryId = url.searchParams.get("startHistoryId") ?? "0";
    const pageToken = url.searchParams.get("pageToken");
    const historyTypes = url.searchParams.getAll("historyTypes");
    const startBig = safeBigInt(startHistoryId);

    // Drain pending entries whose historyId is > startHistoryId. The
    // dedup probe re-queues an entry at its original historyId, so we
    // include entries with historyId >= startHistoryId when the
    // requested cursor matches the entry's historyId exactly — this
    // simulates "stored cursor was rewound and we walk forward again".
    const out: Array<{ id: string; messagesAdded: Array<{ message: { id: string; threadId: string } }> }> = [];
    const remaining: typeof state.pendingHistoryEntries = [];
    for (const entry of state.pendingHistoryEntries) {
      const entryBig = safeBigInt(entry.historyId);
      if (startBig === null || entryBig === null) {
        remaining.push(entry);
        continue;
      }
      // > startHistoryId is the normal case (new message arrived since the
      // stored cursor). === also delivers — handles dedup probe / rewind.
      if (entryBig >= startBig) {
        const email = state.emails.get(entry.messageId);
        if (email) {
          out.push({
            id: entry.historyId,
            messagesAdded: [
              { message: { id: email.id, threadId: email.threadId } },
            ],
          });
        }
        // Once delivered, remove from pending — the spec re-queues
        // explicitly via /__replayLastEmail when it wants a replay.
        continue;
      }
      remaining.push(entry);
    }
    state.pendingHistoryEntries = remaining;

    state.calls.historyList.push({
      authorization: req.headers.authorization,
      url: req.url ?? "",
      startHistoryId,
      pageToken,
      historyTypes,
      responseEntries: out.length,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        history: out,
        historyId: state.currentHistoryId,
      }),
    );
    return;
  }

  // ── users.messages.get ──
  if (
    req.method === "GET" &&
    url.pathname.startsWith("/gmail/v1/users/me/messages/")
  ) {
    const messageId = decodeURIComponent(
      url.pathname.replace("/gmail/v1/users/me/messages/", ""),
    );
    const format = url.searchParams.get("format") ?? "";
    state.calls.messagesGet.push({
      authorization: req.headers.authorization,
      url: req.url ?? "",
      messageId,
      format,
    });
    const email = state.emails.get(messageId);
    if (!email) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: 404, message: "Not Found" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: email.id,
        threadId: email.threadId,
        labelIds: email.labelIds,
        snippet: email.snippet,
        internalDate: email.internalDate,
        sizeEstimate: email.sizeEstimate,
        payload: {
          mimeType: email.mimeType,
          headers: email.headers,
        },
      }),
    );
    return;
  }

  // ── users.messages.send ──
  if (
    req.method === "POST" &&
    url.pathname === "/gmail/v1/users/me/messages/send"
  ) {
    const body = await readBody(req);
    let raw = "";
    try {
      const parsed = JSON.parse(body) as { raw?: string };
      raw = parsed.raw ?? "";
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("malformed json");
      return;
    }
    const decoded = base64UrlDecodeToString(raw);
    const parsedMessage = parseRfc5322(decoded);
    state.calls.send.push({
      authorization: req.headers.authorization,
      raw,
      decoded,
      parsed: parsedMessage,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: `sent-${Date.now()}`,
        threadId: "sent-thr",
        labelIds: ["SENT"],
      }),
    );
    return;
  }

  // ── Control plane ──

  if (req.method === "POST" && url.pathname === "/__injectEmail") {
    const body = await readBody(req);
    let payload: {
      id: string;
      headers: Record<string, string>;
      mimeType?: string;
      snippet?: string;
    };
    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("malformed json");
      return;
    }
    if (!payload.id || !payload.headers) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("missing id or headers");
      return;
    }
    // Bump historyId by 1 to simulate "a new message arrived".
    const nextId = (safeBigInt(state.currentHistoryId) ?? 0n) + 1n;
    state.currentHistoryId = nextId.toString();
    const email: InjectedEmail = {
      id: payload.id,
      threadId: `thr-${payload.id}`,
      labelIds: ["INBOX", "UNREAD"],
      snippet: payload.snippet ?? "",
      internalDate: String(Date.now()),
      sizeEstimate: 1024,
      mimeType: payload.mimeType ?? "multipart/alternative",
      headers: Object.entries(payload.headers).map(([name, value]) => ({
        name,
        value,
      })),
      historyIdAtInsert: state.currentHistoryId,
    };
    state.emails.set(email.id, email);
    state.pendingHistoryEntries.push({
      historyId: state.currentHistoryId,
      messageId: email.id,
    });
    state.lastInjectedMessageId = email.id;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        currentHistoryId: state.currentHistoryId,
        messageId: email.id,
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/__replayLastEmail") {
    if (!state.lastInjectedMessageId) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("no email to replay");
      return;
    }
    const email = state.emails.get(state.lastInjectedMessageId);
    if (!email) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("last injected email not found in store");
      return;
    }
    // Re-queue at the original historyId — does NOT bump currentHistoryId.
    // This simulates "the stored cursor was rolled back; the same message
    // surfaces in history.list again". Dedup must catch it via
    // webhook_event_dedup keyed on the gmail message id.
    state.pendingHistoryEntries.push({
      historyId: email.historyIdAtInsert,
      messageId: email.id,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, replayedMessageId: email.id }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/__reset") {
    Object.assign(state, freshState());
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/__inspect") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        calls: state.calls,
        currentHistoryId: state.currentHistoryId,
        emailCount: state.emails.size,
        pendingHistoryEntries: state.pendingHistoryEntries,
        lastInjectedMessageId: state.lastInjectedMessageId,
      }),
    );
    return;
  }

  // Anything else is unexpected — fail loud so the test surfaces it.
  res.writeHead(404, { "content-type": "text/plain" });
  res.end(`mock-google: no route for ${req.method} ${url.pathname}`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeBigInt(v: string): bigint | null {
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

function base64UrlDecodeToString(s: string): string {
  // base64url → base64. Length-pad with '=' so Buffer.from accepts it.
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const padLen = pad === 0 ? 0 : 4 - pad;
  return Buffer.from(padded + "=".repeat(padLen), "base64").toString("utf8");
}

function parseRfc5322(text: string): ParsedRfc5322 {
  // Split headers / body on the first blank line. RFC says CRLF; tolerate
  // bare LF too (some senders emit that, including our own send action).
  const headerEnd = text.search(/\r?\n\r?\n/);
  const headerBlock = headerEnd >= 0 ? text.slice(0, headerEnd) : text;
  const bodyBlock = headerEnd >= 0 ? text.slice(headerEnd).replace(/^\r?\n\r?\n/, "") : "";

  const headers = parseHeaders(headerBlock);
  const mimeType = (headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  const partsByMimeType: Record<string, string> = {};

  // Multipart parsing — extract boundary and split. We don't need a full
  // RFC-compliant parser; the spec only asserts the plain-text leaf is
  // present. For multipart/alternative the structure is:
  //   --boundary
  //   Content-Type: text/plain; charset=...
  //   <blank line>
  //   <body>
  //   --boundary
  //   Content-Type: text/html; charset=...
  //   <blank line>
  //   <body>
  //   --boundary--
  if (mimeType.startsWith("multipart/")) {
    const ctRaw = headers["content-type"] ?? "";
    const m = ctRaw.match(/boundary="?([^";]+)"?/i);
    if (m) {
      const boundary = `--${m[1]}`;
      const segments = bodyBlock.split(boundary);
      for (const seg of segments) {
        const trimmed = seg.replace(/^\r?\n/, "").replace(/\r?\n--\s*$/, "");
        if (!trimmed.trim() || trimmed.startsWith("--")) continue;
        const partHeaderEnd = trimmed.search(/\r?\n\r?\n/);
        if (partHeaderEnd < 0) continue;
        const partHeaders = parseHeaders(trimmed.slice(0, partHeaderEnd));
        const partBody = trimmed.slice(partHeaderEnd).replace(/^\r?\n\r?\n/, "");
        const partMime = (partHeaders["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        if (partMime) {
          // Strip trailing CRLF that's part of the multipart boundary
          // delimiter rather than the body itself.
          partsByMimeType[partMime] = partBody.replace(/\r?\n$/, "");
        }
      }
    }
  } else if (mimeType) {
    partsByMimeType[mimeType] = bodyBlock;
  }

  return { headers, mimeType, partsByMimeType };
}

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Unfold continuation lines (RFC 5322 §2.2.3): a line beginning with
  // whitespace is part of the previous header.
  const unfolded = block.replace(/\r?\n[\t ]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    out[name] = value;
  }
  return out;
}
