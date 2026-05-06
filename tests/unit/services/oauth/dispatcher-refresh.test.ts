/**
 * @jest-environment node
 *
 * Tests for dispatcher.refresh — the new operation in Slice 2b.
 *
 * Mocks: integrations repo (getActiveForExecution + updateTokens), token
 * encryption (encrypt/decrypt), and slackOAuth so we can drive
 * refreshToken outcomes without touching a real provider. The
 * single-flight refresh lock is exercised concretely (no mock of
 * refreshLock itself).
 */
import { RefreshNotSupportedError } from "@/contracts/integration";

const mockGetActiveForExecution = jest.fn();
const mockUpdateTokens = jest.fn();
const mockSlackRefreshToken = jest.fn();

jest.mock("@/repositories/integrations", () => ({
  getActiveForExecution: mockGetActiveForExecution,
  updateTokens: mockUpdateTokens,
  // upsertActive isn't used by refresh, but the dispatcher imports it
  // statically. Provide a stub so the import resolves.
  upsertActive: jest.fn(),
}));

jest.mock("@/integrations/slack/oauth", () => ({
  slackOAuth: {
    buildAuthUrl: jest.fn(),
    handleCallback: jest.fn(),
    refreshToken: mockSlackRefreshToken,
    revoke: jest.fn(),
  },
}));

jest.mock("@/core/encryption/tokens", () => ({
  decryptToken: jest.fn((enc: string) => enc.replace(/^ENC-/, "")),
  encryptToken: jest.fn((p: string) => `ENC-${p}`),
}));

import { __resetRefreshLockForTests } from "@/services/oauth/refreshLock";
import { refresh } from "@/services/oauth/dispatcher";

beforeEach(() => {
  __resetRefreshLockForTests();
  mockGetActiveForExecution.mockReset();
  mockUpdateTokens.mockReset();
  mockSlackRefreshToken.mockReset();
});

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "int-1",
    userId: "user-1",
    provider: "slack",
    providerAccountId: "T123",
    displayName: "Acme",
    accessTokenEncrypted: "ENC-old-access",
    refreshTokenEncrypted: "ENC-old-refresh",
    accessTokenExpiresAt: null,
    scopes: ["chat:write"],
    accountMetadata: {},
    disconnectedAt: null,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
    ...overrides,
  };
}

describe("dispatcher.refresh — happy path", () => {
  it("decrypts refresh token, calls provider.refreshToken, persists via updateTokens", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(makeRow());
    mockSlackRefreshToken.mockResolvedValueOnce({
      accessTokenEncrypted: "ENC-new-access",
      refreshTokenEncrypted: "ENC-new-refresh",
      accessTokenExpiresAt: 1_780_000_000,
      scopes: ["chat:write"],
    });
    mockUpdateTokens.mockResolvedValueOnce(
      makeRow({ accessTokenEncrypted: "ENC-new-access", refreshTokenEncrypted: "ENC-new-refresh" }),
    );

    const result = await refresh({ userId: "user-1", provider: "slack" });

    // Provider received the decrypted refresh token (mock decrypts ENC- prefix).
    expect(mockSlackRefreshToken).toHaveBeenCalledWith("old-refresh");
    expect(mockUpdateTokens).toHaveBeenCalledWith({
      id: "int-1",
      tokens: {
        accessTokenEncrypted: "ENC-new-access",
        refreshTokenEncrypted: "ENC-new-refresh",
        accessTokenExpiresAt: 1_780_000_000,
        scopes: ["chat:write"],
      },
    });
    expect(result.integration.accessTokenEncrypted).toBe("ENC-new-access");
  });

  it("propagates accountId through the lookup", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(makeRow());
    mockSlackRefreshToken.mockResolvedValueOnce({
      accessTokenEncrypted: "ENC-x",
      refreshTokenEncrypted: "ENC-y",
      accessTokenExpiresAt: null,
      scopes: [],
    });
    mockUpdateTokens.mockResolvedValueOnce(makeRow());

    await refresh({ userId: "user-1", provider: "slack", accountId: "T999" });

    expect(mockGetActiveForExecution).toHaveBeenCalledWith("user-1", "slack", "T999");
  });

  it("treats omitted accountId as null", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(makeRow());
    mockSlackRefreshToken.mockResolvedValueOnce({
      accessTokenEncrypted: "ENC-x",
      refreshTokenEncrypted: "ENC-y",
      accessTokenExpiresAt: null,
      scopes: [],
    });
    mockUpdateTokens.mockResolvedValueOnce(makeRow());

    await refresh({ userId: "user-1", provider: "slack" });

    expect(mockGetActiveForExecution).toHaveBeenCalledWith("user-1", "slack", null);
  });
});

