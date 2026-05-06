/**
 * @jest-environment node
 *
 * Tests for repositories/userBilling.ts.
 *
 * Mocks both the SSR-cookie + service-role clients to exercise the two
 * code paths (deductTasks via service role + RPC, getUsage via SSR
 * cookie + RLS).
 */

interface ChainState {
  filters: Array<{ op: string; args: unknown[] }>;
  resultData: unknown;
  resultError: { message: string } | null;
}

function makeMockSelectClient(state: ChainState) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: jest.fn(() => builder),
    eq: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "eq", args: [col, val] });
      return builder;
    }),
    maybeSingle: jest.fn(async () => ({
      data: state.resultData,
      error: state.resultError,
    })),
  });
  return { from: jest.fn(() => builder), state };
}

interface RpcState {
  calledWith?: { fn: string; params: unknown };
  resultData: unknown;
  resultError: { message: string } | null;
}

function makeMockRpcClient(state: RpcState) {
  return {
    rpc: jest.fn(async (fn: string, params: unknown) => {
      state.calledWith = { fn, params };
      return { data: state.resultData, error: state.resultError };
    }),
  };
}

const mockSSR: { current: ReturnType<typeof makeMockSelectClient> | null } = {
  current: null,
};
const mockServiceRole: { current: ReturnType<typeof makeMockRpcClient> | null } = {
  current: null,
};

jest.mock("@/utils/supabase/server", () => ({
  createClient: jest.fn(async () => mockSSR.current),
}));

jest.mock("@/repositories/supabase/serviceRoleClient", () => ({
  getServiceRoleClient: jest.fn(() => mockServiceRole.current),
}));

import { deductTasks, getUsage } from "@/repositories/userBilling";

describe("userBilling.deductTasks", () => {
  it("calls deduct_tasks_if_available with the user id + amount and unwraps ok=true", async () => {
    const state: RpcState = {
      resultData: { ok: true, used: 5, limit: 100 },
      resultError: null,
    };
    mockServiceRole.current = makeMockRpcClient(state);
    const result = await deductTasks("user-1", 1);
    expect(state.calledWith).toEqual({
      fn: "deduct_tasks_if_available",
      params: { p_user_id: "user-1", p_amount: 1 },
    });
    expect(result).toEqual({ ok: true, used: 5, limit: 100 });
  });

  it("unwraps ok=false (limit reached) preserving used + limit", async () => {
    const state: RpcState = {
      resultData: { ok: false, used: 100, limit: 100 },
      resultError: null,
    };
    mockServiceRole.current = makeMockRpcClient(state);
    const result = await deductTasks("user-1", 1);
    expect(result).toEqual({ ok: false, used: 100, limit: 100 });
  });

  it("propagates RPC errors with a clear message", async () => {
    const state: RpcState = {
      resultData: null,
      resultError: { message: "permission denied for function deduct_tasks_if_available" },
    };
    mockServiceRole.current = makeMockRpcClient(state);
    await expect(deductTasks("user-1", 1)).rejects.toThrow(
      /deduct_tasks_if_available RPC failed: permission denied/,
    );
  });
});

describe("userBilling.getUsage", () => {
  it("returns the usage shape when a row exists", async () => {
    const state: ChainState = {
      filters: [],
      resultData: {
        tasks_used: 7,
        tasks_limit: 100,
        period_started_at: "2026-05-07T00:00:00Z",
      },
      resultError: null,
    };
    mockSSR.current = makeMockSelectClient(state);
    const result = await getUsage("user-1");
    expect(result).toEqual({
      tasksUsed: 7,
      tasksLimit: 100,
      periodStartedAt: "2026-05-07T00:00:00Z",
    });
    expect(state.filters).toContainEqual({
      op: "eq",
      args: ["user_id", "user-1"],
    });
  });

  it("returns null when no row exists (RLS-blocked or fresh user)", async () => {
    const state: ChainState = {
      filters: [],
      resultData: null,
      resultError: null,
    };
    mockSSR.current = makeMockSelectClient(state);
    const result = await getUsage("user-1");
    expect(result).toBeNull();
  });

  it("propagates Supabase select errors", async () => {
    const state: ChainState = {
      filters: [],
      resultData: null,
      resultError: { message: "syntax error" },
    };
    mockSSR.current = makeMockSelectClient(state);
    await expect(getUsage("user-1")).rejects.toThrow(/syntax error/);
  });
});
