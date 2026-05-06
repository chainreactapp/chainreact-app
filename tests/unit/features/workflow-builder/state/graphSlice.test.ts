/**
 * @jest-environment node
 *
 * Tests for features/workflow-builder/state/graphSlice.
 *
 * The slice is the single source of truth for the builder's nodes/edges/dirty
 * state. Tests cover the workflow-state-store rule's required cases:
 *   - hydrate replaces state cleanly
 *   - reset returns to initial
 *   - each action transitions state correctly
 *   - save reconciles saved* with the typed-client response
 *   - save error keeps pending* intact and surfaces saveError
 *
 * Mocks `lib/api/workflows.updateWorkflow` so the test never touches network.
 */

const mockUpdateWorkflow = jest.fn();
jest.mock("@/lib/api/workflows", () => {
  const actual = jest.requireActual("@/lib/api/workflows");
  return {
    ...actual,
    updateWorkflow: (...args: unknown[]) => mockUpdateWorkflow(...args),
  };
});

import { useGraphSlice } from "@/features/workflow-builder/state/graphSlice";
import { WorkflowApiError } from "@/lib/api/workflows";
import type { WorkflowDefinition } from "@/contracts/workflow";

const EMPTY_DEF: WorkflowDefinition = { nodes: [], edges: [] };

