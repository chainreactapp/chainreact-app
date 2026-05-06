/**
 * @jest-environment node
 *
 * Tests for services/oauth/refreshAndRetry — the reactive refresh-and-
 * retry wrapper handlers wrap their principal outbound calls in. Mocks the
 * dispatcher's refresh and the integrations repo so we can drive every
 * branch (200, 401-then-200, 401-then-401, refresh-not-supported,
 * non-401-error, concurrent-401-coalesce).
 *
 * Note on placement: this lives in services/, not core/, because it
 * orchestrates repository + dispatcher + encryption — `core/` is restricted
 * to imports from `contracts/` only per
 * project-structure-and-module-boundaries.md §4 (the whole-codebase rule
 * that overrides subsystem rule docs). The OAuth-dispatcher rule doc names
 * `core/integrations/refreshAndRetry.ts` aspirationally; the structure
 * lint enforces the override.
 */
import { RefreshNotSupportedError } from "@/contracts/integration";

const mockGetActiveForExecution = jest.fn();
const mockDispatcherRefresh = jest.fn();

jest.mock("@/repositories/integrations", () => ({
  getActiveForExecution: mockGetActiveForExecution,
  updateTokens: jest.fn(),
  upsertActive: jest.fn(),
}));

jest.mock("@/services/oauth/dispatcher", () => ({
  refresh: mockDispatcherRefresh,
}));

jest.mock("@/core/encryption/tokens", () => ({
  decryptToken: jest.fn((enc: string) => enc.replace(/^ENC-/, "")),
  encryptToken: jest.fn((p: string) => `ENC-${p}`),
}));

import {
  IntegrationActionRequiredError,
  Unauthorized401Error,
  refreshAndRetry,
} from "@/services/oauth/refreshAndRetry";

beforeEach(() => {
  mockGetActiveForExecution.mockReset();
  mockDispatcherRefresh.mockReset();
});

function makeRow(accessEnc: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "int-1",
    userId: "user-1",
    provider: "gmail",
    providerAccountId: "alice@example.com",
    displayName: "Alice",
    accessTokenEncrypted: accessEnc,
    refreshTokenEncrypted: "ENC-refresh-token",
    accessTokenExpiresAt: null,
    scopes: ["gmail.send"],
    accountMetadata: {},
    disconnectedAt: null,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
    ...overrides,
  };
}

describe("refreshAndRetry — happy path (no 401)", () => {
  it("runs apiCall once with the decrypted access token and returns the result", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(makeRow("ENC-fresh"));
    const apiCall = jest.fn().mockResolvedValue({ messageId: "m-1" });

    const result = await refreshAndRetry({
      userId: "user-1",
      provider: "gmail",
      apiCall,
    });

    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall).toHaveBeenCalledWith("fresh"); // ENC- prefix stripped by mock decrypt
    expect(mockDispatcherRefresh).not.toHaveBeenCalled();
    expect(result).toEqual({ messageId: "m-1" });
  });

  it("non-401 errors propagate untouched (no refresh)", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(makeRow("ENC-tok"));
    const apiCall = jest.fn().mockRejectedValue(new Error("HTTP 500 service unavailable"));

    await expect(
      refreshAndRetry({ userId: "user-1", provider: "gmail", apiCall }),
    ).rejects.toThrow(/HTTP 500/);
    expect(mockDispatcherRefresh).not.toHaveBeenCalled();
    expect(apiCall).toHaveBeenCalledTimes(1);
  });
});

