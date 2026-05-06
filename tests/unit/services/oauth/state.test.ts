import { createHmac, randomBytes } from "node:crypto";

const mockCreate = jest.fn();
const mockConsumeByNonce = jest.fn();

jest.mock("@/repositories/oauthStates", () => ({
  create: (...args: unknown[]) => mockCreate(...args),
  consumeByNonce: (...args: unknown[]) => mockConsumeByNonce(...args),
}));

import {
  createState,
  verifyState,
  consumeState,
  InvalidStateError,
} from "@/services/oauth/state";

const TEST_KEY = randomBytes(32).toString("base64");

beforeEach(() => {
  process.env.OAUTH_STATE_SIGNING_KEY = TEST_KEY;
  mockCreate.mockReset();
  mockCreate.mockResolvedValue(undefined);
  mockConsumeByNonce.mockReset();
});

afterEach(() => {
  delete process.env.OAUTH_STATE_SIGNING_KEY;
});

describe("createState / verifyState (signature layer — pure JWT semantics)", () => {
  it("round-trips and preserves payload fields", async () => {
    const { token, payload } = await createState({
      userId: "user-123",
      provider: "slack",
      requestedScopes: ["chat:write", "channels:read"],
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const verified = verifyState(token);
    expect(verified.userId).toBe("user-123");
    expect(verified.provider).toBe("slack");
    expect(verified.requestedScopes).toEqual(["chat:write", "channels:read"]);
    expect(verified.nonce).toBe(payload.nonce);
    expect(verified.expiresAt).toBe(payload.expiresAt);
  });

  it("expiresAt is roughly 15 minutes in the future", async () => {
    const before = Math.floor(Date.now() / 1000);
    const { payload } = await createState({ userId: "u", provider: "slack", requestedScopes: [] });
    const expected = before + 15 * 60;
    expect(payload.expiresAt).toBeGreaterThanOrEqual(expected - 2);
    expect(payload.expiresAt).toBeLessThanOrEqual(expected + 2);
  });

  it("each state has a unique nonce", async () => {
    const a = await createState({ userId: "u", provider: "slack", requestedScopes: [] });
    const b = await createState({ userId: "u", provider: "slack", requestedScopes: [] });
    expect(a.payload.nonce).not.toBe(b.payload.nonce);
    expect(a.token).not.toBe(b.token);
  });

  it("rejects a tampered payload (signature mismatch)", async () => {
    const { token } = await createState({ userId: "u", provider: "slack", requestedScopes: [] });
    const [data, sig] = token.split(".", 2);
    // Re-encode payload with elevated userId
    const tamperedPayload = { userId: "admin", provider: "slack", nonce: "x", expiresAt: 9999999999, requestedScopes: [] };
    const tamperedData = Buffer.from(JSON.stringify(tamperedPayload)).toString("base64url");
    const tampered = `${tamperedData}.${sig}`;
    expect(() => verifyState(tampered)).toThrow(InvalidStateError);
    expect(() => verifyState(`${data}.AAAA`)).toThrow(InvalidStateError);
  });

  it("rejects an expired token", async () => {
    const { token } = await createState({ userId: "u", provider: "slack", requestedScopes: [] });
    // Re-craft with expired payload but a real signature using the same key
    const expiredPayload = { userId: "u", provider: "slack", nonce: "x", expiresAt: 1, requestedScopes: [] };
    const data = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
    const sig = createHmac("sha256", Buffer.from(TEST_KEY, "base64")).update(data).digest("base64url");
    expect(() => verifyState(`${data}.${sig}`)).toThrow(/expired/);
    expect(token).toBeDefined();
  });

  it("rejects a malformed token", () => {
    expect(() => verifyState("not-a-token")).toThrow(InvalidStateError);
    expect(() => verifyState("")).toThrow(InvalidStateError);
    expect(() => verifyState(".")).toThrow(InvalidStateError);
  });

  it("rejects when OAUTH_STATE_SIGNING_KEY is unset", async () => {
    delete process.env.OAUTH_STATE_SIGNING_KEY;
    await expect(
      createState({ userId: "u", provider: "slack", requestedScopes: [] }),
    ).rejects.toThrow(/OAUTH_STATE_SIGNING_KEY/);
  });

  it("rejects an empty userId", async () => {
    await expect(
      createState({ userId: "", provider: "slack", requestedScopes: [] }),
    ).rejects.toThrow(/userId/);
  });

  it("verify with a different signing key fails", async () => {
    const { token } = await createState({ userId: "u", provider: "slack", requestedScopes: [] });
    process.env.OAUTH_STATE_SIGNING_KEY = randomBytes(32).toString("base64");
    expect(() => verifyState(token)).toThrow(/signature mismatch/);
  });
});

describe("createState — DB nonce write", () => {
  it("writes the nonce row to oauth_states with matching userId/provider/expiresAt", async () => {
    const { payload } = await createState({
      userId: "user-abc",
      provider: "slack",
      requestedScopes: ["chat:write"],
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const arg = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      nonce: payload.nonce,
      userId: "user-abc",
      provider: "slack",
    });
    // expiresAt is ISO-8601 from epoch seconds in the JWT payload
    expect(arg.expiresAt).toBe(new Date(payload.expiresAt * 1000).toISOString());
    // No PKCE supplied -> field omitted from the input
    expect(arg.pkceCodeVerifier).toBeUndefined();
  });

  it("forwards optional PKCE metadata to the repository (forward-compat)", async () => {
    await createState({
      userId: "u",
      provider: "google",
      requestedScopes: ["openid"],
      pkce: { codeVerifier: "verifier-secret", codeChallengeMethod: "S256" },
    });
    const arg = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.pkceCodeVerifier).toBe("verifier-secret");
    expect(arg.pkceCodeChallengeMethod).toBe("S256");
  });

  it("propagates a repository write failure (caller sees the error)", async () => {
    mockCreate.mockRejectedValueOnce(new Error("db down"));
    await expect(
      createState({ userId: "u", provider: "slack", requestedScopes: [] }),
    ).rejects.toThrow(/db down/);
  });
});

describe("consumeState — verify-and-consume (replay protection)", () => {
  it("returns the payload when the JWT is valid AND the DB row is consumed atomically", async () => {
    const { token, payload } = await createState({
      userId: "user-1",
      provider: "slack",
      requestedScopes: [],
    });
    // Simulate the atomic delete-if-fresh returning the row
    mockConsumeByNonce.mockResolvedValueOnce({
      nonce: payload.nonce,
      userId: "user-1",
      provider: "slack",
      expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
      pkceCodeVerifier: null,
      pkceCodeChallengeMethod: null,
      createdAt: "2026-05-07T00:00:00Z",
    });
    const result = await consumeState(token);
    expect(result.userId).toBe("user-1");
    expect(mockConsumeByNonce).toHaveBeenCalledWith(payload.nonce);
  });

  it("rejects on second consume — the nonce row is gone (REPLAY ATTACK guard)", async () => {
    const { token } = await createState({ userId: "u", provider: "slack", requestedScopes: [] });
    mockConsumeByNonce
      .mockResolvedValueOnce({
        nonce: "x",
        userId: "u",
        provider: "slack",
        expiresAt: new Date().toISOString(),
        pkceCodeVerifier: null,
        pkceCodeChallengeMethod: null,
        createdAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce(null); // second attempt: row already deleted
    // Override the first call's nonce match for the test's bookkeeping
    const payload = verifyState(token);
    mockConsumeByNonce.mockReset();
    mockConsumeByNonce.mockResolvedValueOnce({
      nonce: payload.nonce,
      userId: payload.userId,
      provider: payload.provider,
      expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
      pkceCodeVerifier: null,
      pkceCodeChallengeMethod: null,
      createdAt: new Date().toISOString(),
    });
    await expect(consumeState(token)).resolves.toBeDefined();

    // Second time: repo returns null (row already consumed)
    mockConsumeByNonce.mockResolvedValueOnce(null);
    await expect(consumeState(token)).rejects.toThrow(/already consumed or expired/);
  });

  it("rejects when the DB row is expired/missing (consumeByNonce returns null)", async () => {
    const { token } = await createState({ userId: "u", provider: "slack", requestedScopes: [] });
    mockConsumeByNonce.mockResolvedValueOnce(null);
    await expect(consumeState(token)).rejects.toThrow(/already consumed or expired/);
  });

  it("rejects when the JWT payload and DB row disagree on userId (key rotation / DB tampering)", async () => {
    const { token, payload } = await createState({
      userId: "user-real",
      provider: "slack",
      requestedScopes: [],
    });
    mockConsumeByNonce.mockResolvedValueOnce({
      nonce: payload.nonce,
      userId: "user-different", // ← mismatch
      provider: "slack",
      expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
      pkceCodeVerifier: null,
      pkceCodeChallengeMethod: null,
      createdAt: new Date().toISOString(),
    });
    await expect(consumeState(token)).rejects.toThrow(/state row mismatch/);
  });

  it("rejects a tampered token before touching the DB (signature check is first)", async () => {
    const { token } = await createState({ userId: "u", provider: "slack", requestedScopes: [] });
    const tampered = token.slice(0, -4) + "AAAA";
    await expect(consumeState(tampered)).rejects.toThrow(InvalidStateError);
    expect(mockConsumeByNonce).not.toHaveBeenCalled();
  });

  it("rejects an expired JWT before touching the DB", async () => {
    const expiredPayload = {
      userId: "u",
      provider: "slack",
      nonce: "x",
      expiresAt: 1,
      requestedScopes: [],
    };
    const data = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
    const sig = createHmac("sha256", Buffer.from(TEST_KEY, "base64"))
      .update(data)
      .digest("base64url");
    await expect(consumeState(`${data}.${sig}`)).rejects.toThrow(/expired/);
    expect(mockConsumeByNonce).not.toHaveBeenCalled();
  });
});