const TRIGGER_DEF: WorkflowDefinition = {
  nodes: [
    {
      id: "t1",
      kind: "trigger",
      provider: "slack",
      type: "message_received",
      config: {},
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
};

beforeEach(() => {
  mockUpdateWorkflow.mockReset();
  useGraphSlice.getState().reset();
});

describe("graphSlice — initial + hydrate + reset", () => {
  it("starts with the documented initial shape", () => {
    const s = useGraphSlice.getState();
    expect(s.workflowId).toBeNull();
    expect(s.isHydrated).toBe(false);
    expect(s.savedNodes).toEqual([]);
    expect(s.pendingNodes).toEqual([]);
    expect(s.isDirty).toBe(false);
    expect(s.isSaving).toBe(false);
    expect(s.saveError).toBeNull();
  });

  it("hydrate populates saved + pending and marks isHydrated", () => {
    useGraphSlice.getState().hydrate("wf-1", TRIGGER_DEF);
    const s = useGraphSlice.getState();
    expect(s.workflowId).toBe("wf-1");
    expect(s.isHydrated).toBe(true);
    expect(s.savedNodes).toEqual(TRIGGER_DEF.nodes);
    expect(s.pendingNodes).toEqual(TRIGGER_DEF.nodes);
    expect(s.isDirty).toBe(false);
  });

  it("reset clears everything back to initial", () => {
    useGraphSlice.getState().hydrate("wf-1", TRIGGER_DEF);
    useGraphSlice.getState().reset();
    const s = useGraphSlice.getState();
    expect(s.workflowId).toBeNull();
    expect(s.isHydrated).toBe(false);
    expect(s.pendingNodes).toEqual([]);
  });
});

describe("graphSlice.addTrigger", () => {
  it("adds a trigger node and marks dirty", () => {
    useGraphSlice.getState().hydrate("wf-1", EMPTY_DEF);
    const node = useGraphSlice.getState().addTrigger({ provider: "slack" });
    const s = useGraphSlice.getState();
    expect(s.pendingNodes).toHaveLength(1);
    expect(s.pendingNodes[0]).toMatchObject({
      kind: "trigger",
      provider: "slack",
      type: "",
      config: {},
    });
    expect(s.pendingNodes[0]?.id).toBe(node.id);
    expect(s.isDirty).toBe(true);
  });

  it("rejects a second trigger when one already exists", () => {
    useGraphSlice.getState().hydrate("wf-1", TRIGGER_DEF);
    expect(() =>
      useGraphSlice.getState().addTrigger({ provider: "gmail" }),
    ).toThrow(/already has a trigger/i);
    // No state mutation on rejection.
    expect(useGraphSlice.getState().pendingNodes).toHaveLength(1);
    expect(useGraphSlice.getState().isDirty).toBe(false);
  });
});

describe("graphSlice.addAction", () => {
  it("appends an action and stitches an edge from the previous tail", () => {
    useGraphSlice.getState().hydrate("wf-1", TRIGGER_DEF);
    const action = useGraphSlice.getState().addAction({ provider: "slack" });
    const s = useGraphSlice.getState();
    expect(s.pendingNodes).toHaveLength(2);
    expect(s.pendingNodes[1]).toMatchObject({
      kind: "action",
      provider: "slack",
      type: "",
    });
    expect(s.pendingEdges).toHaveLength(1);
    expect(s.pendingEdges[0]).toMatchObject({
      from: "t1",
      to: action.id,
    });
    expect(s.isDirty).toBe(true);
  });

  it("refuses to add an action before a trigger exists", () => {
    useGraphSlice.getState().hydrate("wf-1", EMPTY_DEF);
    expect(() =>
      useGraphSlice.getState().addAction({ provider: "slack" }),
    ).toThrow(/trigger/i);
    expect(useGraphSlice.getState().pendingNodes).toHaveLength(0);
  });
});

describe("graphSlice.removeNode", () => {
  it("removes the node and its connected edges; dirty flips on", () => {
    useGraphSlice.getState().hydrate("wf-1", TRIGGER_DEF);
    const action = useGraphSlice.getState().addAction({ provider: "slack" });
    // Sanity check: edge exists.
    expect(useGraphSlice.getState().pendingEdges).toHaveLength(1);
    useGraphSlice.getState().removeNode(action.id);
    const s = useGraphSlice.getState();
    expect(s.pendingNodes.find((n) => n.id === action.id)).toBeUndefined();
    expect(
      s.pendingEdges.find((e) => e.from === action.id || e.to === action.id),
    ).toBeUndefined();
    expect(s.isDirty).toBe(true);
  });

  it("no-op on unknown id (does not flip dirty)", () => {
    useGraphSlice.getState().hydrate("wf-1", TRIGGER_DEF);
    useGraphSlice.getState().removeNode("ghost");
    expect(useGraphSlice.getState().isDirty).toBe(false);
    expect(useGraphSlice.getState().pendingNodes).toHaveLength(1);
  });
});

describe("graphSlice.save", () => {
  it("calls updateWorkflow with the pending definition and reconciles saved* on success", async () => {
    useGraphSlice.getState().hydrate("wf-1", EMPTY_DEF);
    useGraphSlice.getState().addTrigger({ provider: "slack" });
    const pending = useGraphSlice.getState().pendingNodes;
    mockUpdateWorkflow.mockResolvedValueOnce({
      id: "wf-1",
      name: "x",
      state: "draft",
      disabledReason: null,
      disabledContext: null,
      activeRevisionId: null,
      draftDefinition: { nodes: pending, edges: [] },
      deletedAt: null,
      createdAt: "2026-05-06T00:00:00Z",
      updatedAt: "2026-05-06T00:01:00Z",
    });

    await useGraphSlice.getState().save();

    expect(mockUpdateWorkflow).toHaveBeenCalledWith(
      "wf-1",
      expect.objectContaining({
        draftDefinition: expect.objectContaining({ nodes: pending, edges: [] }),
      }),
    );
    const s = useGraphSlice.getState();
    expect(s.savedNodes).toEqual(pending);
    expect(s.isDirty).toBe(false);
    expect(s.isSaving).toBe(false);
    expect(s.saveError).toBeNull();
  });

  it("captures WorkflowApiError into saveError; pending* untouched", async () => {
    useGraphSlice.getState().hydrate("wf-1", EMPTY_DEF);
    useGraphSlice.getState().addTrigger({ provider: "slack" });
    const before = useGraphSlice.getState().pendingNodes;
    mockUpdateWorkflow.mockRejectedValueOnce(
      new WorkflowApiError("saved elsewhere", "LIFECYCLE_CONFLICT", 409),
    );

    await expect(useGraphSlice.getState().save()).rejects.toThrow(
      /saved elsewhere/,
    );
    const s = useGraphSlice.getState();
    expect(s.isSaving).toBe(false);
    expect(s.saveError).toBe("saved elsewhere");
    expect(s.isDirty).toBe(true); // user's edits preserved
    expect(s.pendingNodes).toEqual(before);
  });

  it("uses generic message for non-WorkflowApiError failures", async () => {
    useGraphSlice.getState().hydrate("wf-1", EMPTY_DEF);
    useGraphSlice.getState().addTrigger({ provider: "slack" });
    mockUpdateWorkflow.mockRejectedValueOnce(new Error("network"));

    await expect(useGraphSlice.getState().save()).rejects.toThrow();
    expect(useGraphSlice.getState().saveError).toMatch(/failed to save/i);
  });

  it("throws when called before hydrate (programmer error guard)", async () => {
    await expect(useGraphSlice.getState().save()).rejects.toThrow(
      /before hydrate/i,
    );
  });

  it("single-flights concurrent saves (second call is a no-op)", async () => {
    useGraphSlice.getState().hydrate("wf-1", EMPTY_DEF);
    useGraphSlice.getState().addTrigger({ provider: "slack" });
    let resolveCall: (v: unknown) => void = () => {};
    mockUpdateWorkflow.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCall = resolve;
        }),
    );

    const p1 = useGraphSlice.getState().save();
    const p2 = useGraphSlice.getState().save();
    expect(mockUpdateWorkflow).toHaveBeenCalledTimes(1);
    resolveCall({
      draftDefinition: { nodes: useGraphSlice.getState().pendingNodes, edges: [] },
    });
    await Promise.all([p1, p2]);
  });
});
