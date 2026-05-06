import { createHmac, timingSafeEqual } from "node:crypto";
import {
  InvalidSignatureError,
  SignatureExpiredError,
} from "@/core/triggers/errors";
import {
  normalizeSlackEvent,
  type SlackEventCallbackPayload,
} from "./normalize";
import type { TriggerEvent } from "@/contracts/triggerEvent";

/**
 * Slack webhook receive: HMAC verification + URL handshake + event parse.
 *
 * Per docs/rules/webhook-receipt-routes.md §"Disallowed behavior":
 *   - Verification logic stays here, never in the route file.
 *   - Always verify before short-circuiting URL verification.
 *   - Never log the signature itself.
 *
 * Signature scheme (Slack docs):
 *   1. Header `x-slack-request-timestamp` is unix seconds.
 *   2. Header `x-slack-signature` is `v0=<lowercase-hex>`.
 *   3. Compute `v0=` + HMAC-SHA256(SLACK_SIGNING_SECRET,
 *      `v0:${timestamp}:${rawBody}`).
 *   4. Compare with `timingSafeEqual` (constant-time).
 *   5. Reject when |now - timestamp| > replay window (default 300s).
 */

const REPLAY_WINDOW_SECONDS = 300;

export type ReceiveResult =
  | { kind: "challenge"; challenge: string }
  | { kind: "events"; events: readonly TriggerEvent[] };

interface ReceiveOptions {
  /**
   * Override "now" for tests. Production callers do not pass this.
   * Seconds since epoch.
   */
  nowSeconds?: number;
  /** Override the signing secret (test-only). */
  signingSecret?: string;
}

export async function receiveSlackWebhook(
  request: Request,
  options: ReceiveOptions = {},
): Promise<ReceiveResult> {
  const signingSecret = options.signingSecret ?? process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error("SLACK_SIGNING_SECRET is not set.");
  }

  const timestampHeader = request.headers.get("x-slack-request-timestamp");
  const signatureHeader = request.headers.get("x-slack-signature");
  if (!timestampHeader || !signatureHeader) {
    throw new InvalidSignatureError("Missing Slack signature headers.");
  }

  const timestamp = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp)) {
    throw new InvalidSignatureError("Slack timestamp header is not a number.");
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_SECONDS) {
    throw new SignatureExpiredError();
  }

  // Read the raw body — HMAC must be computed on the byte-exact body Slack signed.
  const rawBody = await request.text();

  const expected =
    "v0=" +
    createHmac("sha256", signingSecret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex");

  if (!constantTimeStringCompare(expected, signatureHeader)) {
    throw new InvalidSignatureError();
  }

  // Body is verified; parse it.
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new InvalidSignatureError("Slack body is not valid JSON.");
  }

  if (isUrlVerification(body)) {
    return { kind: "challenge", challenge: body.challenge };
  }

  if (!isEventCallback(body)) {
    // Unknown Slack envelope type. Treat as no-op (Slack will not retry on
    // 200, and we don't want to surface internal "unknown event" 4xx to
    // Slack's dashboards). Empty events array.
    return { kind: "events", events: [] };
  }

  return {
    kind: "events",
    events: [normalizeSlackEvent(body)],
  };
}

function constantTimeStringCompare(a: string, b: string): boolean {
  // Length difference is safe to leak — both are fixed-format hex strings.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isUrlVerification(
  body: unknown,
): body is { type: "url_verification"; challenge: string } {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    b.type === "url_verification" &&
    typeof b.challenge === "string" &&
    b.challenge.length > 0
  );
}

function isEventCallback(body: unknown): body is SlackEventCallbackPayload {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (b.type !== "event_callback") return false;
  if (typeof b.team_id !== "string") return false;
  if (typeof b.event_id !== "string") return false;
  if (typeof b.event_time !== "number") return false;
  if (typeof b.event !== "object" || b.event === null) return false;
  const e = b.event as Record<string, unknown>;
  return typeof e.type === "string";
}
