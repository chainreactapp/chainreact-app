import {
  WorkflowStateSchema,
  WorkflowDisabledReasonSchema,
  WorkflowDefinitionSchema,
} from "@/contracts/workflow";

describe("WorkflowStateSchema", () => {
  it("accepts every state in the locked six-state set", () => {
    for (const s of [
      "draft",
      "active",
      "paused",
      "disabled",
      "eligible_to_resume",
      "deleted",
    ]) {
      expect(WorkflowStateSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects archived (V2 does not support archive initially)", () => {
    expect(WorkflowStateSchema.safeParse("archived").success).toBe(false);
  });

  it("rejects unknown states", () => {
    expect(WorkflowStateSchema.safeParse("ACTIVE").success).toBe(false);
    expect(WorkflowStateSchema.safeParse("running").success).toBe(false);
  });
});

describe("WorkflowDisabledReasonSchema", () => {
  it("accepts the four locked reasons", () => {
    for (const r of [
      "integration_revoked",
      "billing_exhausted",
      "repeated_failure",
      "manual_admin",
    ]) {
      expect(WorkflowDisabledReasonSchema.safeParse(r).success).toBe(true);
    }
  });

  it("rejects free-text reasons", () => {
    expect(WorkflowDisabledReasonSchema.safeParse("user_paused").success).toBe(false);
    expect(WorkflowDisabledReasonSchema.safeParse("").success).toBe(false);
  });
});

describe("WorkflowDefinitionSchema", () => {
  it("accepts an empty definition with default nodes/edges", () => {
    const r = WorkflowDefinitionSchema.parse({});
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
  });

  it("rejects unstructured nodes from the pre-1I opaque era", () => {
    const result = WorkflowDefinitionSchema.safeParse({
      nodes: [{ id: "n1" }],
      edges: [],
    });
    expect(result.success).toBe(false);
  });
});
