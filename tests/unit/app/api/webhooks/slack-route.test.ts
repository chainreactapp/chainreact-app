/**
 * @jest-environment node
 *
 * Tests for app/api/webhooks/slack/route.ts.
 *
 * The route is a thin shell — verify the wiring contract with mocks:
 *   - InvalidSignatureError → 401
 *   - Other receive errors → 500
 *   - Challenge response is text/plain
 *   - Events get dispatched; route returns 200 + count
 *   - Dispatch failure returns 500 so Slack retries
 */
const mockReceive = jest.fn();
const mockDispatch = jest.fn();

jest.mock("@/integrations/slack/webhooks/receive", () => ({
  receiveSlackWebhook: (...args: unknown[]) => mockReceive(...args),
}));

jest.mock("@/services/triggers/dispatch", () => ({
  dispatchTriggerEvent: (...args: unknown[]) => mockDispatch(...args),
}));

import { POST } from "@/app/api/webhooks/slack/route";
import { InvalidSignatureError } from "@/core/triggers/errors";

const baseEvent = {
  provider: "slack",
  eventType: "message",
  eventId: "Ev123",
  occurredAt: "2026-05-07T00:00:00Z",
  accountId: "T0001",
  payload: { text: "hi" },
};

beforeEach(() => {
  mockReceive.mockReset();
  mockDispatch.mockReset();
});

function newRequest(): Request {
  return new Request("http://x/api/webhooks/slack", { method: "POST" });
}

describe("POST /api/webhooks/slack", () => {
  it("returns 401 when receive throws InvalidSignatureError (and never dispatches)", async () => {
    mockReceive.mockRejectedValueOnce(new InvalidSignatureError());
    const res = await POST(newRequest());
    expect(res.status).toBe(401);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns 500 when receive throws any other error", async () => {
    mockReceive.mockRejectedValueOnce(new Error("body too large"));
    const res = await POST(newRequest());
    expect(res.status).toBe(500);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("echoes the URL verification challenge as text/plain (200)", async () => {
    mockReceive.mockResolvedValueOnce({ kind: "challenge", challenge: "abc-token" });
    const res = await POST(newRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toBe("abc-token");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("dispatches every event in the events array and returns the count", async () => {
    mockReceive.mockResolvedValueOnce({
      kind: "events",
      events: [baseEvent, { ...baseEvent, eventId: "Ev456" }],
    });
    mockDispatch.mockResolvedValue({
      matched: 1,
      enqueued: 1,
      duplicate: false,
      dedupOutage: false,
    });

    const res = await POST(newRequest());
    expect(res.status).toBe(200);
    expect(mockDispatch).toHaveBeenCalledTimes(2);
    const body = await res.json();
    expect(body).toEqual({ ok: true, dispatched: 2 });
  });

  it("returns 500 when dispatch throws (so Slack retries)", async () => {
    mockReceive.mockResolvedValueOnce({
      kind: "events",
      events: [baseEvent],
    });
    mockDispatch.mockRejectedValueOnce(new Error("queue full"));
    const res = await POST(newRequest());
    expect(res.status).toBe(500);
  });

  it("returns 200 with dispatched=0 when receive yields zero events (unknown envelope)", async () => {
    mockReceive.mockResolvedValueOnce({ kind: "events", events: [] });
    const res = await POST(newRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dispatched: 0 });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
