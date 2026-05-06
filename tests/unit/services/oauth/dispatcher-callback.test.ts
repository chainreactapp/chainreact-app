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
}): Promise<string> {
  const { token, payload } = await createState({
    userId: input.userId,
    provider: input.provider,
    requestedScopes: input.scopes ?? [],
  });
  mockOAuthStatesConsume.mockResolvedValueOnce({
    nonce: payload.nonce,
    userId: payload.userId,
    provider: payload.provider,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
    pkceCodeVerifier: null,
    pkceCodeChallengeMethod: null,
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
    expect(mockSlackHandleCallback).toHaveBeenCalledWith("auth-code", state);
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
