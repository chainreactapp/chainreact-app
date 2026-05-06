/**
 * @jest-environment node
 *
 * Tests for services/execution/engine.ts.
 *
 * The engine is built with dependency-injected resolveStrict + a hand-
 * maintained handler registry. Tests:
 *   - Mock workflowsRepo.getByIdServiceRole to seed the workflow.
 *   - Mock the handler registry to inject test handlers.
 *   - Inject a stub resolveStrict so this slice can ship before 1K.1's
 *     resolver lands.
 */

const mockGetByIdServiceRole = jest.fn();
jest.mock("@/repositories/workflows", () => ({
  getByIdServiceRole: (...args: unknown[]) => mockGetByIdServiceRole(...args),
}));

const mockGetActionHandler = jest.fn();
jest.mock("@/services/execution/handlers/_registry", () => ({
  getActionHandler: (...args: unknown[]) => mockGetActionHandler(...args),
}));

const mockRecordRun = jest.fn();
jest.mock("@/repositories/workflowRuns", () => ({
  recordRun: (...args: unknown[]) => mockRecordRun(...args),
}));

const mockBillingGate = jest.fn();
jest.mock("@/services/billing/executionBillingGate", () => ({
  executionBillingGate: (...args: unknown[]) => mockBillingGate(...args),
}));

const mockNotifyWorkflowFailure = jest.fn();
jest.mock("@/services/notifications/notifyWorkflowFailure", () => ({
  notifyWorkflowFailure: (...args: unknown[]) => mockNotifyWorkflowFailure(...args),
}));

import { WorkflowEngine } from "@/services/execution/engine";
import { MissingVariableError } from "@/workflow-engine/variables/resolveValue";
import type { TriggerEvent } from "@/contracts/triggerEvent";
import type { WorkflowNode, WorkflowEdge } from "@/contracts/workflow";

const triggerEvent: TriggerEvent = {
  provider: "slack",
  eventType: "message",
  eventId: "Ev1",
  occurredAt: "2026-05-07T00:00:00Z",
  accountId: "T0001",
  payload: { text: "hello", channel: "C123" },
};

function trigger(id: string): WorkflowNode {
  return {
    id,
    kind: "trigger",
    provider: "slack",
    type: "message",
    config: {},
    position: { x: 0, y: 0 },
  };
}

function action(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return {
    id,
    kind: "action",
    provider: "slack",
    type,
    config,
    position: { x: 0, y: 100 },
  };
}

function edge(id: string, from: string, to: string): WorkflowEdge {
  return { id, from, to };
}

const baseWorkflow = {
  id: "wf-1",
  userId: "user-1",
  name: "Test",
  state: "active" as const,
  disabledReason: null,
  disabledContext: null,
  activeRevisionId: null,
  draftDefinition: { nodes: [trigger("t1")], edges: [] },
  deletedAt: null,
  createdAt: "2026-05-07T00:00:00Z",
  updatedAt: "2026-05-07T00:00:00Z",
};

beforeEach(() => {
  mockGetByIdServiceRole.mockReset();
  mockGetActionHandler.mockReset();
  mockRecordRun.mockReset();
  mockRecordRun.mockResolvedValue(undefined);
  // Default: gate allows. Individual tests override for the refusal path.
  mockBillingGate.mockReset();
  mockBillingGate.mockResolvedValue({ ok: true, used: 1, limit: 100 });
  mockNotifyWorkflowFailure.mockReset();
  mockNotifyWorkflowFailure.mockResolvedValue({ claimed: true, results: [] });
});

describe("WorkflowEngine — fatal errors", () => {
  it("returns WORKFLOW_NOT_FOUND when getByIdServiceRole returns null", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce(null);
    const engine = new WorkflowEngine({ resolveStrict: (v) => v });
    const result = await engine.runWorkflow({
      workflowId: "missing",
      triggerNodeId: "t1",
      triggerEvent,
    });
    expect(result.status).toBe("failed");
    expect(result.fatalError?.code).toBe("WORKFLOW_NOT_FOUND");
    expect(result.steps).toEqual([]);
  });

  it("returns TRIGGER_NODE_NOT_FOUND when the dispatched node id is not in the definition", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce(baseWorkflow);
    const engine = new WorkflowEngine({ resolveStrict: (v) => v });
    const result = await engine.runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "ghost",
      triggerEvent,
    });
    expect(result.fatalError?.code).toBe("TRIGGER_NODE_NOT_FOUND");
  });
});