describe("dispatcher.refresh — error paths", () => {
  it("propagates RefreshNotSupportedError from provider untouched (caller translates)", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(makeRow());
    mockSlackRefreshToken.mockRejectedValueOnce(new RefreshNotSupportedError("slack"));

    await expect(refresh({ userId: "user-1", provider: "slack" })).rejects.toBeInstanceOf(
      RefreshNotSupportedError,
    );
    expect(mockUpdateTokens).not.toHaveBeenCalled();
  });

  it("throws clear error when no active integration exists", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(null);
    await expect(refresh({ userId: "user-1", provider: "slack" })).rejects.toThrow(
      /no active integration/i,
    );
    expect(mockSlackRefreshToken).not.toHaveBeenCalled();
  });

  it("throws clear error when row exists but refresh_token_encrypted is null", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(
      makeRow({ refreshTokenEncrypted: null }),
    );
    await expect(refresh({ userId: "user-1", provider: "slack" })).rejects.toThrow(
      /no refresh token/i,
    );
    expect(mockSlackRefreshToken).not.toHaveBeenCalled();
  });

  it("throws when manifest is unknown for the provider", async () => {
    await expect(refresh({ userId: "u", provider: "nope" })).rejects.toThrow(
      /unknown provider/i,
    );
  });

  it("rejects empty userId", async () => {
    await expect(refresh({ userId: "", provider: "slack" })).rejects.toThrow(
      /userId is required/i,
    );
  });
});

describe("dispatcher.refresh — concurrent calls coalesce via the lock", () => {
  it("two concurrent refreshes for same (user, provider, account) trigger ONE provider call", async () => {
    mockGetActiveForExecution.mockResolvedValue(makeRow());
    let providerInvocations = 0;
    mockSlackRefreshToken.mockImplementation(async () => {
      providerInvocations += 1;
      await new Promise((r) => setImmediate(r));
      return {
        accessTokenEncrypted: "ENC-new",
        refreshTokenEncrypted: "ENC-new-refresh",
        accessTokenExpiresAt: null,
        scopes: [],
      };
    });
    mockUpdateTokens.mockResolvedValue(makeRow({ accessTokenEncrypted: "ENC-new" }));

    const [a, b] = await Promise.all([
      refresh({ userId: "user-1", provider: "slack" }),
      refresh({ userId: "user-1", provider: "slack" }),
    ]);

    expect(providerInvocations).toBe(1);
    expect(a.integration.accessTokenEncrypted).toBe("ENC-new");
    expect(b.integration.accessTokenEncrypted).toBe("ENC-new");
    // Lookup happens once (inside the locked section).
    expect(mockGetActiveForExecution).toHaveBeenCalledTimes(1);
    expect(mockUpdateTokens).toHaveBeenCalledTimes(1);
  });

  it("different accountIds run independently (no collapsing)", async () => {
    mockGetActiveForExecution
      .mockResolvedValueOnce(makeRow({ providerAccountId: "T-A" }))
      .mockResolvedValueOnce(makeRow({ providerAccountId: "T-B" }));
    mockSlackRefreshToken.mockResolvedValue({
      accessTokenEncrypted: "ENC-x",
      refreshTokenEncrypted: "ENC-y",
      accessTokenExpiresAt: null,
      scopes: [],
    });
    mockUpdateTokens.mockResolvedValue(makeRow());

    await Promise.all([
      refresh({ userId: "user-1", provider: "slack", accountId: "T-A" }),
      refresh({ userId: "user-1", provider: "slack", accountId: "T-B" }),
    ]);

    expect(mockSlackRefreshToken).toHaveBeenCalledTimes(2);
    expect(mockGetActiveForExecution).toHaveBeenCalledTimes(2);
  });
});
