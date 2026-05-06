import {
  EMPTY_WORKFLOW_DEFINITION,
  WorkflowDefinitionSchema,
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
} from "@/contracts/workflowDefinition";

describe("WorkflowNodeSchema", () => {
  const valid = {
    id: "n1",
    kind: "trigger",
    provider: "slack",
    type: "message_received",
    config: { channelId: "C123" },
    position: { x: 0, y: 0 },
  };

  it("accepts a fully-specified node", () => {
    expect(WorkflowNodeSchema.safeParse(valid).success).toBe(true);
  });

  it("defaults config + position when omitted", () => {
    const r = WorkflowNodeSchema.parse({
      id: "n1",
      kind: "action",
      provider: "slack",
      type: "send_channel_message",
    });
    expect(r.config).toEqual({});
    expect(r.position).toEqual({ x: 0, y: 0 });
  });

  it("allows empty `type` (transient — node added but action not yet picked)", () => {
    expect(
      WorkflowNodeSchema.safeParse({
        id: "n1",
        kind: "action",
        provider: "slack",
        type: "",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown node kinds (logic deferred to a later slice)", () => {
    expect(
      WorkflowNodeSchema.safeParse({ ...valid, kind: "logic" }).success,
    ).toBe(false);
  });

  it("rejects an empty id", () => {
    expect(WorkflowNodeSchema.safeParse({ ...valid, id: "" }).success).toBe(false);
  });

  it("rejects a non-finite position coordinate", () => {
    expect(
      WorkflowNodeSchema.safeParse({
        ...valid,
        position: { x: Number.POSITIVE_INFINITY, y: 0 },
      }).success,
    ).toBe(false);
  });
});

describe("WorkflowEdgeSchema", () => {
  it("accepts a valid edge", () => {
    expect(
      WorkflowEdgeSchema.safeParse({ id: "e1", from: "n1", to: "n2" }).success,
    ).toBe(true);
  });

  it("rejects an edge with an empty endpoint", () => {
    expect(
      WorkflowEdgeSchema.safeParse({ id: "e1", from: "", to: "n2" }).success,
    ).toBe(false);
  });
});

describe("WorkflowDefinitionSchema", () => {
  function trigger(id: string) {
    return {
      id,
      kind: "trigger" as const,
      provider: "slack",
      type: "message_received",
      config: {},
      position: { x: 0, y: 0 },
    };
  }
  function action(id: string) {
    return {
      id,
      kind: "action" as const,
      provider: "slack",
      type: "send_channel_message",
      config: {},
      position: { x: 0, y: 100 },
    };
  }

  it("EMPTY_WORKFLOW_DEFINITION parses cleanly", () => {
    expect(WorkflowDefinitionSchema.safeParse(EMPTY_WORKFLOW_DEFINITION).success).toBe(true);
  });

  it("accepts a definition with one trigger and a chain of actions", () => {
    const def = {
      nodes: [trigger("n1"), action("n2"), action("n3")],
      edges: [
        { id: "e1", from: "n1", to: "n2" },
        { id: "e2", from: "n2", to: "n3" },
      ],
    };
    expect(WorkflowDefinitionSchema.safeParse(def).success).toBe(true);
  });

  it("rejects more than one trigger node", () => {
    const def = {
      nodes: [trigger("n1"), trigger("n2")],
      edges: [],
    };
    const result = WorkflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/at most one trigger/);
    }
  });

  it("rejects edges that reference unknown nodes", () => {
    const def = {
      nodes: [trigger("n1")],
      edges: [{ id: "e1", from: "n1", to: "ghost" }],
    };
    const result = WorkflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("unknown node 'ghost'"))).toBe(true);
    }
  });

  it("rejects self-loop edges", () => {
    const def = {
      nodes: [trigger("n1")],
      edges: [{ id: "e1", from: "n1", to: "n1" }],
    };
    const result = WorkflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("self-loop"))).toBe(true);
    }
  });

  it("rejects duplicate edges between the same node pair", () => {
    const def = {
      nodes: [trigger("n1"), action("n2")],
      edges: [
        { id: "e1", from: "n1", to: "n2" },
        { id: "e2", from: "n1", to: "n2" },
      ],
    };
    const result = WorkflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message.includes("Duplicate edge")),
      ).toBe(true);
    }
  });

  it("rejects duplicate node ids", () => {
    const def = {
      nodes: [trigger("n1"), action("n1")],
      edges: [],
    };
    const result = WorkflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message.includes("Duplicate node id")),
      ).toBe(true);
    }
  });
});
