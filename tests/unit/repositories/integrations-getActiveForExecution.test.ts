/**
 * @jest-environment node
 *
 * Tests for repositories/integrations.getActiveForExecution.
 *
 * Separate file from integrations.test.ts because this path uses the
 * service-role client, not the SSR-cookie one — different mocking shape.
 *
 * Verifies:
 *   - Returns the integration when an active row matches.
 *   - Filters by provider_account_id when accountId is supplied.
 *   - Skips the provider_account_id filter when accountId is null
 *     (manual / scheduled triggers).
 *   - Returns null when no active row exists.
 */

interface ChainState {
  filters: Array<{ op: string; args: unknown[] }>;
  resultData: unknown;
  resultError: { message: string } | null;
}

function makeMockClient(state: ChainState) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: jest.fn(() => builder),
    eq: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "eq", args: [col, val] });
      return builder;
    }),
    is: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "is", args: [col, val] });
      return builder;
    }),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(() =>
      Promise.resolve({ data: state.resultData, error: state.resultError }),
    ),
  });
  return { from: jest.fn(() => builder), state };
}

const mockServiceRole: { current: ReturnType<typeof makeMockClient> | null } = { current: null };
jest.mock("@/repositories/supabase/serviceRoleClient", () => ({
  getServiceRoleClient: jest.fn(() => mockServiceRole.current),
}));

import { getActiveForExecution } from "@/repositories/integrations";

const baseRow = {
  id: "int-1",
  user_id: "user-1",
  provider: "slack",
  provider_account_id: "T0001",
  display_name: "Acme",
  access_token_encrypted: "ENC",
  refresh_token_encrypted: null,
  access_token_expires_at: null,
  scopes: ["chat:write"],
  account_metadata: {},
  disconnected_at: null,
  created_at: "2026-05-07T00:00:00Z",
  updated_at: "2026-05-07T00:00:00Z",
};

function freshState(resultData: unknown = baseRow): ChainState {
  return { filters: [], resultData, resultError: null };
}

describe("getActiveForExecution", () => {
  it("filters by user_id, provider, disconnected_at IS NULL, and provider_account_id when accountId is supplied", async () => {
    const state = freshState();
    mockServiceRole.current = makeMockClient(state);
    const result = await getActiveForExecution("user-1", "slack", "T0001");
    expect(result?.id).toBe("int-1");
    expect(state.filters).toContainEqual({ op: "eq", args: ["user_id", "user-1"] });
    expect(state.filters).toContainEqual({ op: "eq", args: ["provider", "slack"] });
    expect(state.filters).toContainEqual({ op: "is", args: ["disconnected_at", null] });
    expect(state.filters).toContainEqual({
      op: "eq",
      args: ["provider_account_id", "T0001"],
    });
  });

  it("skips the provider_account_id filter when accountId is null", async () => {
    const state = freshState();
    mockServiceRole.current = makeMockClient(state);
    await getActiveForExecution("user-1", "slack", null);
    expect(state.filters.find((f) => f.args[0] === "provider_account_id")).toBeUndefined();
  });

  it("returns null when no active row matches", async () => {
    const state = freshState(null);
    mockServiceRole.current = makeMockClient(state);
    const result = await getActiveForExecution("user-1", "slack", "T0001");
    expect(result).toBeNull();
  });

  it("propagates supabase errors", async () => {
    const state: ChainState = {
      filters: [],
      resultData: null,
      resultError: { message: "permission denied" },
    };
    mockServiceRole.current = makeMockClient(state);
    await expect(
      getActiveForExecution("user-1", "slack", "T0001"),
    ).rejects.toThrow(/permission denied/);
  });
});
