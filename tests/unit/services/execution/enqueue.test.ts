/**
 * @jest-environment node
 *
 * Tests for services/execution/enqueue.ts.
 *
 * Per docs/rules/webhook-receipt-routes.md §"Async dispatch only":
 *   - enqueueRun returns immediately with { runId, enqueuedAt }.
 *   - The engine runs in the background; engine errors don't propagate.
 *   - The dispatcher (caller) treats the return value as "queued";
 *     the webhook returns 200 right after.
 */

const mockRunWorkflow = jest.fn();
jest.mock("@/services/execution/engine", () => ({
  WorkflowEngine: jest.fn(() => ({ runWorkflow: mockRunWorkflow })),
}));

// Stub the resolver so the import in enqueue.ts resolves without 1K.1.
jest.mock("@/workflow-engine/variables/resolveValue", () => ({
  resolveStrict: jest.fn(),
}));

import { enqueueRun } from "@/services/execution/enqueue";
import type { TriggerEvent } from "@/contracts/triggerEvent";

const triggerEvent: TriggerEvent = {
  provider: "slack",
  eventType: "message",
  eventId: "Ev1",
  occurredAt: "2026-05-07T00:00:00Z",
  accountId: "T0001",
  payload: { text: "hi" },
};

beforeEach(() => {
  mockRunWorkflow.mockReset();
});

describe("enqueueRun", () => {
  it("returns { runId, enqueuedAt } synchronously and kicks off the engine in the background", async () => {
    let resolveEngineCall: () => void = () => {};
    mockRunWorkflow.mockImplementationOnce(
      () => new Promise<void>((res) => { resolveEngineCall = res; }),
    );

    const result = await enqueueRun({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      event: triggerEvent,
    });

    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(typeof result.enqueuedAt).toBe("string");
    // Engine has been kicked off but not awaited — runWorkflow was called
    // before enqueueRun resolved.
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
    resolveEngineCall();
  });

  it("threads runId through to the engine call", async () => {
    mockRunWorkflow.mockResolvedValueOnce(undefined);
    const { runId } = await enqueueRun({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      event: triggerEvent,
    });
    // Allow the microtask that calls runWorkflow to resolve.
    await new Promise((r) => setImmediate(r));
    expect(mockRunWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        workflowId: "wf-1",
        triggerNodeId: "t1",
        triggerEvent,
      }),
    );
  });

  it("background engine errors are swallowed — caller's resolved promise is unaffected", async () => {
    mockRunWorkflow.mockRejectedValueOnce(new Error("engine crashed"));
    // Should not throw.
    const result = await enqueueRun({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      event: triggerEvent,
    });
    expect(result.runId).toBeTruthy();
    // Give the rejection a tick to flush so it doesn't show up as an
    // unhandled rejection in subsequent tests.
    await new Promise((r) => setImmediate(r));
  });
});
