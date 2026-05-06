/**
 * @jest-environment node
 *
 * Tests for repositories/oauthStates.ts. Mocks the service-role Supabase
 * client (this is a system table per database-security.md — no SSR-cookie
 * client path) to verify the create / consumeByNonce / reapExpired flows.
 */

interface ConsumeChainState {
  filters: Array<{ op: string; args: unknown[] }>;
  resultData: unknown;
  resultError: { message: string } | null;
}

function makeMockClient(state: ConsumeChainState, opts?: { useMaybeSingle?: boolean }) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    insert: jest.fn((row: unknown) => {
      state.filters.push({ op: "insert", args: [row] });
      return builder;
    }),
    delete: jest.fn(() => {
      state.filters.push({ op: "delete", args: [] });
      return builder;
    }),
    select: jest.fn((cols?: string) => {
      state.filters.push({ op: "select", args: [cols ?? "*"] });
      return builder;
    }),
    eq: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "eq", args: [col, val] });
      return builder;
    }),
    gt: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "gt", args: [col, val] });
      return builder;
    }),
    lte: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "lte", args: [col, val] });
      return builder;
    }),
    maybeSingle: jest.fn(async () => ({
      data: state.resultData,
      error: state.resultError,
    })),
    // For insert / reapExpired — promise-style, no maybeSingle
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: state.resultData, error: state.resultError }),
  });
  void opts;
  return { from: jest.fn(() => builder), state };
}

const mockClient: { current: ReturnType<typeof makeMockClient> | null } = { current: null };

jest.mock("@/repositories/supabase/serviceRoleClient", () => ({
  getServiceRoleClient: jest.fn(() => mockClient.current),
}));

import {
  create,
  consumeByNonce,
  reapExpired,
} from "@/repositories/oauthStates";

describe("oauthStates.create", () => {
  it("INSERTs a row with all required fields and snake_case translation", async () => {
    const state: ConsumeChainState = { filters: [], resultData: null, resultError: null };
    mockClient.current = makeMockClient(state);
    await create({
      nonce: "n-123",
      userId: "user-1",
      provider: "slack",
      expiresAt: "2026-05-07T00:15:00Z",
    });
    const insert = state.filters.find((f) => f.op === "insert");
    expect(insert).toBeDefined();
    const row = insert!.args[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      nonce: "n-123",
      user_id: "user-1",
      provider: "slack",
      expires_at: "2026-05-07T00:15:00Z",
      pkce_code_verifier: null,
      pkce_code_challenge_method: null,
    });
  });

  it("persists PKCE columns when supplied (forward-compat for Google/Notion/etc.)", async () => {
    const state: ConsumeChainState = { filters: [], resultData: null, resultError: null };
    mockClient.current = makeMockClient(state);
    await create({
      nonce: "n-1",
      userId: "u",
      provider: "google",
      expiresAt: "2026-05-07T00:15:00Z",
      pkceCodeVerifier: "verifier-secret",
      pkceCodeChallengeMethod: "S256",
    });
    const row = state.filters.find((f) => f.op === "insert")!.args[0] as Record<string, unknown>;
    expect(row.pkce_code_verifier).toBe("verifier-secret");
    expect(row.pkce_code_challenge_method).toBe("S256");
  });

  it("propagates Supabase insert errors", async () => {
    const state: ConsumeChainState = {
      filters: [],
      resultData: null,
      resultError: { message: "duplicate key value violates unique constraint" },
    };
    mockClient.current = makeMockClient(state);
    await expect(
      create({
        nonce: "dup",
        userId: "u",
        provider: "slack",
        expiresAt: "2026-05-07T00:15:00Z",
      }),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("oauthStates.consumeByNonce", () => {
  it("returns the row when delete-if-fresh matches an unexpired nonce", async () => {
    const state: ConsumeChainState = {
      filters: [],
      resultData: {
        nonce: "n-1",
        user_id: "user-1",
        provider: "slack",
        expires_at: "2026-05-07T00:15:00Z",
        pkce_code_verifier: null,
        pkce_code_challenge_method: null,
        created_at: "2026-05-07T00:00:00Z",
      },
      resultError: null,
    };
    mockClient.current = makeMockClient(state);
    const result = await consumeByNonce("n-1");
    expect(result).toMatchObject({
      nonce: "n-1",
      userId: "user-1",
      provider: "slack",
    });
    // Confirm the chain was DELETE … WHERE nonce=… AND expires_at > now()
    expect(state.filters.map((f) => f.op)).toEqual(
      expect.arrayContaining(["delete", "eq", "gt", "select"]),
    );
    const eqFilter = state.filters.find((f) => f.op === "eq");
    expect(eqFilter!.args).toEqual(["nonce", "n-1"]);
    const gtFilter = state.filters.find((f) => f.op === "gt");
    expect(gtFilter!.args[0]).toBe("expires_at");
  });

  it("returns null when the nonce doesn't exist (replay attempt or unknown nonce)", async () => {
    const state: ConsumeChainState = { filters: [], resultData: null, resultError: null };
    mockClient.current = makeMockClient(state);
    const result = await consumeByNonce("missing");
    expect(result).toBeNull();
  });

  it("returns null when the row exists but is expired (the gt predicate skips it)", async () => {
    // Same as missing — the WHERE clause filters expired rows out, so
    // consume returns null without distinguishing. That's intentional.
    const state: ConsumeChainState = { filters: [], resultData: null, resultError: null };
    mockClient.current = makeMockClient(state);
    expect(await consumeByNonce("expired")).toBeNull();
  });

  it("propagates Supabase delete errors", async () => {
    const state: ConsumeChainState = {
      filters: [],
      resultData: null,
      resultError: { message: "connection lost" },
    };
    mockClient.current = makeMockClient(state);
    await expect(consumeByNonce("n")).rejects.toThrow(/connection lost/);
  });
});

describe("oauthStates.reapExpired", () => {
  it("deletes rows where expires_at <= now() and returns the count", async () => {
    const state: ConsumeChainState = {
      filters: [],
      resultData: [{ nonce: "old-1" }, { nonce: "old-2" }, { nonce: "old-3" }],
      resultError: null,
    };
    mockClient.current = makeMockClient(state);
    const count = await reapExpired();
    expect(count).toBe(3);
    const lteFilter = state.filters.find((f) => f.op === "lte");
    expect(lteFilter!.args[0]).toBe("expires_at");
  });

  it("returns 0 when nothing is expired", async () => {
    const state: ConsumeChainState = { filters: [], resultData: [], resultError: null };
    mockClient.current = makeMockClient(state);
    expect(await reapExpired()).toBe(0);
  });

  it("propagates Supabase errors", async () => {
    const state: ConsumeChainState = {
      filters: [],
      resultData: null,
      resultError: { message: "perm denied" },
    };
    mockClient.current = makeMockClient(state);
    await expect(reapExpired()).rejects.toThrow(/perm denied/);
  });
});
