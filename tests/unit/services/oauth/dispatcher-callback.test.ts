/**
 * @jest-environment node
 *
 * Tests for dispatcher.handleCallback. Mocks integrations repo, slackOAuth,
 * and the oauth_states repo so the consumeState path runs end-to-end (verify
 * signature → atomic delete-if-fresh → return payload).
 */
import { randomBytes } from "node:crypto";

const mockUpsertActive = jest.fn();
const mockSlackHandleCallback = jest.fn();
const mockOAuthStatesCreate = jest.fn();
const mockOAuthStatesConsume = jest.fn();

jest.mock("@/repositories/integrations", () => ({
  upsertActive: mockUpsertActive,
}));

jest.mock("@/integrations/slack/oauth", () => ({
  slackOAuth: {
    buildAuthUrl: jest.fn(() => "https://slack.com/oauth/v2/authorize?test=1"),
    handleCallback: mockSlackHandleCallback,
    refreshToken: jest.fn(),
    revoke: jest.fn(),
  },
}));

jest.mock("@/repositories/oauthStates", () => ({
  create: (...args: unknown[]) => mockOAuthStatesCreate(...args),
  consumeByNonce: (...args: unknown[]) => mockOAuthStatesConsume(...args),
}));

import { handleCallback } from "@/services/oauth/dispatcher";
import { createState, InvalidStateError } from "@/services/oauth/state";
import { createPkceMockProvider } from "../../../__mocks__/integrations/_pkceMockProvider/oauth";

beforeEach(() => {
  process.env.OAUTH_STATE_SIGNING_KEY = randomBytes(32).toString("base64");
  mockUpsertActive.mockReset();
  mockSlackHandleCallback.mockReset();
  mockOAuthStatesCreate.mockReset();
  mockOAuthStatesCreate.mockResolvedValue(undefined);
  mockOAuthStatesConsume.mockReset();
});

afterEach(() => {
  delete process.env.OAUTH_STATE_SIGNING_KEY;
});

/** Helper: build a state token AND wire the consume mock to return its row. */
async function freshStateWithConsumeWired(input: {
  userId: string;
  provider: string;
  scopes?: readonly string[];
  pkceVerifier?: string;
  pkceMethod?: string;
}): Promise<string> {
  const { token, payload } = await createState({
    userId: input.userId,
    provider: input.provider,
    requestedScopes: input.scopes ?? [],
    ...(input.pkceVerifier !== undefined
      ? {
          pkce: {
            codeVerifier: input.pkceVerifier,
            codeChallengeMethod: input.pkceMethod ?? "S256",
          },
        }
      : {}),
  });
  mockOAuthStatesConsume.mockResolvedValueOnce({
    nonce: payload.nonce,
    userId: payload.userId,
    provider: payload.provider,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
    pkceCodeVerifier: input.pkceVerifier ?? null,
    pkceCodeChallengeMethod:
      input.pkceVerifier !== undefined ? (input.pkceMethod ?? "S256") : null,
    createdAt: new Date().toISOString(),
  });
  return token;
}

describe("dispatcher.handleCallback", () => {
  it("verifies+consumes state, calls slackOAuth.handleCallback, persists via upsertActive", async () => {
    const state = await freshStateWithConsumeWired({
      userId: "user-abc",
      provider: "slack",
      scopes: ["chat:write"],
    });
    mockSlackHandleCallback.mockResolvedValueOnce({
      tokens: {
        accessTokenEncrypted: "ENC",
        refreshTokenEncrypted: null,
        accessTokenExpiresAt: null,
        scopes: ["chat:write"],
      },
      account: {
        providerAccountId: "T123",
        displayName: "Acme",
        metadata: { teamId: "T123" },
      },
    });
    mockUpsertActive.mockResolvedValueOnce({
      id: "int-1",
      userId: "user-abc",
      provider: "slack",
      providerAccountId: "T123",
      displayName: "Acme",
      accessTokenEncrypted: "ENC",
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
      scopes: ["chat:write"],
      accountMetadata: { teamId: "T123" },
      disconnectedAt: null,
      createdAt: "2026-05-05T00:00:00Z",
      updatedAt: "2026-05-05T00:00:00Z",
    });

    const result = await handleCallback({ provider: "slack", code: "auth-code", state });

    expect(mockOAuthStatesConsume).toHaveBeenCalledTimes(1);
    expect(mockSlackHandleCallback).toHaveBeenCalledWith("auth-code", state, null);
    expect(mockUpsertActive).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-abc",
        provider: "slack",
        providerAccountId: "T123",
        tokens: expect.objectContaining({ accessTokenEncrypted: "ENC" }),
      }),
    );
    expect(result.integration.id).toBe("int-1");
  });

  it("throws InvalidStateError on a tampered state token (no DB consume attempted)", async () => {
    const state = await freshStateWithConsumeWired({ userId: "u", provider: "slack" });
    const tampered = state.slice(0, -4) + "AAAA";
    mockOAuthStatesConsume.mockReset();
    await expect(
      handleCallback({ provider: "slack", code: "c", state: tampered }),
    ).rejects.toThrow(InvalidStateError);
    expect(mockOAuthStatesConsume).not.toHaveBeenCalled();
    expect(mockSlackHandleCallback).not.toHaveBeenCalled();
    expect(mockUpsertActive).not.toHaveBeenCalled();
  });

  it("throws InvalidStateError on REPLAY (consume returns null on second use)", async () => {
    const state = await freshStateWithConsumeWired({ userId: "u", provider: "slack" });
    // Override the consume wired by the helper: row already gone.
    mockOAuthStatesConsume.mockReset();
    mockOAuthStatesConsume.mockResolvedValueOnce(null);
    await expect(
      handleCallback({ provider: "slack", code: "c", state }),
    ).rejects.toThrow(/already consumed or expired/);
    expect(mockSlackHandleCallback).not.toHaveBeenCalled();
    expect(mockUpsertActive).not.toHaveBeenCalled();
  });

  it("throws InvalidStateError on provider mismatch — and STILL consumes the nonce (no replay against correct route)", async () => {
    const state = await freshStateWithConsumeWired({ userId: "u", provider: "gmail" });
    await expect(
      handleCallback({ provider: "slack", code: "c", state }),
    ).rejects.toThrow(/provider mismatch/);
    // Consume happened before the mismatch check — that's the security
    // contract: a wrong-provider callback uses up the nonce so the same
    // state can't be re-played at the correct provider's route either.
    expect(mockOAuthStatesConsume).toHaveBeenCalledTimes(1);
    expect(mockSlackHandleCallback).not.toHaveBeenCalled();
  });
});

