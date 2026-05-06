/**
 * @jest-environment node
 *
 * Tests for repositories/triggerResources.ts.
 *
 * The repo has two callers — the trigger lifecycle service (SSR-cookie auth
 * for user-scoped writes) and the webhook dispatcher (service-role for
 * provider-scoped reads). Both paths are mocked here so the test never
 * touches the network.
 */

interface ChainState {
  insertPayload?: unknown;
  upsertOptions?: unknown;
  filters: Array<{ op: string; args: unknown[] }>;
  resultData: unknown;
  resultError: { message: string } | null;
}

function makeMockClient(state: ChainState) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: jest.fn(() => builder),
    upsert: jest.fn((payload: unknown, options: unknown) => {
      state.insertPayload = payload;
      state.upsertOptions = options;
      return builder;
    }),
    delete: jest.fn(() => builder),
    eq: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "eq", args: [col, val] });
      return builder;
    }),
    single: jest.fn(() =>
      Promise.resolve({ data: state.resultData, error: state.resultError }),
    ),
    // Supabase returns a thenable from terminal builder ops too (.delete()
    // / .select() that aren't .single()). Make the chain awaitable.
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: state.resultData, error: state.resultError }),
  });
  return { from: jest.fn(() => builder), state };
}

const mockSupabase: { current: ReturnType<typeof makeMockClient> | null } = { current: null };
const mockServiceRole: { current: ReturnType<typeof makeMockClient> | null } = { current: null };

jest.mock("@/utils/supabase/server", () => ({
  createClient: jest.fn(async () => mockSupabase.current),
}));

jest.mock("@/repositories/supabase/serviceRoleClient", () => ({
  getServiceRoleClient: jest.fn(() => mockServiceRole.current),
}));

import {
  upsert,
  deleteByWorkflow,
  listByWorkflow,
  listForDispatch,
} from "@/repositories/triggerResources";

const baseRow = {
  id: "tr-1",
  workflow_id: "wf-1",
  user_id: "user-1",
  provider: "slack",
  event_type: "message_received",
  node_id: "n1",
  config: { channelId: "C123" },
  account_id: "T0001",
  registered_at: "2026-05-07T00:00:00Z",
  expires_at: null,
  last_renewed_at: null,
  created_at: "2026-05-07T00:00:00Z",
  updated_at: "2026-05-07T00:00:00Z",
};

function freshState(resultData: unknown = baseRow): ChainState {
  return { filters: [], resultData, resultError: null };
}

describe("trigger_resources.upsert", () => {
  it("upserts on the (workflow_id, node_id) conflict target", async () => {
    const state = freshState(baseRow);
    mockSupabase.current = makeMockClient(state);
    const result = await upsert({
      workflowId: "wf-1",
      userId: "user-1",
      provider: "slack",
      eventType: "message_received",
      nodeId: "n1",
      config: { channelId: "C123" },
      accountId: "T0001",
    });
    expect(result.id).toBe("tr-1");
    expect(state.insertPayload).toEqual({
      workflow_id: "wf-1",
      user_id: "user-1",
      provider: "slack",
      event_type: "message_received",
      node_id: "n1",
      config: { channelId: "C123" },
      account_id: "T0001",
      expires_at: null,
      last_renewed_at: null,
    });
    expect(state.upsertOptions).toMatchObject({ onConflict: "workflow_id,node_id" });
  });

  it("defaults config + account_id + expires_at to safe nulls", async () => {
    const state = freshState(baseRow);
    mockSupabase.current = makeMockClient(state);
    await upsert({
      workflowId: "wf-1",
      userId: "user-1",
      provider: "slack",
      eventType: "message_received",
      nodeId: "n1",
    });
    expect(state.insertPayload).toMatchObject({
      config: {},
      account_id: null,
      expires_at: null,
    });
  });
});

describe("trigger_resources.deleteByWorkflow", () => {
  it("deletes all rows for the workflow id", async () => {
    const state = freshState(null);
    mockSupabase.current = makeMockClient(state);
    await deleteByWorkflow("wf-1");
    expect(state.filters).toContainEqual({ op: "eq", args: ["workflow_id", "wf-1"] });
  });
});

describe("trigger_resources.listByWorkflow", () => {
  it("returns the rows for the workflow id", async () => {
    const state = freshState([baseRow, { ...baseRow, id: "tr-2", node_id: "n2" }]);
    mockSupabase.current = makeMockClient(state);
    const result = await listByWorkflow("wf-1");
    expect(result.map((r) => r.id)).toEqual(["tr-1", "tr-2"]);
    expect(state.filters).toContainEqual({ op: "eq", args: ["workflow_id", "wf-1"] });
  });
});

describe("trigger_resources.listForDispatch", () => {
  it("uses the service-role client and filters on (provider, event_type)", async () => {
    const state = freshState([baseRow]);
    mockServiceRole.current = makeMockClient(state);
    const result = await listForDispatch("slack", "message_received");
    expect(result).toHaveLength(1);
    expect(state.filters).toContainEqual({ op: "eq", args: ["provider", "slack"] });
    expect(state.filters).toContainEqual({
      op: "eq",
      args: ["event_type", "message_received"],
    });
  });
});
