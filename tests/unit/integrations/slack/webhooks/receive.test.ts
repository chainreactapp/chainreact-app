/**
 * @jest-environment node
 *
 * Tests for integrations/slack/webhooks/receive.ts.
 *
 * Verifies the locked rules from webhook-receipt-routes.md:
 *   - Always verify signature before short-circuiting URL handshake.
 *   - Reject timestamps outside the replay window with SignatureExpiredError.
 *   - URL verification returns the challenge intact.
 *   - Event callback returns one normalized event per inner Slack event.
 */
import { createHmac } from "node:crypto";
import {
  InvalidSignatureError,
  SignatureExpiredError,
} from "@/core/triggers/errors";
import { receiveSlackWebhook } from "@/integrations/slack/webhooks/receive";

const SIGNING_SECRET = "test-signing-secret";
const NOW_SECONDS = 1730000000;

function signAndBuildRequest(body: unknown, opts: { timestamp?: number; signature?: string } = {}) {
  const rawBody = JSON.stringify(body);
  const timestamp = opts.timestamp ?? NOW_SECONDS;
  const signature =
    opts.signature ??
    "v0=" +
      createHmac("sha256", SIGNING_SECRET)
        .update(`v0:${timestamp}:${rawBody}`)
        .digest("hex");
  return new Request("http://example.test/api/webhooks/slack", {
    method: "POST",
    headers: {
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": signature,
      "content-type": "application/json",
    },
    body: rawBody,
  });
}

describe("receiveSlackWebhook — signature verification", () => {
  it("accepts a request with a correct HMAC", async () => {
    const req = signAndBuildRequest({
      type: "url_verification",
      challenge: "abc123",
    });
    const result = await receiveSlackWebhook(req, {
      nowSeconds: NOW_SECONDS,
      signingSecret: SIGNING_SECRET,
    });
    expect(result).toEqual({ kind: "challenge", challenge: "abc123" });
  });

  it("rejects a forged signature with InvalidSignatureError", async () => {
    const req = signAndBuildRequest(
      { type: "url_verification", challenge: "x" },
      { signature: "v0=" + "a".repeat(64) },
    );
    await expect(
      receiveSlackWebhook(req, {
        nowSeconds: NOW_SECONDS,
        signingSecret: SIGNING_SECRET,
      }),
    ).rejects.toThrow(InvalidSignatureError);
  });

  it("rejects timestamps older than the replay window with SignatureExpiredError", async () => {
    const stale = NOW_SECONDS - 600;
    const req = signAndBuildRequest(
      { type: "url_verification", challenge: "x" },
      { timestamp: stale },
    );
    await expect(
      receiveSlackWebhook(req, {
        nowSeconds: NOW_SECONDS,
        signingSecret: SIGNING_SECRET,
      }),
    ).rejects.toThrow(SignatureExpiredError);
  });

  it("rejects future timestamps outside the replay window", async () => {
    const future = NOW_SECONDS + 600;
    const req = signAndBuildRequest(
      { type: "url_verification", challenge: "x" },
      { timestamp: future },
    );
    await expect(
      receiveSlackWebhook(req, {
        nowSeconds: NOW_SECONDS,
        signingSecret: SIGNING_SECRET,
      }),
    ).rejects.toThrow(SignatureExpiredError);
  });

  it("rejects when signature headers are missing", async () => {
    const req = new Request("http://example.test/api/webhooks/slack", {
      method: "POST",
      body: "{}",
    });
    await expect(
      receiveSlackWebhook(req, { signingSecret: SIGNING_SECRET }),
    ).rejects.toThrow(/Missing Slack signature headers/);
  });

  it("throws when SLACK_SIGNING_SECRET is not configured", async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const req = new Request("http://example.test/api/webhooks/slack", {
      method: "POST",
      body: "{}",
    });
    await expect(receiveSlackWebhook(req)).rejects.toThrow(/SLACK_SIGNING_SECRET/);
  });
});

describe("receiveSlackWebhook — body parsing", () => {
  it("returns the URL verification challenge intact", async () => {
    const req = signAndBuildRequest({
      type: "url_verification",
      challenge: "challenge-token-xyz",
    });
    const result = await receiveSlackWebhook(req, {
      nowSeconds: NOW_SECONDS,
      signingSecret: SIGNING_SECRET,
    });
    expect(result).toEqual({ kind: "challenge", challenge: "challenge-token-xyz" });
  });

  it("returns one normalized event for an event_callback envelope", async () => {
    const req = signAndBuildRequest({
      type: "event_callback",
      team_id: "T0001",
      event_id: "Ev123",
      event_time: NOW_SECONDS,
      event: { type: "message", channel: "C123", text: "hi" },
    });
    const result = await receiveSlackWebhook(req, {
      nowSeconds: NOW_SECONDS,
      signingSecret: SIGNING_SECRET,
    });
    expect(result.kind).toBe("events");
    if (result.kind === "events") {
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        provider: "slack",
        eventType: "message",
        eventId: "Ev123",
        accountId: "T0001",
      });
    }
  });

  it("returns an empty events array for unknown envelope types (no 4xx to Slack)", async () => {
    const req = signAndBuildRequest({ type: "some_unknown_envelope" });
    const result = await receiveSlackWebhook(req, {
      nowSeconds: NOW_SECONDS,
      signingSecret: SIGNING_SECRET,
    });
    expect(result).toEqual({ kind: "events", events: [] });
  });
});