describe("WorkflowEngine — happy path (linear chain)", () => {
  it("executes trigger → action1 → action2 in BFS order, threading outputs through variables", async () => {
    const t = trigger("t1");
    const a1 = action("a1", "step_one");
    const a2 = action("a2", "step_two");
    const definition = {
      nodes: [t, a1, a2],
      edges: [edge("e1", "t1", "a1"), edge("e2", "a1", "a2")],
    };
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: definition,
    });

    const handlerOne = jest.fn(async () => ({ output: { messageId: "m1" } }));
    const handlerTwo = jest.fn(async () => ({ output: { messageId: "m2" } }));
    mockGetActionHandler.mockImplementation((p: string, t: string) => {
      if (p === "slack" && t === "step_one") return handlerOne;
      if (p === "slack" && t === "step_two") return handlerTwo;
      return undefined;
    });

    const resolveStrict = jest.fn((v: unknown, _ctx?: unknown) => v);
    const engine = new WorkflowEngine({ resolveStrict });
    const result = await engine.runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });

    expect(result.status).toBe("succeeded");
    expect(result.steps.map((s) => s.nodeId)).toEqual(["t1", "a1", "a2"]);
    expect(handlerOne).toHaveBeenCalledTimes(1);
    expect(handlerTwo).toHaveBeenCalledTimes(1);

    // Variable propagation: when a2's resolveStrict ran, the context
    // should have included a1's output. Verify via the call args.
    const a2Call = resolveStrict.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>) === a2.config,
    );
    expect(a2Call).toBeDefined();
    const a2Context = a2Call![1] as { variables: Record<string, unknown> };
    expect(a2Context.variables.a1).toEqual({ messageId: "m1" });
    expect(a2Context.variables.trigger).toBe(triggerEvent);
  });

  it("exposes the trigger event under both 'trigger' and the trigger node's id", async () => {
    const t = trigger("custom_trigger");
    const a1 = action("a1", "noop");
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: { nodes: [t, a1], edges: [edge("e1", "custom_trigger", "a1")] },
    });
    mockGetActionHandler.mockReturnValueOnce(async () => ({ output: {} }));

    const resolveStrict = jest.fn((v: unknown, _ctx?: unknown) => v);
    await new WorkflowEngine({ resolveStrict }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "custom_trigger",
      triggerEvent,
    });

    const ctx = resolveStrict.mock.calls[0]![1] as { variables: Record<string, unknown> };
    expect(ctx.variables.trigger).toBe(triggerEvent);
    expect(ctx.variables.custom_trigger).toBe(triggerEvent);
  });
});