describe("refreshAndRetry — 401 → refresh + retry", () => {
  it("401 → refresh succeeds → retry with new token returns 200", async () => {
    mockGetActiveForExecution
      .mockResolvedValueOnce(makeRow("ENC-stale"))   // initial lookup
      .mockResolvedValueOnce(makeRow("ENC-fresh"));  // post-refresh refetch
    mockDispatcherRefresh.mockResolvedValueOnce({
      integration: makeRow("ENC-fresh"),
    });
    const apiCall = jest
      .fn()
      .mockRejectedValueOnce(new Unauthorized401Error())
      .mockResolvedValueOnce({ ok: true });

    const result = await refreshAndRetry({
      userId: "user-1",
      provider: "gmail",
      apiCall,
    });

    expect(result).toEqual({ ok: true });
    expect(apiCall).toHaveBeenCalledTimes(2);
    expect(apiCall).toHaveBeenNthCalledWith(1, "stale");
    expect(apiCall).toHaveBeenNthCalledWith(2, "fresh");
    expect(mockDispatcherRefresh).toHaveBeenCalledTimes(1);
    expect(mockDispatcherRefresh).toHaveBeenCalledWith({
      userId: "user-1",
      provider: "gmail",
      accountId: null,
    });
  });

  it("401 → refresh succeeds → retry STILL 401 → throws IntegrationActionRequiredError(refresh_failed)", async () => {
    mockGetActiveForExecution
      .mockResolvedValueOnce(makeRow("ENC-stale"))
      .mockResolvedValueOnce(makeRow("ENC-fresh"));
    mockDispatcherRefresh.mockResolvedValueOnce({ integration: makeRow("ENC-fresh") });
    const apiCall = jest
      .fn()
      .mockRejectedValueOnce(new Unauthorized401Error())
      .mockRejectedValueOnce(new Unauthorized401Error("still 401"));

    await expect(
      refreshAndRetry({ userId: "user-1", provider: "gmail", apiCall }),
    ).rejects.toMatchObject({
      name: "IntegrationActionRequiredError",
      reason: "refresh_failed",
      provider: "gmail",
      userId: "user-1",
    });
    expect(apiCall).toHaveBeenCalledTimes(2);
  });

  it("threads accountId through both the lookup AND the refresh call", async () => {
    mockGetActiveForExecution
      .mockResolvedValueOnce(makeRow("ENC-stale"))
      .mockResolvedValueOnce(makeRow("ENC-fresh"));
    mockDispatcherRefresh.mockResolvedValueOnce({ integration: makeRow("ENC-fresh") });
    const apiCall = jest
      .fn()
      .mockRejectedValueOnce(new Unauthorized401Error())
      .mockResolvedValueOnce("ok");

    await refreshAndRetry({
      userId: "user-1",
      provider: "gmail",
      accountId: "alice@example.com",
      apiCall,
    });

    expect(mockGetActiveForExecution).toHaveBeenNthCalledWith(
      1,
      "user-1",
      "gmail",
      "alice@example.com",
    );
    expect(mockGetActiveForExecution).toHaveBeenNthCalledWith(
      2,
      "user-1",
      "gmail",
      "alice@example.com",
    );
    expect(mockDispatcherRefresh).toHaveBeenCalledWith({
      userId: "user-1",
      provider: "gmail",
      accountId: "alice@example.com",
    });
  });
});

describe("refreshAndRetry — refresh-not-supported provider (Slack-shaped path)", () => {
  it("translates RefreshNotSupportedError into IntegrationActionRequiredError(refresh_not_supported)", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(makeRow("ENC-tok", { provider: "slack" }));
    mockDispatcherRefresh.mockRejectedValueOnce(new RefreshNotSupportedError("slack"));
    const apiCall = jest.fn().mockRejectedValue(new Unauthorized401Error());

    await expect(
      refreshAndRetry({ userId: "user-1", provider: "slack", apiCall }),
    ).rejects.toMatchObject({
      name: "IntegrationActionRequiredError",
      reason: "refresh_not_supported",
      provider: "slack",
      userId: "user-1",
    });
    expect(apiCall).toHaveBeenCalledTimes(1); // no retry attempted
  });

  it("translates other refresh errors into IntegrationActionRequiredError(refresh_failed)", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(makeRow("ENC-tok"));
    mockDispatcherRefresh.mockRejectedValueOnce(new Error("provider 503"));
    const apiCall = jest.fn().mockRejectedValue(new Unauthorized401Error());

    await expect(
      refreshAndRetry({ userId: "user-1", provider: "gmail", apiCall }),
    ).rejects.toMatchObject({
      name: "IntegrationActionRequiredError",
      reason: "refresh_failed",
    });
  });
});

describe("refreshAndRetry — error class shape", () => {
  it("IntegrationActionRequiredError carries cause through Error.cause", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(makeRow("ENC-tok"));
    const upstream = new Error("network down");
    mockDispatcherRefresh.mockRejectedValueOnce(upstream);
    const apiCall = jest.fn().mockRejectedValue(new Unauthorized401Error());

    try {
      await refreshAndRetry({ userId: "user-1", provider: "gmail", apiCall });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(IntegrationActionRequiredError);
      expect((err as IntegrationActionRequiredError).cause).toBe(upstream);
    }
  });
});

describe("refreshAndRetry — missing integration", () => {
  it("throws clear error when no active integration exists at lookup", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(null);
    const apiCall = jest.fn();
    await expect(
      refreshAndRetry({ userId: "user-1", provider: "gmail", apiCall }),
    ).rejects.toThrow(/no active integration/i);
    expect(apiCall).not.toHaveBeenCalled();
    expect(mockDispatcherRefresh).not.toHaveBeenCalled();
  });

  it("throws when integration disappears between refresh and retry", async () => {
    mockGetActiveForExecution
      .mockResolvedValueOnce(makeRow("ENC-stale"))
      .mockResolvedValueOnce(null); // disappeared post-refresh
    mockDispatcherRefresh.mockResolvedValueOnce({ integration: makeRow("ENC-fresh") });
    const apiCall = jest.fn().mockRejectedValueOnce(new Unauthorized401Error());

    await expect(
      refreshAndRetry({ userId: "user-1", provider: "gmail", apiCall }),
    ).rejects.toThrow(/disappeared between refresh and retry/i);
  });
});