/**
 * Slice 2a: dispatcher threads the PKCE row through to provider.handleCallback.
 *
 * The "slack" provider id is reused as the test surface — the mocked
 * handleCallback is a generic jest.fn() acting as a stand-in for any
 * ProviderOAuth, so what we're really asserting is the dispatcher's
 * plumbing, not Slack's behavior. A reusable factory at
 * tests/__mocks__/integrations/_pkceMockProvider/oauth.ts gives the same
 * shape for future Slice 2c (Gmail) tests.
 */
describe("dispatcher.handleCallback — PKCE plumbing (Slice 2a)", () => {
  function arrangeUpsert(): void {
    mockUpsertActive.mockResolvedValueOnce({
      id: "int-pkce",
      userId: "u-pkce",
      provider: "slack",
      providerAccountId: "acct",
      displayName: null,
      accessTokenEncrypted: "ENC",
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
      scopes: [],
      accountMetadata: {},
      disconnectedAt: null,
      createdAt: "2026-05-07T00:00:00Z",
      updatedAt: "2026-05-07T00:00:00Z",
    });
    mockSlackHandleCallback.mockResolvedValueOnce({
      tokens: {
        accessTokenEncrypted: "ENC",
        refreshTokenEncrypted: null,
        accessTokenExpiresAt: null,
        scopes: [],
      },
      account: { providerAccountId: "acct", displayName: null, metadata: {} },
    });
  }

  it("passes PKCE inputs to provider.handleCallback when the consumed row has both fields (asserted via factory's capture state)", async () => {
    // Drive the mocked slackOAuth.handleCallback through the factory so the
    // factory's PkceMockState records every call. This is the pattern
    // future Slice 2c (Gmail) tests will reuse.
    const { provider: pkceProvider, state: captureState } = createPkceMockProvider();
    mockSlackHandleCallback.mockImplementation(pkceProvider.handleCallback);

    const stateToken = await freshStateWithConsumeWired({
      userId: "u-pkce",
      provider: "slack",
      pkceVerifier: "verifier-secret-abc",
      pkceMethod: "S256",
    });
    mockUpsertActive.mockResolvedValueOnce({
      id: "int-pkce",
      userId: "u-pkce",
      provider: "slack",
      providerAccountId: "mock-acct-1",
      displayName: "Mock Account",
      accessTokenEncrypted: "ENC-MOCK-ACCESS",
      refreshTokenEncrypted: "ENC-MOCK-REFRESH",
      accessTokenExpiresAt: null,
      scopes: ["mock.read"],
      accountMetadata: {},
      disconnectedAt: null,
      createdAt: "2026-05-07T00:00:00Z",
      updatedAt: "2026-05-07T00:00:00Z",
    });

    await handleCallback({ provider: "slack", code: "code-pkce", state: stateToken });

    expect(captureState.handleCallbackCalls).toHaveLength(1);
    expect(captureState.handleCallbackCalls[0]!.code).toBe("code-pkce");
    expect(captureState.handleCallbackCalls[0]!.state).toBe(stateToken);
    expect(captureState.handleCallbackCalls[0]!.pkce).toEqual({
      codeVerifier: "verifier-secret-abc",
      codeChallengeMethod: "S256",
    });
  });

  it("passes pkce: null when the consumed row has no PKCE fields (Slack-shaped path)", async () => {
    const state = await freshStateWithConsumeWired({
      userId: "u",
      provider: "slack",
    });
    arrangeUpsert();

    await handleCallback({ provider: "slack", code: "c", state });

    expect(mockSlackHandleCallback).toHaveBeenCalledWith("c", state, null);
  });

  it("treats a half-populated PKCE row as null (defensive AND in consumeState)", async () => {
    // Manually wire the consume mock to return a row with verifier set but
    // method NULL — simulates upstream corruption that createState's all-or-
    // nothing write should normally prevent.
    const { token, payload } = await createState({
      userId: "u",
      provider: "slack",
      requestedScopes: [],
    });
    mockOAuthStatesConsume.mockResolvedValueOnce({
      nonce: payload.nonce,
      userId: payload.userId,
      provider: payload.provider,
      expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
      pkceCodeVerifier: "stranded",
      pkceCodeChallengeMethod: null,
      createdAt: new Date().toISOString(),
    });
    arrangeUpsert();

    await handleCallback({ provider: "slack", code: "c", state: token });

    expect(mockSlackHandleCallback).toHaveBeenCalledWith("c", token, null);
  });
});
