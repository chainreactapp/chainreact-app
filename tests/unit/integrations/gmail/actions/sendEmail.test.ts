/**
 * @jest-environment node
 *
 * Tests for the Gmail sendEmail action handler. Mocks refreshAndRetry +
 * usersMessagesSend so the handler's apiCall closure can be exercised
 * without coupling to the real wrapper or HTTP layer (those have their
 * own dedicated test suites).
 */
import type { TriggerEvent } from "@/contracts/triggerEvent";

const mockRefreshAndRetry = jest.fn();
const mockUsersMessagesSend = jest.fn();

jest.mock("@/services/oauth/refreshAndRetry", () => ({
  refreshAndRetry: (...args: unknown[]) => mockRefreshAndRetry(...args),
  // Re-export error classes (the handler doesn't import them directly,
  // but type-only imports flow through; provide so dispatcher imports
  // resolve cleanly in the rest of the module graph).
  Unauthorized401Error: class extends Error {
    constructor(message?: string) {
      super(message);
      this.name = "Unauthorized401Error";
    }
  },
  IntegrationActionRequiredError: class extends Error {},
}));

jest.mock("@/integrations/gmail/api/usersMessagesSend", () => ({
  usersMessagesSend: (...args: unknown[]) => mockUsersMessagesSend(...args),
}));

import { sendEmail } from "@/integrations/gmail/actions/sendEmail";

beforeEach(() => {
  mockRefreshAndRetry.mockReset();
  mockUsersMessagesSend.mockReset();
});

function makeGmailTriggerEvent(accountId: string): TriggerEvent {
  return {
    provider: "gmail",
    eventType: "new_email",
    eventId: "evt-1",
    occurredAt: "2026-05-07T12:00:00Z",
    accountId,
    payload: {},
  };
}

function makeNonGmailTriggerEvent(): TriggerEvent {
  return {
    provider: "slack",
    eventType: "message_received",
    eventId: "evt-2",
    occurredAt: "2026-05-07T12:00:00Z",
    accountId: "T123",
    payload: {},
  };
}

function baseHandlerInput(overrides: { config?: Record<string, unknown>; triggerEvent?: TriggerEvent } = {}) {
  return {
    workflowId: "wf-1",
    userId: "user-1",
    runId: "run-1",
    nodeId: "node-send",
    config: overrides.config ?? {
      to: "alice@example.com",
      subject: "Hello",
      textBody: "Plain body.",
    },
    triggerEvent: overrides.triggerEvent ?? makeGmailTriggerEvent("alice@example.com"),
  };
}

describe("sendEmail — refreshAndRetry usage", () => {
  it("calls refreshAndRetry with userId, provider 'gmail', and accountId from a Gmail trigger event", async () => {
    mockRefreshAndRetry.mockResolvedValueOnce({
      id: "msg-1",
      threadId: "thr-1",
    });

    await sendEmail(baseHandlerInput());

    expect(mockRefreshAndRetry).toHaveBeenCalledTimes(1);
    const call = mockRefreshAndRetry.mock.calls[0]![0];
    expect(call.userId).toBe("user-1");
    expect(call.provider).toBe("gmail");
    expect(call.accountId).toBe("alice@example.com");
    expect(typeof call.apiCall).toBe("function");
  });

  it("passes accountId: null when the trigger event is not Gmail-shaped", async () => {
    mockRefreshAndRetry.mockResolvedValueOnce({ id: "m", threadId: "t" });

    await sendEmail(
      baseHandlerInput({ triggerEvent: makeNonGmailTriggerEvent() }),
    );

    expect(mockRefreshAndRetry.mock.calls[0]![0].accountId).toBeNull();
  });
});

