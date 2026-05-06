/**
 * @jest-environment node
 *
 * Tests for the workflow-failure notification orchestrator.
 *
 * Covers the platform contract:
 *   - Atomic dedup claim (first wins; subsequent calls return early)
 *   - Payload built once, channels invoked with same payload + userId
 *   - Channel exceptions don't block other channels
 *   - Channel { delivered: false } recorded in results, not thrown
 *   - Slice 1 invariant: only in-app channel registered
 */

const mockClaimNotificationFanout = jest.fn();
jest.mock("@/repositories/workflowRuns", () => ({
  claimNotificationFanout: (...args: unknown[]) => mockClaimNotificationFanout(...args),
}));

const mockGetEnabledChannels = jest.fn();
jest.mock("@/services/notifications/channelRegistry", () => ({
  getEnabledChannelsForUser: (...args: unknown[]) => mockGetEnabledChannels(...args),
}));

import { notifyWorkflowFailure } from "@/services/notifications/notifyWorkflowFailure";
import type { NotificationChannel } from "@/services/notifications/channel";
import type { HumanizedError } from "@/core/errors/humanizeActionError";

const errorClassification: HumanizedError = {
  title: "Slack channel not found",
  description: "Couldn't find the channel.",
  hint: "Check channel id.",
  action: "open_node",
  severity: "error",
};

const baseInput = {
  userId: "user-1",
  workflowId: "wf-1",
  workflowName: "Test Workflow",
  runId: "run-1",
  errorClassification,
};

function makeChannel(
  name: NotificationChannel["name"],
  send: NotificationChannel["send"],
): NotificationChannel {
  return { name, send };
}

beforeEach(() => {
  mockClaimNotificationFanout.mockReset();
  mockGetEnabledChannels.mockReset();
});

describe("notifyWorkflowFailure — atomic dedup", () => {
  it("claim succeeds → builds payload + invokes registered channels + returns aggregate", async () => {
    mockClaimNotificationFanout.mockResolvedValueOnce(true);
    const inAppSend = jest.fn(async () => ({ delivered: true as const }));
    mockGetEnabledChannels.mockReturnValueOnce([makeChannel("in_app", inAppSend)]);

    const outcome = await notifyWorkflowFailure(baseInput);

    expect(mockClaimNotificationFanout).toHaveBeenCalledWith("run-1");
    expect(inAppSend).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      claimed: true,
      results: [{ channel: "in_app", delivered: true }],
    });
  });

  it("claim FAILS (already fired) → channels NOT invoked, returns early with reason", async () => {
    mockClaimNotificationFanout.mockResolvedValueOnce(false);
    const inAppSend = jest.fn();
    mockGetEnabledChannels.mockReturnValueOnce([makeChannel("in_app", inAppSend)]);

    const outcome = await notifyWorkflowFailure(baseInput);

    expect(inAppSend).not.toHaveBeenCalled();
    expect(outcome).toEqual({ claimed: false, reason: "already_fired" });
  });

  it("forwards the runId verbatim to the dedup claim (no derivation)", async () => {
    mockClaimNotificationFanout.mockResolvedValueOnce(true);
    mockGetEnabledChannels.mockReturnValueOnce([]);
    await notifyWorkflowFailure({ ...baseInput, runId: "very-specific-run-id" });
    expect(mockClaimNotificationFanout).toHaveBeenCalledWith("very-specific-run-id");
  });
});

