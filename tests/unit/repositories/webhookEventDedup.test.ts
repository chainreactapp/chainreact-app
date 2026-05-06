/**
 * @jest-environment node
 *
 * Tests for repositories/webhookEventDedup.ts.
 *
 * markSeen returns { fresh: true } for a new (provider, eventId) and
 * { fresh: false } when supabase reports the conflict was ignored. The
 * dispatcher relies on this contract for idempotency.
 */

interface ChainState {
  upsertPayload?: unknown;
  upsertOptions?: unknown;
  filters: Array<{ op: string; args: unknown[] }>;
  resultData: unknown;
  resultError: { message: string } | null;
}

function makeMockClient(state: ChainState) {
  const builder: Record<string, jest.Mock> = {
    upsert: jest.fn((payload, options) => {
      state.upsertPayload = payload;
      state.upsertOptions = options;
      return builder;
    }),
    delete: jest.fn(() => builder),
    select: jest.fn(() => builder),
    lt: jest.fn((col, val) => {
      state.filters.push({ op: "lt", args: [col, val] });
      return builder;
    }),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: state.resultData, error: state.resultError }),
  };
  return { from: jest.fn(() => builder), state };
}

const mockServiceRole: { current: ReturnType<typeof makeMockClient> | null } = { current: null };
jest.mock("@/repositories/supabase/serviceRoleClient", () => ({
  getServiceRoleClient: jest.fn(() => mockServiceRole.current),
}));

import { markSeen, purgeExpired } from "@/repositories/webhookEventDedup";

describe("webhookEventDedup.markSeen", () => {
  it("returns fresh: true when the upsert returned a new row", async () => {
    const state: ChainState = {
      filters: [],
      resultData: [{ id: "row-1" }],
      resultError: null,
    };
    mockServiceRole.current = makeMockClient(state);
    const result = await markSeen("slack", "Ev123");
    expect(result).toEqual({ fresh: true });
    expect(state.upsertPayload).toEqual({ provider: "slack", event_id: "Ev123" });
    expect(state.upsertOptions).toMatchObject({
      onConflict: "provider,event_id",
      ignoreDuplicates: true,
    });
  });

  it("returns fresh: false when the row already existed (empty data array)", async () => {
    const state: ChainState = {
      filters: [],
      resultData: [],
      resultError: null,
    };
    mockServiceRole.current = makeMockClient(state);
    const result = await markSeen("slack", "Ev123");
    expect(result).toEqual({ fresh: false });
  });

  it("propagates the supabase error so the dispatcher can apply fail-open policy", async () => {
    const state: ChainState = {
      filters: [],
      resultData: null,
      resultError: { message: "connection lost" },
    };
    mockServiceRole.current = makeMockClient(state);
    await expect(markSeen("slack", "Ev123")).rejects.toThrow(/connection lost/);
  });
});

describe("webhookEventDedup.purgeExpired", () => {
  it("deletes rows where expires_at is in the past and returns the row count", async () => {
    const state: ChainState = {
      filters: [],
      resultData: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
      resultError: null,
    };
    mockServiceRole.current = makeMockClient(state);
    const count = await purgeExpired();
    expect(count).toBe(3);
    expect(state.filters[0]?.op).toBe("lt");
    expect(state.filters[0]?.args[0]).toBe("expires_at");
  });
});
