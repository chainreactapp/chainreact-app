/**
 * @jest-environment node
 *
 * Tests for services/cron/runPollingTriggers.ts.
 *
 * Mocks the trigger_resources repo + workflows state lookup so the test
 * never touches the DB. The polling registry is module-level mutable
 * state; we reset it in beforeEach.
 */

const mockListForPolling = jest.fn();
const mockGetStateForDispatch = jest.fn();
jest.mock("@/repositories/triggerResources", () => ({
  listForPolling: (...args: unknown[]) => mockListForPolling(...args),
}));
jest.mock("@/repositories/workflows", () => ({
  getStateForDispatch: (...args: unknown[]) => mockGetStateForDispatch(...args),
}));

import { runPollingTriggers } from "@/services/cron/runPollingTriggers";
import {
  __resetPollingRegistryForTests,
  registerPollingHandler,
} from "@/services/triggers/pollingRegistry";
import type { TriggerResourceRecord } from "@/repositories/triggerResources";

function makeTrigger(
  overrides: Partial<TriggerResourceRecord> = {},
): TriggerResourceRecord {
  const base: TriggerResourceRecord = {
    id: "tr-1",
    workflowId: "wf-1",
    userId: "user-1",
    provider: "gmail",
    eventType: "new_email",
    nodeId: "n1",
    config: { pollingEnabled: true },
    accountId: null,
    registeredAt: "2026-05-07T00:00:00Z",
    expiresAt: null,
    lastRenewedAt: null,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  mockListForPolling.mockReset();
  mockGetStateForDispatch.mockReset();
  __resetPollingRegistryForTests();
});

describe("runPollingTriggers", () => {
  it("skips triggers without a registered handler", async () => {
    mockListForPolling.mockResolvedValue([makeTrigger()]);
    const result = await runPollingTriggers();
    expect(result).toMatchObject({
      examined: 1,
      processed: 0,
      skipped: 1,
      errors: 0,
    });
  });

  it("invokes the matching handler and counts it processed", async () => {
    const poll = jest.fn().mockResolvedValue(undefined);
    registerPollingHandler({
      id: "gmail",
      canHandle: (t) => t.provider === "gmail",
      getIntervalMs: () => 1000,
      poll,
    });
    mockListForPolling.mockResolvedValue([makeTrigger()]);
    mockGetStateForDispatch.mockResolvedValue("active");

    const result = await runPollingTriggers();
    expect(poll).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      examined: 1,
      processed: 1,
      skipped: 0,
      errors: 0,
    });
  });

  it("skips triggers when interval has not elapsed since lastPolledAt", async () => {
    const poll = jest.fn();
    registerPollingHandler({
      id: "gmail",
      canHandle: (t) => t.provider === "gmail",
      getIntervalMs: () => 5 * 60_000,
      poll,
    });
    const recent = new Date(Date.now() - 30_000).toISOString();
    mockListForPolling.mockResolvedValue([
      makeTrigger({
        config: { pollingEnabled: true, polling: { lastPolledAt: recent } },
      }),
    ]);

    const result = await runPollingTriggers();
    expect(poll).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: 1, processed: 0 });
  });

  it("skips triggers whose workflow is not active", async () => {
    const poll = jest.fn();
    registerPollingHandler({
      id: "gmail",
      canHandle: () => true,
      getIntervalMs: () => 1000,
      poll,
    });
    mockListForPolling.mockResolvedValue([makeTrigger()]);
    mockGetStateForDispatch.mockResolvedValue("paused");

    const result = await runPollingTriggers();
    expect(poll).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: 1 });
  });

  it("counts a thrown handler as an error and continues with the batch", async () => {
    registerPollingHandler({
      id: "gmail",
      canHandle: () => true,
      getIntervalMs: () => 1000,
      poll: jest
        .fn()
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce(undefined),
    });
    mockListForPolling.mockResolvedValue([
      makeTrigger({ id: "tr-1", workflowId: "wf-a" }),
      makeTrigger({ id: "tr-2", workflowId: "wf-b" }),
    ]);
    mockGetStateForDispatch.mockResolvedValue("active");

    const result = await runPollingTriggers();
    expect(result.examined).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.processed).toBe(1);
  });

  it("returns zero counts when no triggers are pollable", async () => {
    mockListForPolling.mockResolvedValue([]);
    const result = await runPollingTriggers();
    expect(result).toMatchObject({
      examined: 0,
      processed: 0,
      skipped: 0,
      errors: 0,
    });
  });
});
