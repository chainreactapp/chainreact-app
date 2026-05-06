/**
 * @jest-environment node
 *
 * Tests for repositories/workflows.ts. Mocks the Supabase SSR client and
 * verifies row-to-record translation, insert payload shape, and that listByUser
 * filters out deleted by default.
 */

const baseRow = {
  id: "wf-1",
  user_id: "user-1",
  name: "My workflow",
  state: "draft" as const,
  disabled_reason: null,
  disabled_context: null,
  active_revision_id: null,
  draft_definition: { nodes: [], edges: [] },
  deleted_at: null,
  created_at: "2026-05-06T13:00:00Z",
  updated_at: "2026-05-06T13:00:00Z",
};

interface ChainState {
  filters: Array<{ op: string; args: unknown[] }>;
  insertPayload?: unknown;
  updatePayload?: unknown;
  resultData: unknown;
  resultError: { message: string } | null;
  rejectIncludesDeleted: boolean;
}

function makeMockClient(state: ChainState) {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(() => builder),
    insert: jest.fn((payload) => {
      state.insertPayload = payload;
      return builder;
    }),
    update: jest.fn((payload) => {
      state.updatePayload = payload;
      return builder;
    }),
    eq: jest.fn((col, val) => {
      state.filters.push({ op: "eq", args: [col, val] });
      return builder;
    }),
    neq: jest.fn((col, val) => {
      state.filters.push({ op: "neq", args: [col, val] });
      return builder;
    }),
    is: jest.fn(() => builder),
    order: jest.fn(() => Promise.resolve({ data: state.resultData, error: state.resultError })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: state.resultData, error: state.resultError })),
    single: jest.fn(() => Promise.resolve({ data: state.resultData, error: state.resultError })),
  };
  return { from: jest.fn(() => builder), state };
}

const mockSupabase: { current: ReturnType<typeof makeMockClient> | null } = { current: null };

jest.mock("@/utils/supabase/server", () => ({
  createClient: jest.fn(async () => mockSupabase.current),
}));

import {
  create,
  getById,
  listByUser,
  updateName,
  updateDraftDefinition,
  createRevision,
  setActiveRevision,
  applyTransition,
} from "@/repositories/workflows";

function freshState(resultData: unknown = baseRow): ChainState {
  return {
    filters: [],
    resultData,
    resultError: null,
    rejectIncludesDeleted: false,
  };
}