describe("WorkflowEngine — failure modes (rule §Engine pre-resolution)", () => {
  it("MissingVariableError aborts the run with a MISSING_VARIABLE step + path/reason details", async () => {
    const a1 = action("a1", "step_one", { channel: "{{trigger.unknown}}" });
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: {
        nodes: [trigger("t1"), a1],
        edges: [edge("e1", "t1", "a1")],
      },
    });
    const handler = jest.fn();
    mockGetActionHandler.mockReturnValueOnce(handler);

    const resolveStrict = jest.fn(() => {
      throw new MissingVariableError("trigger.unknown", "missing_field");
    });
    const result = await new WorkflowEngine({ resolveStrict }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });

    expect(result.status).toBe("failed");
    expect(handler).not.toHaveBeenCalled();
    const failed = result.steps.find((s) => s.status === "failed");
    expect(failed).toMatchObject({
      nodeId: "a1",
      error: {
        code: "MISSING_VARIABLE",
        details: { path: "trigger.unknown", reason: "missing_field" },
      },
    });
  });

  it("MISSING_HANDLER when the registry has no handler for (provider, type)", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: {
        nodes: [trigger("t1"), action("a1", "unknown_action")],
        edges: [edge("e1", "t1", "a1")],
      },
    });
    mockGetActionHandler.mockReturnValueOnce(undefined);

    const result = await new WorkflowEngine({
      resolveStrict: (v) => v,
    }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });
    expect(result.status).toBe("failed");
    const failed = result.steps.find((s) => s.status === "failed");
    expect(failed?.error?.code).toBe("MISSING_HANDLER");
  });

  it("HANDLER_FAILED when the handler throws", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: {
        nodes: [trigger("t1"), action("a1", "step_one")],
        edges: [edge("e1", "t1", "a1")],
      },
    });
    mockGetActionHandler.mockReturnValueOnce(async () => {
      throw new Error("Slack rate limited");
    });

    const result = await new WorkflowEngine({
      resolveStrict: (v) => v,
    }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });

    expect(result.status).toBe("failed");
    expect(result.steps[1]).toMatchObject({
      status: "failed",
      error: { code: "HANDLER_FAILED", message: "Slack rate limited" },
    });
  });

  it("stops on first failure — downstream steps are not executed", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: {
        nodes: [trigger("t1"), action("a1", "fail"), action("a2", "should_not_run")],
        edges: [edge("e1", "t1", "a1"), edge("e2", "a1", "a2")],
      },
    });
    const failingHandler = jest.fn(async () => {
      throw new Error("boom");
    });
    const downstreamHandler = jest.fn();
    mockGetActionHandler.mockImplementation((_p: string, t: string) =>
      t === "fail" ? failingHandler : downstreamHandler,
    );

    const result = await new WorkflowEngine({
      resolveStrict: (v) => v,
    }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });

    expect(result.status).toBe("failed");
    expect(failingHandler).toHaveBeenCalledTimes(1);
    expect(downstreamHandler).not.toHaveBeenCalled();
    expect(result.steps).toHaveLength(2); // trigger + a1; a2 skipped
  });
});

describe("WorkflowEngine — graph traversal", () => {
  it("visited-set prevents infinite loops on cyclic graphs (visits each node once)", async () => {
    // Cycle: t1 → a1 → a2 → a1 (back to a1).
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: {
        nodes: [trigger("t1"), action("a1", "step"), action("a2", "step")],
        edges: [
          edge("e1", "t1", "a1"),
          edge("e2", "a1", "a2"),
          edge("e3", "a2", "a1"),
        ],
      },
    });
    const handler = jest.fn(async () => ({ output: {} }));
    mockGetActionHandler.mockReturnValue(handler);

    const result = await new WorkflowEngine({
      resolveStrict: (v) => v,
    }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });
    // Each action visited once despite the back-edge.
    expect(handler).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("succeeded");
  });

  it("manual-only workflow (zero non-trigger nodes) succeeds with one step", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: { nodes: [trigger("t1")], edges: [] },
    });
    const result = await new WorkflowEngine({
      resolveStrict: (v) => v,
    }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });
    expect(result.status).toBe("succeeded");
    expect(result.steps).toEqual([
      expect.objectContaining({ nodeId: "t1", status: "succeeded" }),
    ]);
  });
});

