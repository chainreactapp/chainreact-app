/**
 * @jest-environment node
 *
 * Tests for repositories/workflowRuns.ts: claimNotificationFanout.
 *
 * The atomic claim is the dedup primitive that prevents the notification
 * fan-out from firing twice for the same run. Failure to win the claim
 * (someone else already updated the column) MUST return false cleanly so
 * the orchestrator skips silently.
 */

interface ChainState {
  filters: Array<{ op: string; args: unknown[] }>;
  updatePayload?: unknown;
  resultData: unknown;
  resultError: { message: string } | null;
}

function makeMockClient(state: ChainState) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    update: jest.fn((p: unknown) => {
      state.updatePayload = p;
      return builder;
    }),
    select: jest.fn(() => builder),
    eq: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "eq", args: [col, val] });
      return builder;
    }),
    is: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "is", args: [col, val] });
      return builder;
    }),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: state.resultData, error: state.resultError }),
  });
  return { from: jest.fn(() => builder), state };
}

const mockClient: { current: ReturnType<typeof makeMockClient> | null } = { current: null };

jest.mock("@/repositories/supabase/serviceRoleClient", () => ({
  getServiceRoleClient: jest.fn(() => mockClient.current),
}));

import { claimNotificationFanout } from "@/repositories/workflowRuns";

describe("workflowRuns.claimNotificationFanout", () => {
  it("returns true when the UPDATE matched a row (first claim wins)", async () => {
    const state: ChainState = {
      filters: [],
      resultData: [{ id: "run-1" }],
      resultError: null,
    };
    mockClient.current = makeMockClient(state);
    expect(await claimNotificationFanout("run-1")).toBe(true);
  });

  it("returns false when the UPDATE matched no rows (already claimed)", async () => {
    const state: ChainState = {
      filters: [],
      resultData: [],
      resultError: null,
    };
    mockClient.current = makeMockClient(state);
    expect(await claimNotificationFanout("run-1")).toBe(false);
  });

  it("returns false when data is null (Supabase edge — same semantic as empty)", async () => {
    const state: ChainState = {
      filters: [],
      resultData: null,
      resultError: null,
    };
    mockClient.current = makeMockClient(state);
    expect(await claimNotificationFanout("run-1")).toBe(false);
  });

  it("UPDATE filters by id AND error_notifications_sent_at IS NULL — that's the race-safety predicate", async () => {
    const state: ChainState = { filters: [], resultData: [{ id: "run-1" }], resultError: null };
    mockClient.current = makeMockClient(state);
    await claimNotificationFanout("run-1");
    expect(state.filters).toContainEqual({ op: "eq", args: ["id", "run-1"] });
    expect(state.filters).toContainEqual({
      op: "is",
      args: ["error_notifications_sent_at", null],
    });
  });

  it("UPDATE payload sets error_notifications_sent_at to a fresh ISO timestamp", async () => {
    const state: ChainState = { filters: [], resultData: [{ id: "run-1" }], resultError: null };
    mockClient.current = makeMockClient(state);
    const before = new Date().toISOString();
    await claimNotificationFanout("run-1");
    const after = new Date().toISOString();
    const payload = state.updatePayload as { error_notifications_sent_at: string };
    expect(payload.error_notifications_sent_at).toBeDefined();
    expect(payload.error_notifications_sent_at >= before).toBe(true);
    expect(payload.error_notifications_sent_at <= after).toBe(true);
  });

  it("propagates Supabase errors (caller sees them — orchestrator catches)", async () => {
    const state: ChainState = {
      filters: [],
      resultData: null,
      resultError: { message: "deadlock detected" },
    };
    mockClient.current = makeMockClient(state);
    await expect(claimNotificationFanout("run-1")).rejects.toThrow(/deadlock detected/);
  });
});
