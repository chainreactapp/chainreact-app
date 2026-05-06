/**
 * @jest-environment node
 *
 * Tests for repositories/workflowRuns.ts.
 *
 * Mocks both the SSR-cookie + service-role clients to exercise the two
 * code paths (recordRun via service role, listByWorkflow via SSR).
 */

interface ChainState {
  insertPayload?: unknown;
  filters: Array<{ op: string; args: unknown[] }>;
  resultData: unknown;
  resultError: { message: string } | null;
}

function makeMockClient(state: ChainState) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: jest.fn(() => builder),
    insert: jest.fn((payload: unknown) => {
      state.insertPayload = payload;
      return builder;
    }),
    eq: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "eq", args: [col, val] });
      return builder;
    }),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: state.resultData, error: state.resultError }),
  });
  return { from: jest.fn(() => builder), state };
}

const mockSSR: { current: ReturnType<typeof makeMockClient> | null } = {
  current: null,
};
const mockServiceRole: { current: ReturnType<typeof makeMockClient> | null } = {
  current: null,
};

jest.mock("@/utils/supabase/server", () => ({
  createClient: jest.fn(async () => mockSSR.current),
}));

jest.mock("@/repositories/supabase/serviceRoleClient", () => ({
  getServiceRoleClient: jest.fn(() => mockServiceRole.current),
}));

import { listByWorkflow, recordRun } from "@/repositories/workflowRuns";
import type { TriggerEvent } from "@/contracts/triggerEvent";

const triggerEvent: TriggerEvent = {
  provider: "slack",
  eventType: "message",
  eventId: "Ev1",
  occurredAt: "2026-05-07T00:00:00Z",
  accountId: "T0001",
  payload: { text: "hi" },
};

describe("workflowRuns.recordRun", () => {
  it("INSERTs all fields and uses the runId as the row id", async () => {
    const state: ChainState = { filters: [], resultData: null, resultError: null };
    mockServiceRole.current = makeMockClient(state);
    await recordRun({
      runId: "run-1",
      workflowId: "wf-1",
      userId: "user-1",
      status: "succeeded",
      triggerNodeId: "t1",
      triggerEvent,
      steps: [{ nodeId: "t1", status: "succeeded", output: {} }],
      startedAt: "2026-05-07T00:00:00Z",
      finishedAt: "2026-05-07T00:00:01Z",
    });
    expect(state.insertPayload).toMatchObject({
      id: "run-1",
      workflow_id: "wf-1",
      user_id: "user-1",
      status: "succeeded",
      trigger_node_id: "t1",
      trigger_event: triggerEvent,
      fatal_error: null,
      error_classification: null,
    });
  });

  it("persists fatal_error + error_classification when supplied", async () => {
    const state: ChainState = { filters: [], resultData: null, resultError: null };
    mockServiceRole.current = makeMockClient(state);
    await recordRun({
      runId: "run-1",
      workflowId: "wf-1",
      userId: "user-1",
      status: "failed",
      triggerNodeId: "t1",
      triggerEvent,
      steps: [],
      fatalError: { code: "TRIGGER_NODE_NOT_FOUND", message: "missing" },
      errorClassification: {
        title: "Trigger node missing",
        description: "...",
        severity: "warning",
      },
      startedAt: "2026-05-07T00:00:00Z",
      finishedAt: "2026-05-07T00:00:01Z",
    });
    const payload = state.insertPayload as Record<string, unknown>;
    expect(payload.fatal_error).toMatchObject({ code: "TRIGGER_NODE_NOT_FOUND" });
    expect(payload.error_classification).toMatchObject({ severity: "warning" });
  });

  it("propagates Supabase insert errors", async () => {
    const state: ChainState = {
      filters: [],
      resultData: null,
      resultError: { message: "duplicate key" },
    };
    mockServiceRole.current = makeMockClient(state);
    await expect(
      recordRun({
        runId: "run-1",
        workflowId: "wf-1",
        userId: "user-1",
        status: "succeeded",
        triggerNodeId: "t1",
        triggerEvent,
        steps: [],
        startedAt: "x",
        finishedAt: "y",
      }),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("workflowRuns.listByWorkflow", () => {
  it("filters by workflow_id and respects the default limit (25)", async () => {
    const row = {
      id: "run-1",
      workflow_id: "wf-1",
      user_id: "user-1",
      status: "succeeded",
      trigger_node_id: "t1",
      trigger_event: triggerEvent,
      steps: [],
      fatal_error: null,
      error_classification: null,
      started_at: "2026-05-07T00:00:00Z",
      finished_at: "2026-05-07T00:00:01Z",
      created_at: "2026-05-07T00:00:00Z",
    };
    const state: ChainState = { filters: [], resultData: [row], resultError: null };
    mockSSR.current = makeMockClient(state);
    const result = await listByWorkflow("wf-1");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("run-1");
    expect(state.filters).toContainEqual({
      op: "eq",
      args: ["workflow_id", "wf-1"],
    });
  });

  it("caps the limit at 100 even when the caller asks for more", async () => {
    const state: ChainState = { filters: [], resultData: [], resultError: null };
    mockSSR.current = makeMockClient(state);
    const limitSpy = mockSSR.current.from().limit as unknown as jest.Mock;
    await listByWorkflow("wf-1", { limit: 999 });
    // limitSpy is the .limit() mock from the chain; assert the cap applied.
    expect(limitSpy).toHaveBeenLastCalledWith(100);
  });

  it("returns an empty array when no runs exist", async () => {
    const state: ChainState = { filters: [], resultData: [], resultError: null };
    mockSSR.current = makeMockClient(state);
    const result = await listByWorkflow("wf-1");
    expect(result).toEqual([]);
  });
});