describe("WorkflowEngine — run persistence (Slice 1M)", () => {
  it("records a 'succeeded' run row with steps + null error_classification", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: {
        nodes: [trigger("t1"), action("a1", "step")],
        edges: [edge("e1", "t1", "a1")],
      },
    });
    mockGetActionHandler.mockReturnValueOnce(async () => ({ output: { ok: true } }));

    const result = await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });

    expect(mockRecordRun).toHaveBeenCalledTimes(1);
    expect(mockRecordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: result.runId,
        workflowId: "wf-1",
        userId: "user-1",
        status: "succeeded",
        triggerNodeId: "t1",
        triggerEvent,
        errorClassification: null,
        fatalError: null,
      }),
    );
  });

  it("records a 'failed' run with humanized error_classification derived from the first failed step", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: {
        nodes: [trigger("t1"), action("a1", "step", { channel: "{{trigger.unknown}}" })],
        edges: [edge("e1", "t1", "a1")],
      },
    });
    mockGetActionHandler.mockReturnValueOnce(jest.fn());

    const resolveStrict = jest.fn(() => {
      throw new MissingVariableError("trigger.unknown", "missing_field");
    });

    await new WorkflowEngine({ resolveStrict }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });

    expect(mockRecordRun).toHaveBeenCalledTimes(1);
    const call = mockRecordRun.mock.calls[0]![0] as {
      status: string;
      errorClassification: { title: string; action?: string; severity: string };
    };
    expect(call.status).toBe("failed");
    expect(call.errorClassification.title).toMatch(/variable/i);
    expect(call.errorClassification.action).toBe("open_node");
  });

  it("records a 'failed' run with classification derived from fatalError when no steps ran", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: { nodes: [trigger("t1")], edges: [] },
    });

    await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "ghost", // not in definition → TRIGGER_NODE_NOT_FOUND
      triggerEvent,
    });

    expect(mockRecordRun).toHaveBeenCalledTimes(1);
    const call = mockRecordRun.mock.calls[0]![0] as {
      status: string;
      fatalError: { code: string };
      errorClassification: { title: string };
    };
    expect(call.fatalError.code).toBe("TRIGGER_NODE_NOT_FOUND");
    expect(call.errorClassification.title).toMatch(/trigger node missing/i);
  });

  it("does NOT record a run when the workflow itself is missing (no userId to attribute)", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce(null);
    await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "missing",
      triggerNodeId: "t1",
      triggerEvent,
    });
    expect(mockRecordRun).not.toHaveBeenCalled();
  });

  it("swallows recordRun errors so the engine completes the run regardless", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: { nodes: [trigger("t1")], edges: [] },
    });
    mockRecordRun.mockRejectedValueOnce(new Error("DB write failed"));

    const result = await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });

    // Engine still returns a result; recordRun failure logged + swallowed.
    expect(result.status).toBe("succeeded");
  });
});

describe("WorkflowEngine — billing gate (Slice 1N)", () => {
  it("aborts the run with BILLING_EXHAUSTED when the gate refuses, BEFORE invoking any handler", async () => {
    const t = trigger("t1");
    const a1 = action("a1", "step_one");
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: { nodes: [t, a1], edges: [edge("e1", "t1", "a1")] },
    });
    const handler = jest.fn();
    mockGetActionHandler.mockReturnValueOnce(handler);
    mockBillingGate.mockResolvedValueOnce({
      ok: false,
      reason: "limit_reached",
      used: 100,
      limit: 100,
    });

    const result = await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });

    expect(result.status).toBe("failed");
    expect(result.fatalError?.code).toBe("BILLING_EXHAUSTED");
    expect(result.fatalError?.message).toMatch(/100\/100/);
    expect(result.steps).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
    expect(mockBillingGate).toHaveBeenCalledWith("user-1");
  });

  it("persists the failed run with humanized BILLING_EXHAUSTED classification (action=upgrade_plan)", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: { nodes: [trigger("t1")], edges: [] },
    });
    mockBillingGate.mockResolvedValueOnce({
      ok: false,
      reason: "limit_reached",
      used: 100,
      limit: 100,
    });

    await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });

    expect(mockRecordRun).toHaveBeenCalledTimes(1);
    const call = mockRecordRun.mock.calls[0]![0] as {
      status: string;
      fatalError: { code: string };
      errorClassification: { title: string; action?: string; severity: string };
    };
    expect(call.status).toBe("failed");
    expect(call.fatalError.code).toBe("BILLING_EXHAUSTED");
    expect(call.errorClassification.action).toBe("upgrade_plan");
    expect(call.errorClassification.severity).toBe("warning");
  });

  it("proceeds with the run when the gate returns ok=true", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: {
        nodes: [trigger("t1"), action("a1", "step_one")],
        edges: [edge("e1", "t1", "a1")],
      },
    });
    const handler = jest.fn(async () => ({ output: { ok: true } }));
    mockGetActionHandler.mockReturnValueOnce(handler);
    mockBillingGate.mockResolvedValueOnce({ ok: true, used: 5, limit: 100 });

    const result = await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });

    expect(result.status).toBe("succeeded");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does NOT call the gate when the workflow itself is missing (no userId to attribute)", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce(null);
    await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "missing",
      triggerNodeId: "t1",
      triggerEvent,
    });
    expect(mockBillingGate).not.toHaveBeenCalled();
  });

  it("does NOT call the gate when the trigger node is missing (structural failure unrelated to quota)", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: { nodes: [trigger("t1")], edges: [] },
    });
    await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "ghost",
      triggerEvent,
    });
    expect(mockBillingGate).not.toHaveBeenCalled();
  });
});