describe("notifyWorkflowFailure — payload + channel invocation", () => {
  it("invokes each channel with the SAME payload + userId (no per-channel re-derivation)", async () => {
    mockClaimNotificationFanout.mockResolvedValueOnce(true);
    const sendA = jest.fn(async () => ({ delivered: true as const }));
    const sendB = jest.fn(async () => ({ delivered: true as const }));
    mockGetEnabledChannels.mockReturnValueOnce([
      makeChannel("in_app", sendA),
      makeChannel("email", sendB),
    ]);

    await notifyWorkflowFailure(baseInput);

    expect(sendA).toHaveBeenCalledWith(expect.any(Object), "user-1");
    expect(sendB).toHaveBeenCalledWith(expect.any(Object), "user-1");
    // Same payload object reference across channels (built once)
    const aArgs = sendA.mock.calls[0] as unknown as readonly unknown[];
    const bArgs = sendB.mock.calls[0] as unknown as readonly unknown[];
    expect(aArgs[0]).toBe(bArgs[0]);
  });

  it("payload carries the humanized title and the routed CTA URL", async () => {
    mockClaimNotificationFanout.mockResolvedValueOnce(true);
    const send = jest.fn(async () => ({ delivered: true as const }));
    mockGetEnabledChannels.mockReturnValueOnce([makeChannel("in_app", send)]);

    await notifyWorkflowFailure(baseInput);

    const callArgs = send.mock.calls[0] as unknown as readonly unknown[];
    const payloadArg = callArgs[0] as {
      errorClassification: { title: string };
      ctaUrl: string;
    };
    expect(payloadArg.errorClassification.title).toBe("Slack channel not found");
    expect(payloadArg.ctaUrl).toBe("/workflows/wf-1?historyRun=run-1");
  });
});

describe("notifyWorkflowFailure — channel failure isolation", () => {
  it("channel A throws → channel B still invoked; result records A's failure", async () => {
    mockClaimNotificationFanout.mockResolvedValueOnce(true);
    const sendA = jest.fn(async () => {
      throw new Error("Slack API timeout");
    });
    const sendB = jest.fn(async () => ({ delivered: true as const }));
    mockGetEnabledChannels.mockReturnValueOnce([
      makeChannel("slack", sendA),
      makeChannel("in_app", sendB),
    ]);

    const outcome = await notifyWorkflowFailure(baseInput);

    expect(sendB).toHaveBeenCalledTimes(1);
    if (!outcome.claimed) throw new Error("expected claim to succeed");
    expect(outcome.results).toEqual([
      { channel: "slack", delivered: false, reason: "Slack API timeout" },
      { channel: "in_app", delivered: true },
    ]);
  });

  it("channel returns { delivered: false } → recorded in results, NOT thrown", async () => {
    mockClaimNotificationFanout.mockResolvedValueOnce(true);
    const send = jest.fn(async () => ({
      delivered: false as const,
      reason: "rate limited",
    }));
    mockGetEnabledChannels.mockReturnValueOnce([makeChannel("in_app", send)]);

    const outcome = await notifyWorkflowFailure(baseInput);
    if (!outcome.claimed) throw new Error("expected claim to succeed");
    expect(outcome.results).toEqual([
      { channel: "in_app", delivered: false, reason: "rate limited" },
    ]);
  });

  it("non-Error throw is normalized to a stable reason string", async () => {
    mockClaimNotificationFanout.mockResolvedValueOnce(true);
    const send = jest.fn(async () => {
      throw "string thrown";
    });
    mockGetEnabledChannels.mockReturnValueOnce([makeChannel("in_app", send)]);

    const outcome = await notifyWorkflowFailure(baseInput);
    if (!outcome.claimed) throw new Error("expected claim to succeed");
    expect(outcome.results[0]).toEqual({
      channel: "in_app",
      delivered: false,
      reason: "unknown channel exception",
    });
  });
});

describe("notifyWorkflowFailure — Slice 1 invariant: in-app only", () => {
  it("the real channel registry returns exactly one channel and it's in_app", async () => {
    // Don't mock the registry for this test — exercise the real one
    // (channelRegistry.test would also catch a regression here, but
    // verifying the orchestrator + registry together is cheap and
    // forward-protects against accidentally enabling email/slack/discord
    // in Slice 1).
    jest.unmock("@/services/notifications/channelRegistry");
    jest.resetModules();
    const realModule = await import("@/services/notifications/channelRegistry");
    const channels = realModule.getEnabledChannelsForUser("any-user");
    expect(channels).toHaveLength(1);
    expect(channels[0]?.name).toBe("in_app");
  });
});
