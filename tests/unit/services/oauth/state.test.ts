import { createHmac, randomBytes } from "node:crypto";
import { createState, verifyState, InvalidStateError } from "@/services/oauth/state";

const TEST_KEY = randomBytes(32).toString("base64");

beforeEach(() => {
  process.env.OAUTH_STATE_SIGNING_KEY = TEST_KEY;
});

afterEach(() => {
  delete process.env.OAUTH_STATE_SIGNING_KEY;
});

describe("createState / verifyState", () => {
  it("round-trips and preserves payload fields", () => {
    const { token, payload } = createState({
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

  it("expiresAt is roughly 15 minutes in the future", () => {
    const before = Math.floor(Date.now() / 1000);
    const { payload } = createState({ userId: "u", provider: "slack", requestedScopes: [] });
    const expected = before + 15 * 60;
    expect(payload.expiresAt).toBeGreaterThanOrEqual(expected - 2);
    expect(payload.expiresAt).toBeLessThanOrEqual(expected + 2);
  });

  it("each state has a unique nonce", () => {
    const a = createState({ userId: "u", provider: "slack", requestedScopes: [] });
    const b = createState({ userId: "u", provider: "slack", requestedScopes: [] });
    expect(a.payload.nonce).not.toBe(b.payload.nonce);
    expect(a.token).not.toBe(b.token);
  });

  it("rejects a tampered payload (signature mismatch)", () => {
    const { token } = createState({ userId: "u", provider: "slack", requestedScopes: [] });
    const [data, sig] = token.split(".", 2);
    // Re-encode payload with elevated userId
    const tamperedPayload = { userId: "admin", provider: "slack", nonce: "x", expiresAt: 9999999999, requestedScopes: [] };
    const tamperedData = Buffer.from(JSON.stringify(tamperedPayload)).toString("base64url");
    const tampered = `${tamperedData}.${sig}`;
    expect(() => verifyState(tampered)).toThrow(InvalidStateError);
    expect(() => verifyState(`${data}.AAAA`)).toThrow(InvalidStateError);
  });

  it("rejects an expired token", () => {
    const { token } = createState({ userId: "u", provider: "slack", requestedScopes: [] });
    // Re-craft with expired payload but a real signature using the same key
    const expiredPayload = { userId: "u", provider: "slack", nonce: "x", expiresAt: 1, requestedScopes: [] };
    const data = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
    // Compute the matching sig
    const sig = createHmac("sha256", Buffer.from(TEST_KEY, "base64")).update(data).digest("base64url");
    expect(() => verifyState(`${data}.${sig}`)).toThrow(/expired/);
    expect(token).toBeDefined(); // sanity: createState succeeded above
  });

  it("rejects a malformed token", () => {
    expect(() => verifyState("not-a-token")).toThrow(InvalidStateError);
    expect(() => verifyState("")).toThrow(InvalidStateError);
    expect(() => verifyState(".")).toThrow(InvalidStateError);
  });

  it("rejects when OAUTH_STATE_SIGNING_KEY is unset", () => {
    delete process.env.OAUTH_STATE_SIGNING_KEY;
    expect(() => createState({ userId: "u", provider: "slack", requestedScopes: [] })).toThrow(
      /OAUTH_STATE_SIGNING_KEY/,
    );
  });

  it("rejects an empty userId", () => {
    expect(() =>
      createState({ userId: "", provider: "slack", requestedScopes: [] }),
    ).toThrow(/userId/);
  });

  it("verify with a different signing key fails", () => {
    const { token } = createState({ userId: "u", provider: "slack", requestedScopes: [] });
    process.env.OAUTH_STATE_SIGNING_KEY = randomBytes(32).toString("base64");
    expect(() => verifyState(token)).toThrow(/signature mismatch/);
  });
});