describe("WorkflowEngine — failure notifications (Slice 1)", () => {
  it("inserts a workflow_failed notification on failed runs with humanized title forwarded", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: {
        nodes: [trigger("t1"), action("a1", "step", { channel: "{{trigger.unknown}}" })],
        edges: [edge("e1", "t1", "a1")],
      },
    });
    mockGetActionHandler.mockReturnValueOnce(jest.fn());
    const resolveStrict = jest.fn(() => {
      throw new MissingVariableError("trigger.unknown", "missing_field");
    });

    await new WorkflowEngine({ resolveStrict }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });

    expect(mockNotifyWorkflowFailure).toHaveBeenCalledTimes(1);
    const call = mockNotifyWorkflowFailure.mock.calls[0]![0] as {
      userId: string;
      workflowId: string;
      runId: string;
      errorClassification: { title: string; severity: string };
    };
    expect(call.userId).toBe("user-1");
    expect(call.workflowId).toBe("wf-1");
    expect(call.errorClassification.title).toMatch(/variable/i);
    expect(call.errorClassification.severity).toBe("error");
  });

  it("does NOT notify on successful runs (only failure surfaces are notification-worthy in Slice 1)", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: {
        nodes: [trigger("t1"), action("a1", "step")],
        edges: [edge("e1", "t1", "a1")],
      },
    });
    mockGetActionHandler.mockReturnValueOnce(async () => ({ output: { ok: true } }));
    await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });
    expect(mockNotifyWorkflowFailure).not.toHaveBeenCalled();
  });

  it("does NOT notify when there is no userId to attribute (workflow missing)", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce(null);
    await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "missing",
      triggerNodeId: "t1",
      triggerEvent,
    });
    expect(mockNotifyWorkflowFailure).not.toHaveBeenCalled();
  });

  it("notification failure is swallowed — engine still completes the run", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: { nodes: [trigger("t1")], edges: [] },
    });
    // Trigger-node-not-found → fatal → notification path runs
    mockNotifyWorkflowFailure.mockRejectedValueOnce(new Error("notif DB down"));
    const result = await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "ghost",
      triggerEvent,
    });
    expect(result.fatalError?.code).toBe("TRIGGER_NODE_NOT_FOUND");
    // Engine returned cleanly despite the notification crash.
  });

  it("notifies on BILLING_EXHAUSTED fatal too (gate refusal is still a failed run users should know about)", async () => {
    mockGetByIdServiceRole.mockResolvedValueOnce({
      ...baseWorkflow,
      draftDefinition: { nodes: [trigger("t1")], edges: [] },
    });
    mockBillingGate.mockResolvedValueOnce({
      ok: false,
      reason: "limit_reached",
      used: 100,
      limit: 100,
    });
    await new WorkflowEngine({ resolveStrict: (v) => v }).runWorkflow({
      workflowId: "wf-1",
      triggerNodeId: "t1",
      triggerEvent,
    });
    expect(mockNotifyWorkflowFailure).toHaveBeenCalledTimes(1);
    const call = mockNotifyWorkflowFailure.mock.calls[0]![0] as {
      errorClassification: { action?: string; severity: string };
    };
    expect(call.errorClassification.action).toBe("upgrade_plan");
  });
});
