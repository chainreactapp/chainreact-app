/**
 * @jest-environment node
 *
 * Tests for the polling-side dedup wrapper.
 *
 * V1 used a per-process Map with a 5-minute TTL. V2 replaces that with the
 * existing `webhook_event_dedup` table (Slice 2e plan §4 "Rewrite"). These
 * tests pin the three outcomes — fresh / not-fresh / outage — and verify
 * the fail-closed-on-outage policy that distinguishes polling from V1's
 * fail-open webhook dispatcher.
 */

const mockMarkSeen = jest.fn();
jest.mock("@/repositories/webhookEventDedup", () => ({
  markSeen: (...args: unknown[]) => mockMarkSeen(...args),
}));

import { checkAndMarkSeen } from "@/integrations/gmail/triggers/newEmail/dedup";

beforeEach(() => {
  mockMarkSeen.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("checkAndMarkSeen", () => {
  it("returns fresh=true on first sight of a Gmail message id", async () => {
    mockMarkSeen.mockResolvedValueOnce({ fresh: true });
    const result = await checkAndMarkSeen("msg-001");
    expect(mockMarkSeen).toHaveBeenCalledWith("gmail", "msg-001");
    expect(result).toEqual({ fresh: true, outage: false });
  });

  it("returns fresh=false when the message id is already in the dedup table", async () => {
    mockMarkSeen.mockResolvedValueOnce({ fresh: false });
    const result = await checkAndMarkSeen("msg-002");
    expect(result).toEqual({ fresh: false, outage: false });
  });

  it("fails closed on dedup outage — caller skips the message rather than risk double-fire", async () => {
    mockMarkSeen.mockRejectedValueOnce(new Error("connection refused"));
    const result = await checkAndMarkSeen("msg-003");
    expect(result).toEqual({ fresh: false, outage: true });
  });

  it("logs a structured warning on outage so we can detect dedup-store regressions", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockMarkSeen.mockRejectedValueOnce(new Error("network"));
    await checkAndMarkSeen("msg-004");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({
      event: "gmail.poll.dedup.outage",
      messageId: "msg-004",
      error: "network",
    });
  });
});
