/**
 * @jest-environment node
 */

import { buildTriggerEvent } from "@/integrations/gmail/triggers/newEmail/messageHydration";
import { TriggerEventSchema } from "@/contracts/triggerEvent";
import type { UsersMessagesGetResult } from "@/integrations/gmail/api/usersMessagesGet";

function makeMessage(
  overrides: Partial<UsersMessagesGetResult> = {},
): UsersMessagesGetResult {
  return {
    id: "msg-123",
    threadId: "thr-456",
    labelIds: ["INBOX"],
    snippet: "snippet",
    internalDate: String(Date.UTC(2026, 4, 7, 12, 0, 0)),
    sizeEstimate: 2048,
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "alice@example.com" },
        { name: "Subject", value: "Hi" },
        { name: "Date", value: "Thu, 07 May 2026 12:00:00 +0000" },
      ],
    },
    ...overrides,
  };
}

describe("buildTriggerEvent", () => {
  it("returns a TriggerEvent that passes the contract schema", () => {
    const event = buildTriggerEvent({
      emailAddress: "user@example.com",
      message: makeMessage(),
    });
    expect(() => TriggerEventSchema.parse(event)).not.toThrow();
  });

  it("uses Gmail message id as eventId (the dedup key)", () => {
    const event = buildTriggerEvent({
      emailAddress: "user@example.com",
      message: makeMessage({ id: "abc123" }),
    });
    expect(event.eventId).toBe("abc123");
  });

  it("provider/eventType are constants", () => {
    const event = buildTriggerEvent({
      emailAddress: "user@example.com",
      message: makeMessage(),
    });
    expect(event.provider).toBe("gmail");
    expect(event.eventType).toBe("new_email");
  });

  it("accountId is the email address (matches manifest accountIdField: email)", () => {
    const event = buildTriggerEvent({
      emailAddress: "alice@example.com",
      message: makeMessage(),
    });
    expect(event.accountId).toBe("alice@example.com");
  });

  it("converts internalDate (ms-as-string) to ISO 8601 occurredAt", () => {
    const ms = Date.UTC(2026, 4, 7, 12, 0, 0);
    const event = buildTriggerEvent({
      emailAddress: "user@example.com",
      message: makeMessage({ internalDate: String(ms) }),
    });
    expect(event.occurredAt).toBe(new Date(ms).toISOString());
  });

  it("flags hasAttachments true on multipart/mixed (heuristic)", () => {
    const event = buildTriggerEvent({
      emailAddress: "user@example.com",
      message: makeMessage({
        payload: {
          mimeType: "multipart/mixed",
          headers: [{ name: "Subject", value: "x" }],
        },
      }),
    });
    expect(event.payload.hasAttachments).toBe(true);
  });

  it("flags hasAttachments false on non-multipart/mixed", () => {
    const event = buildTriggerEvent({
      emailAddress: "user@example.com",
      message: makeMessage({
        payload: {
          mimeType: "multipart/alternative",
          headers: [{ name: "Subject", value: "x" }],
        },
      }),
    });
    expect(event.payload.hasAttachments).toBe(false);
  });

  it("extracts headers case-insensitively into payload", () => {
    const event = buildTriggerEvent({
      emailAddress: "user@example.com",
      message: makeMessage({
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "FROM", value: "alice@example.com" },
            { name: "subject", value: "Lowercased name" },
          ],
        },
      }),
    });
    expect(event.payload.from).toBe("alice@example.com");
    expect(event.payload.subject).toBe("Lowercased name");
  });

  it("missing headers map to empty strings (non-undefined for downstream variable resolution)", () => {
    const event = buildTriggerEvent({
      emailAddress: "user@example.com",
      message: makeMessage({
        payload: {
          mimeType: "text/plain",
          headers: [],
        },
      }),
    });
    expect(event.payload.from).toBe("");
    expect(event.payload.subject).toBe("");
    expect(event.payload.cc).toBe("");
  });
});
