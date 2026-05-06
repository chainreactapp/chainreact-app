/**
 * @jest-environment node
 *
 * Tests for services/triggers/dispatch.ts.
 *
 * Verifies the locked rules from webhook-receipt-routes.md:
 *   - Dedup keyed on (provider, eventId).
 *   - Drops events for non-active workflows even when the trigger row
 *     still exists (paused retains registration; deregistration may lag).
 *   - Async dispatch only — calls enqueueRun and returns.
 *   - Dedup outage → fail-open + log marker; dispatch proceeds.
 */
const mockMarkSeen = jest.fn();
const mockListForDispatch = jest.fn();
const mockGetStateForDispatch = jest.fn();
const mockEnqueueRun = jest.fn();

jest.mock("@/repositories/webhookEventDedup", () => ({
  markSeen: (...args: unknown[]) => mockMarkSeen(...args),
}));

jest.mock("@/repositories/triggerResources", () => ({
  listForDispatch: (...args: unknown[]) => mockListForDispatch(...args),
}));

jest.mock("@/repositories/workflows", () => ({
  getStateForDispatch: (...args: unknown[]) => mockGetStateForDispatch(...args),
}));

jest.mock("@/services/execution/enqueue", () => ({
  enqueueRun: (...args: unknown[]) => mockEnqueueRun(...args),
}));

import { dispatchTriggerEvent } from "@/services/triggers/dispatch";
import type { TriggerEvent } from "@/contracts/triggerEvent";

const event: TriggerEvent = {
  provider: "slack",
  eventType: "message",
  eventId: "Ev123",
  occurredAt: "2026-05-07T00:00:00Z",
  accountId: "T0001",
  payload: { text: "hi" },
};

const baseResource = {
  id: "tr-1",
  workflowId: "wf-1",
  userId: "user-1",
  provider: "slack",
  eventType: "message",
  nodeId: "n1",
  config: {},
  accountId: null,
  registeredAt: "2026-05-07T00:00:00Z",
  expiresAt: null,
  lastRenewedAt: null,
  createdAt: "2026-05-07T00:00:00Z",
  updatedAt: "2026-05-07T00:00:00Z",
};

beforeEach(() => {
  mockMarkSeen.mockReset();
  mockListForDispatch.mockReset();
  mockGetStateForDispatch.mockReset();
  mockEnqueueRun.mockReset();
});

describe("dispatchTriggerEvent — happy path", () => {
  it("dedups → looks up resources → checks state → enqueues", async () => {
    mockMarkSeen.mockResolvedValueOnce({ fresh: true });
    mockListForDispatch.mockResolvedValueOnce([baseResource]);
    mockGetStateForDispatch.mockResolvedValueOnce("active");
    mockEnqueueRun.mockResolvedValueOnce({ runId: null, enqueuedAt: "" });

    const result = await dispatchTriggerEvent(event);

    expect(mockMarkSeen).toHaveBeenCalledWith("slack", "Ev123");
    expect(mockListForDispatch).toHaveBeenCalledWith("slack", "message");
    expect(mockGetStateForDispatch).toHaveBeenCalledWith("wf-1");
    expect(mockEnqueueRun).toHaveBeenCalledWith({
      workflowId: "wf-1",
      triggerNodeId: "n1",
      event,
    });
    expect(result).toEqual({
      matched: 1,
      enqueued: 1,
      duplicate: false,
      dedupOutage: false,
    });
  });

  it("enqueues for every active workflow that matches and skips inactive ones", async () => {
    const wfA = { ...baseResource, workflowId: "wf-A", nodeId: "nA" };
    const wfB = { ...baseResource, workflowId: "wf-B", nodeId: "nB" };
    const wfC = { ...baseResource, workflowId: "wf-C", nodeId: "nC" };
    mockMarkSeen.mockResolvedValueOnce({ fresh: true });
    mockListForDispatch.mockResolvedValueOnce([wfA, wfB, wfC]);
    mockGetStateForDispatch
      .mockResolvedValueOnce("active") // A
      .mockResolvedValueOnce("paused") // B - dropped
      .mockResolvedValueOnce("active"); // C
    mockEnqueueRun.mockResolvedValue({ runId: null, enqueuedAt: "" });

    const result = await dispatchTriggerEvent(event);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(2);
    expect(result.matched).toBe(3);
    expect(result.enqueued).toBe(2);
  });
});

describe("dispatchTriggerEvent — dedup", () => {
  it("drops the event without lookup or enqueue when dedup says it's already seen", async () => {
    mockMarkSeen.mockResolvedValueOnce({ fresh: false });
    const result = await dispatchTriggerEvent(event);
    expect(mockListForDispatch).not.toHaveBeenCalled();
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(result).toEqual({
      matched: 0,
      enqueued: 0,
      duplicate: true,
      dedupOutage: false,
    });
  });

  it("fail-open on dedup outage: dispatch proceeds and dedupOutage=true is set", async () => {
    mockMarkSeen.mockRejectedValueOnce(new Error("connection lost"));
    mockListForDispatch.mockResolvedValueOnce([baseResource]);
    mockGetStateForDispatch.mockResolvedValueOnce("active");
    mockEnqueueRun.mockResolvedValueOnce({ runId: null, enqueuedAt: "" });

    const result = await dispatchTriggerEvent(event);
    expect(result.dedupOutage).toBe(true);
    expect(result.enqueued).toBe(1);
  });
});

describe("dispatchTriggerEvent — state-aware drop (rule §Disabled / paused workflows)", () => {
  it.each(["paused", "disabled", "eligible_to_resume", "draft", "deleted"] as const)(
    "drops without enqueue when workflow state is %s",
    async (state) => {
      mockMarkSeen.mockResolvedValueOnce({ fresh: true });
      mockListForDispatch.mockResolvedValueOnce([baseResource]);
      mockGetStateForDispatch.mockResolvedValueOnce(state);

      const result = await dispatchTriggerEvent(event);
      expect(mockEnqueueRun).not.toHaveBeenCalled();
      expect(result.matched).toBe(1);
      expect(result.enqueued).toBe(0);
    },
  );

  it("drops when getStateForDispatch returns null (workflow row gone)", async () => {
    mockMarkSeen.mockResolvedValueOnce({ fresh: true });
    mockListForDispatch.mockResolvedValueOnce([baseResource]);
    mockGetStateForDispatch.mockResolvedValueOnce(null);
    const result = await dispatchTriggerEvent(event);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(result.enqueued).toBe(0);
  });
});

describe("dispatchTriggerEvent — no matching resources", () => {
  it("returns matched=0 when no trigger_resources rows exist for the event", async () => {
    mockMarkSeen.mockResolvedValueOnce({ fresh: true });
    mockListForDispatch.mockResolvedValueOnce([]);
    const result = await dispatchTriggerEvent(event);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(result).toEqual({
      matched: 0,
      enqueued: 0,
      duplicate: false,
      dedupOutage: false,
    });
  });
});
