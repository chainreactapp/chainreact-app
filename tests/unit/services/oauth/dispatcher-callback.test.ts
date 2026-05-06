/**
 * @jest-environment node
 *
 * Tests for dispatcher.handleCallback. Mocks the integrations repository and
 * the slackOAuth.handleCallback so we can drive the dispatcher's logic in
 * isolation: state verification, provider mismatch, repository delegation.
 */
import { randomBytes } from "node:crypto";

const mockUpsertActive = jest.fn();
const mockSlackHandleCallback = jest.fn();

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

import { handleCallback } from "@/services/oauth/dispatcher";
import { createState, InvalidStateError } from "@/services/oauth/state";

beforeEach(() => {
  process.env.OAUTH_STATE_SIGNING_KEY = randomBytes(32).toString("base64");
  mockUpsertActive.mockReset();
  mockSlackHandleCallback.mockReset();
});

afterEach(() => {
  delete process.env.OAUTH_STATE_SIGNING_KEY;
});

describe("dispatcher.handleCallback", () => {
  it("verifies state, calls slackOAuth.handleCallback, persists via upsertActive", async () => {
    const { token: state } = createState({
      userId: "user-abc",
      provider: "slack",
      requestedScopes: ["chat:write"],
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

    expect(mockSlackHandleCallback).toHaveBeenCalledWith("auth-code", state);
    expect(mockUpsertActive).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-abc",
        provider: "slack",
        providerAccountId: "T123",
        displayName: "Acme",
        tokens: expect.objectContaining({ accessTokenEncrypted: "ENC" }),
      }),
    );
    expect(result.integration.id).toBe("int-1");
  });

  it("throws InvalidStateError on a tampered state token", async () => {
    const { token: state } = createState({
      userId: "u",
      provider: "slack",
      requestedScopes: [],
    });
    const tampered = state.slice(0, -4) + "AAAA";
    await expect(
      handleCallback({ provider: "slack", code: "c", state: tampered }),
    ).rejects.toThrow(InvalidStateError);
    expect(mockSlackHandleCallback).not.toHaveBeenCalled();
    expect(mockUpsertActive).not.toHaveBeenCalled();
  });

  it("throws InvalidStateError on provider mismatch between state and route", async () => {
    const { token: state } = createState({
      userId: "u",
      provider: "gmail",
      requestedScopes: [],
    });
    await expect(
      handleCallback({ provider: "slack", code: "c", state }),
    ).rejects.toThrow(/provider mismatch/);
    expect(mockSlackHandleCallback).not.toHaveBeenCalled();
  });
});
