import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

/**
 * Standalone mock Slack server for the Slice 1 e2e walkthrough.
 *
 * Routes (all are sized to V2's actual call patterns — nothing more):
 *   GET  /oauth/v2/authorize   → 302 redirect to V2's callback with the
 *                                preserved state and a synthetic code.
 *                                Replaces the real Slack consent screen so
 *                                Playwright never has to drive a slack.com
 *                                page (which would 1. require credentials
 *                                and 2. fight Slack's CSP/WAF).
 *   POST /api/oauth.v2.access  → returns a canned token-exchange response
 *                                with a recognizable bot token.
 *   POST /api/chat.postMessage → returns a canned success response and
 *                                records the request body for assertions.
 *
 * Listens on a fixed port (default 9876, override via env). Fixed port keeps
 * the env vars Playwright passes to the dev server static across the run —
 * no inter-process URL discovery dance. If the port is in use, fail loud at
 * start so the test runner reports it cleanly.
 */

export interface RecordedTokenExchange {
  body: string;
  parsedBody: Record<string, string>;
}

export interface RecordedChatPostMessage {
  authorization: string | undefined;
  body: { channel: string; text: string };
}

export interface MockSlackHandle {
  port: number;
  baseUrl: string;
  /** All calls observed by the mock server. Reset via reset(). */
  calls: {
    authorize: number;
    tokenExchange: RecordedTokenExchange[];
    chatPostMessage: RecordedChatPostMessage[];
  };
  reset(): void;
  stop(): Promise<void>;
}

const DEFAULT_PORT = Number(process.env.SLACK_MOCK_PORT ?? "9876");

/**
 * Start the mock server. The base URL of V2 (where the OAuth callback
 * redirects land) comes from the appBaseUrl param so the mock has zero
 * coupling to V2's host config.
 */
export async function startMockSlackServer(opts: {
  appBaseUrl: string;
  port?: number;
}): Promise<MockSlackHandle> {
  const port = opts.port ?? DEFAULT_PORT;
  const calls: MockSlackHandle["calls"] = {
    authorize: 0,
    tokenExchange: [],
    chatPostMessage: [],
  };

  const server: Server = createServer((req, res) => {
    handleRequest(req, res, opts.appBaseUrl, calls).catch((err) => {
      console.error("[mock-slack] handler crashed", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("mock-slack handler crashed");
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
    calls,
    reset: () => {
      calls.authorize = 0;
      calls.tokenExchange.length = 0;
      calls.chatPostMessage.length = 0;
    },
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  appBaseUrl: string,
  calls: MockSlackHandle["calls"],
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://placeholder");

  if (req.method === "GET" && url.pathname === "/oauth/v2/authorize") {
    calls.authorize += 1;
    const state = url.searchParams.get("state");
    if (!state) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("missing state");
      return;
    }
    const callback = new URL(
      "/api/integrations/oauth/slack/callback",
      appBaseUrl,
    );
    callback.searchParams.set("code", `mock-code-${Date.now()}`);
    callback.searchParams.set("state", state);
    res.writeHead(302, { location: callback.toString() });
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/oauth.v2.access") {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const parsed: Record<string, string> = {};
    for (const [k, v] of params.entries()) parsed[k] = v;
    calls.tokenExchange.push({ body, parsedBody: parsed });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        access_token: "xoxb-mock-bot-token-e2e",
        scope: "channels:history,channels:read,chat:write,users:read",
        team: { id: "T-MOCK-TEAM", name: "Mock Workspace" },
        bot_user_id: "U-MOCK-BOT",
        app_id: "A-MOCK-APP",
        authed_user: { id: "U-MOCK-USER" },
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/__inspect") {
    // Inspect endpoint for cross-process spec assertions. Playwright workers
    // run in separate processes from globalSetup, so the in-memory `calls`
    // object isn't reachable directly — fetching this endpoint is the seam.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(calls));
    return;
  }

  if (req.method === "POST" && url.pathname === "/__reset") {
    // Spec-driven reset between phases of the same test (rare; included for
    // completeness so a spec that's about to assert "exactly N" can ensure
    // the counter started at 0).
    calls.authorize = 0;
    calls.tokenExchange.length = 0;
    calls.chatPostMessage.length = 0;
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat.postMessage") {
    const body = await readBody(req);
    let parsedBody: { channel: string; text: string };
    try {
      parsedBody = JSON.parse(body) as { channel: string; text: string };
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("malformed json");
      return;
    }
    calls.chatPostMessage.push({
      authorization: req.headers.authorization,
      body: parsedBody,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        ts: `${Date.now() / 1000}`,
        channel: parsedBody.channel,
        message: { text: parsedBody.text, user: "U-MOCK-BOT" },
      }),
    );
    return;
  }

  // Anything else is unexpected — fail loud so the test surfaces it.
  res.writeHead(404, { "content-type": "text/plain" });
  res.end(`mock-slack: no route for ${req.method} ${url.pathname}`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