describe("sendEmail — apiCall closure builds RFC 5322 + calls Gmail API", () => {
  it("invokes usersMessagesSend with the provided access token and a base64url raw message", async () => {
    // Drive the wrapper's apiCall callback with a fake token; capture
    // what usersMessagesSend received.
    mockRefreshAndRetry.mockImplementation(async (input: { apiCall: (t: string) => Promise<unknown> }) => {
      return await input.apiCall("ya29.live-token");
    });
    mockUsersMessagesSend.mockResolvedValueOnce({
      id: "msg-99",
      threadId: "thr-99",
    });

    await sendEmail(
      baseHandlerInput({
        config: {
          to: "alice@example.com",
          subject: "Hi",
          textBody: "Plain body.",
        },
      }),
    );

    expect(mockUsersMessagesSend).toHaveBeenCalledTimes(1);
    const sendArgs = mockUsersMessagesSend.mock.calls[0]![0];
    expect(sendArgs.accessToken).toBe("ya29.live-token");

    // rawMessage is base64url-encoded RFC 5322 — decode and check headers
    const decoded = Buffer.from(sendArgs.rawMessage, "base64url").toString("utf8");
    expect(decoded).toContain("To: alice@example.com\r\n");
    expect(decoded).toContain("Subject: Hi\r\n");
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"\r\n');
    expect(decoded).toContain("\r\n\r\nPlain body.");
  });

  it("builds multipart/alternative when both textBody and htmlBody are provided", async () => {
    mockRefreshAndRetry.mockImplementation(async (input: { apiCall: (t: string) => Promise<unknown> }) => {
      return await input.apiCall("token");
    });
    mockUsersMessagesSend.mockResolvedValueOnce({ id: "m", threadId: "t" });

    await sendEmail(
      baseHandlerInput({
        config: {
          to: "alice@example.com",
          subject: "Both",
          textBody: "Plain.",
          htmlBody: "<p>HTML.</p>",
        },
      }),
    );

    const decoded = Buffer.from(
      mockUsersMessagesSend.mock.calls[0]![0].rawMessage,
      "base64url",
    ).toString("utf8");
    expect(decoded).toContain("Content-Type: multipart/alternative;");
    expect(decoded).toContain("Plain.");
    expect(decoded).toContain("<p>HTML.</p>");
    // text part comes before html part
    expect(decoded.indexOf("Plain.")).toBeLessThan(decoded.indexOf("<p>HTML.</p>"));
  });

  it("includes Cc and Bcc when provided in config", async () => {
    mockRefreshAndRetry.mockImplementation(async (input: { apiCall: (t: string) => Promise<unknown> }) => {
      return await input.apiCall("token");
    });
    mockUsersMessagesSend.mockResolvedValueOnce({ id: "m", threadId: "t" });

    await sendEmail(
      baseHandlerInput({
        config: {
          to: "alice@example.com",
          subject: "S",
          textBody: "B",
          cc: "carbon@example.com",
          bcc: "blind@example.com",
        },
      }),
    );

    const decoded = Buffer.from(
      mockUsersMessagesSend.mock.calls[0]![0].rawMessage,
      "base64url",
    ).toString("utf8");
    expect(decoded).toContain("Cc: carbon@example.com\r\n");
    expect(decoded).toContain("Bcc: blind@example.com\r\n");
  });
});

describe("sendEmail — output shape (Decision 2d-4)", () => {
  it("returns { id, threadId, to, subject } on success", async () => {
    mockRefreshAndRetry.mockResolvedValueOnce({
      id: "msg-99",
      threadId: "thr-99",
    });

    const result = await sendEmail(
      baseHandlerInput({
        config: {
          to: "alice@example.com",
          subject: "Hello",
          textBody: "B",
        },
      }),
    );

    expect(result).toEqual({
      output: {
        id: "msg-99",
        threadId: "thr-99",
        to: "alice@example.com",
        subject: "Hello",
      },
    });
  });
});

describe("sendEmail — error propagation", () => {
  it("throws ZodError when the config is invalid (no body)", async () => {
    await expect(
      sendEmail(
        baseHandlerInput({
          config: {
            to: "alice@example.com",
            subject: "S",
            // neither textBody nor htmlBody
          },
        }),
      ),
    ).rejects.toThrow();
    // refreshAndRetry never invoked when schema parse fails.
    expect(mockRefreshAndRetry).not.toHaveBeenCalled();
  });

  it("propagates errors from refreshAndRetry untouched", async () => {
    mockRefreshAndRetry.mockRejectedValueOnce(new Error("Gmail send failed: invalid_recipient"));
    await expect(sendEmail(baseHandlerInput())).rejects.toThrow(/invalid_recipient/);
  });
});
