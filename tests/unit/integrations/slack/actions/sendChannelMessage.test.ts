/**
 * @jest-environment node
 *
 * Tests for integrations/slack/actions/sendChannelMessage.
 *
 * Mocks the integration repo + Slack API + token decryption so the handler
 * is exercised without network or DB access.
 *
 * Per docs/rules/variable-resolver.md §"Allowed flows":
 *   - The engine pre-resolves config; the handler receives concrete
 *     strings. The Zod schema acts as defense-in-depth.
 */

const mockGetActiveForExecution = jest.fn();
jest.mock("@/repositories/integrations", () => ({
  getActiveForExecution: (...args: unknown[]) => mockGetActiveForExecution(...args),
}));

const mockChatPostMessage = jest.fn();
jest.mock("@/integrations/slack/api/chatPostMessage", () => ({
  chatPostMessage: (...args: unknown[]) => mockChatPostMessage(...args),
  SlackApiError: jest.requireActual("@/integrations/slack/api/chatPostMessage")
    .SlackApiError,
}));

const mockDecryptToken = jest.fn();
jest.mock("@/core/encryption/tokens", () => ({
  decryptToken: (...args: unknown[]) => mockDecryptToken(...args),
}));

import { sendChannelMessage } from "@/integrations/slack/actions/sendChannelMessage";
import type { ActionHandlerInput } from "@/services/execution/handlers/types";
import type { TriggerEvent } from "@/contracts/triggerEvent";

const slackEvent: TriggerEvent = {
  provider: "slack",
  eventType: "message",
  eventId: "Ev1",
  occurredAt: "2026-05-07T00:00:00Z",
  accountId: "T0001",
  payload: { text: "hi", channel: "C123" },
};

const baseIntegration = {
  id: "int-1",
  userId: "user-1",
  provider: "slack",
  providerAccountId: "T0001",
  displayName: "Acme",
  accessTokenEncrypted: "ENCRYPTED_TOKEN",
  refreshTokenEncrypted: null,
  accessTokenExpiresAt: null,
  scopes: ["chat:write"],
  accountMetadata: {},
  disconnectedAt: null,
  createdAt: "2026-05-07T00:00:00Z",
  updatedAt: "2026-05-07T00:00:00Z",
};

function makeInput(
  config: Record<string, unknown>,
  overrides: Partial<ActionHandlerInput> = {},
): ActionHandlerInput {
  return {
    workflowId: "wf-1",
    userId: "user-1",
    runId: "run-1",
    nodeId: "n2",
    config,
    triggerEvent: slackEvent,
    ...overrides,
  };
}

beforeEach(() => {
  mockGetActiveForExecution.mockReset();
  mockChatPostMessage.mockReset();
  mockDecryptToken.mockReset();
});

describe("sendChannelMessage — happy path", () => {
  it("looks up integration by (userId, 'slack', triggerEvent.accountId), decrypts, posts, returns shaped output", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(baseIntegration);
    mockDecryptToken.mockReturnValueOnce("xoxb-real-token");
    mockChatPostMessage.mockResolvedValueOnce({
      ts: "1730000000.000123",
      channel: "C123",
      message: { text: "hello", user: "U_BOT" },
    });

    const result = await sendChannelMessage(
      makeInput({ channel: "C123", text: "hello" }),
    );

    expect(mockGetActiveForExecution).toHaveBeenCalledWith("user-1", "slack", "T0001");
    expect(mockDecryptToken).toHaveBeenCalledWith("ENCRYPTED_TOKEN");
    expect(mockChatPostMessage).toHaveBeenCalledWith({
      botToken: "xoxb-real-token",
      channel: "C123",
      text: "hello",
    });
    expect(result.output).toEqual({
      channel: "C123",
      ts: "1730000000.000123",
      message: { text: "hello", user: "U_BOT" },
    });
  });

  it("falls back to accountId=null when the trigger event is from a different provider (manual / scheduled / cross-provider trigger)", async () => {
    const otherProviderEvent: TriggerEvent = {
      ...slackEvent,
      provider: "gmail",
      accountId: "gmail-account",
    };
    mockGetActiveForExecution.mockResolvedValueOnce(baseIntegration);
    mockDecryptToken.mockReturnValueOnce("xoxb-real-token");
    mockChatPostMessage.mockResolvedValueOnce({
      ts: "1.0",
      channel: "C1",
      message: {},
    });

    await sendChannelMessage(
      makeInput(
        { channel: "C1", text: "x" },
        { triggerEvent: otherProviderEvent },
      ),
    );

    expect(mockGetActiveForExecution).toHaveBeenCalledWith("user-1", "slack", null);
  });
});

describe("sendChannelMessage — config validation (defense-in-depth)", () => {
  it("rejects missing channel even though the engine pre-resolves config", async () => {
    await expect(sendChannelMessage(makeInput({ text: "hi" }))).rejects.toThrow();
    expect(mockGetActiveForExecution).not.toHaveBeenCalled();
  });

  it("rejects empty text", async () => {
    await expect(
      sendChannelMessage(makeInput({ channel: "C1", text: "" })),
    ).rejects.toThrow();
  });
});

describe("sendChannelMessage — integration missing", () => {
  it("throws a clear 'connect Slack' error when no active integration exists for the workspace", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(null);
    await expect(
      sendChannelMessage(makeInput({ channel: "C1", text: "x" })),
    ).rejects.toThrow(/No active Slack integration found for workspace T0001/);
    expect(mockDecryptToken).not.toHaveBeenCalled();
    expect(mockChatPostMessage).not.toHaveBeenCalled();
  });

  it("uses a generic 'no Slack integration' message when accountId was null", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(null);
    const otherProviderEvent: TriggerEvent = {
      ...slackEvent,
      provider: "gmail",
      accountId: "g",
    };
    await expect(
      sendChannelMessage(
        makeInput(
          { channel: "C1", text: "x" },
          { triggerEvent: otherProviderEvent },
        ),
      ),
    ).rejects.toThrow(/No active Slack integration found for this user/);
  });
});

describe("sendChannelMessage — error propagation", () => {
  it("propagates SlackApiError from chatPostMessage so the engine maps to HANDLER_FAILED", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(baseIntegration);
    mockDecryptToken.mockReturnValueOnce("xoxb");
    mockChatPostMessage.mockRejectedValueOnce(new Error("Slack chat.postMessage failed: channel_not_found"));
    await expect(
      sendChannelMessage(makeInput({ channel: "C1", text: "x" })),
    ).rejects.toThrow(/channel_not_found/);
  });

  it("propagates token decryption failures (treated as unrecoverable)", async () => {
    mockGetActiveForExecution.mockResolvedValueOnce(baseIntegration);
    mockDecryptToken.mockImplementationOnce(() => {
      throw new Error("Token decryption failed");
    });
    await expect(
      sendChannelMessage(makeInput({ channel: "C1", text: "x" })),
    ).rejects.toThrow(/decryption/i);
    expect(mockChatPostMessage).not.toHaveBeenCalled();
  });
});