describe("repositories/workflows.create", () => {
  it("inserts a row with the user_id, name, and default empty definition", async () => {
    const state = freshState(baseRow);
    mockSupabase.current = makeMockClient(state);
    const result = await create({ userId: "user-1", name: "My workflow" });
    expect(state.insertPayload).toEqual({
      user_id: "user-1",
      name: "My workflow",
      draft_definition: { nodes: [], edges: [] },
    });
    expect(result.id).toBe("wf-1");
    expect(result.state).toBe("draft");
    expect(result.draftDefinition).toEqual({ nodes: [], edges: [] });
  });

  it("accepts an explicit draftDefinition", async () => {
    const state = freshState(baseRow);
    mockSupabase.current = makeMockClient(state);
    const def = {
      nodes: [
        {
          id: "n1",
          kind: "trigger" as const,
          provider: "slack",
          type: "message_received",
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };
    await create({ userId: "user-1", name: "X", draftDefinition: def });
    expect((state.insertPayload as { draft_definition: unknown }).draft_definition).toEqual(def);
  });
});

describe("repositories/workflows.getById", () => {
  it("returns the record when found", async () => {
    const state = freshState(baseRow);
    mockSupabase.current = makeMockClient(state);
    const result = await getById("wf-1");
    expect(result?.id).toBe("wf-1");
    expect(state.filters).toContainEqual({ op: "eq", args: ["id", "wf-1"] });
  });

  it("returns null when no row exists", async () => {
    const state = freshState(null);
    mockSupabase.current = makeMockClient(state);
    const result = await getById("missing");
    expect(result).toBeNull();
  });
});

describe("repositories/workflows.listByUser", () => {
  it("filters by user_id and excludes deleted by default", async () => {
    const state = freshState([baseRow]);
    mockSupabase.current = makeMockClient(state);
    await listByUser("user-1");
    expect(state.filters).toContainEqual({ op: "eq", args: ["user_id", "user-1"] });
    expect(state.filters).toContainEqual({ op: "neq", args: ["state", "deleted"] });
  });

  it("includes deleted when opts.includeDeleted=true", async () => {
    const state = freshState([baseRow]);
    mockSupabase.current = makeMockClient(state);
    await listByUser("user-1", { includeDeleted: true });
    expect(state.filters).toContainEqual({ op: "eq", args: ["user_id", "user-1"] });
    expect(state.filters.find((f) => f.op === "neq" && f.args[0] === "state")).toBeUndefined();
  });

  it("returns the records sorted by updated_at desc (delegated to .order)", async () => {
    const newer = { ...baseRow, id: "wf-2", updated_at: "2026-05-06T14:00:00Z" };
    const state = freshState([newer, baseRow]);
    mockSupabase.current = makeMockClient(state);
    const result = await listByUser("user-1");
    expect(result.map((r) => r.id)).toEqual(["wf-2", "wf-1"]);
  });
});

describe("repositories/workflows.updateName", () => {
  it("updates only the name column", async () => {
    const state = freshState({ ...baseRow, name: "Renamed" });
    mockSupabase.current = makeMockClient(state);
    const result = await updateName("wf-1", "Renamed");
    expect(state.updatePayload).toEqual({ name: "Renamed" });
    expect(result.name).toBe("Renamed");
  });
});

describe("repositories/workflows.updateDraftDefinition", () => {
  it("writes the full definition to draft_definition", async () => {
    const def = {
      nodes: [
        {
          id: "n1",
          kind: "trigger" as const,
          provider: "slack",
          type: "message_received",
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };
    const state = freshState({ ...baseRow, draft_definition: def });
    mockSupabase.current = makeMockClient(state);
    await updateDraftDefinition("wf-1", def);
    expect(state.updatePayload).toEqual({ draft_definition: def });
  });
});

describe("repositories/workflows.createRevision + setActiveRevision", () => {
  it("createRevision inserts an immutable snapshot", async () => {
    const def = {
      nodes: [
        {
          id: "n1",
          kind: "trigger" as const,
          provider: "slack",
          type: "message_received",
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };
    const state = freshState({
      id: "rev-1",
      workflow_id: "wf-1",
      user_id: "user-1",
      definition: def,
      created_at: "2026-05-06T13:30:00Z",
    });
    mockSupabase.current = makeMockClient(state);
    const result = await createRevision({
      workflowId: "wf-1",
      userId: "user-1",
      definition: def,
    });
    expect(state.insertPayload).toEqual({
      workflow_id: "wf-1",
      user_id: "user-1",
      definition: def,
    });
    expect(result.id).toBe("rev-1");
    expect(result.definition).toEqual(def);
  });

  it("setActiveRevision updates only active_revision_id", async () => {
    const state = freshState({ ...baseRow, active_revision_id: "rev-1" });
    mockSupabase.current = makeMockClient(state);
    const result = await setActiveRevision("wf-1", "rev-1");
    expect(state.updatePayload).toEqual({ active_revision_id: "rev-1" });
    expect(result.activeRevisionId).toBe("rev-1");
  });
});

describe("repositories/workflows.applyTransition", () => {
  it("filters by id AND expectedFromState (optimistic concurrency)", async () => {
    const state = freshState({ ...baseRow, state: "active" });
    mockSupabase.current = makeMockClient(state);
    await applyTransition({
      workflowId: "wf-1",
      expectedFromState: "draft",
      toState: "active",
      disabledReason: null,
      disabledContext: null,
    });
    expect(state.filters).toContainEqual({ op: "eq", args: ["id", "wf-1"] });
    expect(state.filters).toContainEqual({ op: "eq", args: ["state", "draft"] });
    expect(state.updatePayload).toEqual({
      state: "active",
      disabled_reason: null,
      disabled_context: null,
    });
  });

  it("returns null when maybeSingle returns no row (concurrent transition lost)", async () => {
    const state = freshState(null);
    mockSupabase.current = makeMockClient(state);
    const result = await applyTransition({
      workflowId: "wf-1",
      expectedFromState: "draft",
      toState: "active",
    });
    expect(result).toBeNull();
  });

  it("omits disabled_* columns when not provided (preserves history)", async () => {
    const state = freshState({ ...baseRow, state: "eligible_to_resume" });
    mockSupabase.current = makeMockClient(state);
    await applyTransition({
      workflowId: "wf-1",
      expectedFromState: "disabled",
      toState: "eligible_to_resume",
    });
    expect(state.updatePayload).toEqual({ state: "eligible_to_resume" });
  });

  it("writes the disable reason + context when transitioning to disabled", async () => {
    const state = freshState({
      ...baseRow,
      state: "disabled",
      disabled_reason: "integration_revoked",
      disabled_context: "Slack token revoked",
    });
    mockSupabase.current = makeMockClient(state);
    await applyTransition({
      workflowId: "wf-1",
      expectedFromState: "active",
      toState: "disabled",
      disabledReason: "integration_revoked",
      disabledContext: "Slack token revoked",
    });
    expect(state.updatePayload).toEqual({
      state: "disabled",
      disabled_reason: "integration_revoked",
      disabled_context: "Slack token revoked",
    });
  });

  it("sets deleted_at when setDeletedAt: true", async () => {
    const state = freshState({
      ...baseRow,
      state: "deleted",
      deleted_at: "2026-05-06T01:00:00Z",
    });
    mockSupabase.current = makeMockClient(state);
    await applyTransition({
      workflowId: "wf-1",
      expectedFromState: "active",
      toState: "deleted",
      setDeletedAt: true,
    });
    const payload = state.updatePayload as Record<string, unknown>;
    expect(payload.state).toBe("deleted");
    expect(typeof payload.deleted_at).toBe("string");
  });

  it("propagates supabase errors", async () => {
    const state: ChainState = {
      filters: [],
      resultData: null,
      resultError: { message: "permission denied" },
      rejectIncludesDeleted: false,
    };
    mockSupabase.current = makeMockClient(state);
    await expect(
      applyTransition({
        workflowId: "wf-1",
        expectedFromState: "draft",
        toState: "active",
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
