/**
 * @jest-environment node
 *
 * Tests for the Gmail new_email filter matchers.
 *
 * These are direct ports of V1 gmail-processor.ts:1038-1108 behavior,
 * adapted to V2's UsersMessagesGetResult (format=metadata) shape.
 */

import { matchesFilters } from "@/integrations/gmail/triggers/newEmail/filters";
import { GmailNewEmailConfigSchema } from "@/integrations/gmail/triggers/newEmail/schema";
import type { UsersMessagesGetResult } from "@/integrations/gmail/api/usersMessagesGet";

function makeMessage(
  overrides: Partial<UsersMessagesGetResult> = {},
): UsersMessagesGetResult {
  return {
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Hello world",
    internalDate: String(Date.now()),
    sizeEstimate: 1024,
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: "Alice <alice@example.com>" },
        { name: "To", value: "bob@example.com" },
        { name: "Subject", value: "Hello world" },
      ],
    },
    ...overrides,
  };
}

function makeConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return GmailNewEmailConfigSchema.parse({
    snapshot: { historyId: "1", capturedAt: "2026-05-07T00:00:00Z" },
    ...overrides,
  });
}

describe("matchesFilters — labels", () => {
  it("AND-matches when at least one configured label is present (V1 parity)", () => {
    expect(
      matchesFilters(
        makeMessage({ labelIds: ["INBOX", "UNREAD"] }),
        makeConfig({ labelIds: ["INBOX"] }),
      ),
    ).toBe(true);
  });

  it("rejects when none of the configured labels match", () => {
    expect(
      matchesFilters(
        makeMessage({ labelIds: ["UNREAD"] }),
        makeConfig({ labelIds: ["INBOX"] }),
      ),
    ).toBe(false);
  });

  it("supports multi-label arrays (no Gmail API cardinality issue — filtered client-side)", () => {
    expect(
      matchesFilters(
        makeMessage({ labelIds: ["IMPORTANT"] }),
        makeConfig({ labelIds: ["INBOX", "IMPORTANT"] }),
      ),
    ).toBe(true);
  });

  it("empty configured labelIds means 'no constraint'", () => {
    expect(
      matchesFilters(
        makeMessage({ labelIds: [] }),
        makeConfig({ labelIds: [] }),
      ),
    ).toBe(true);
  });
});

describe("matchesFilters — from", () => {
  it("matches sender by email-only token, case-insensitive", () => {
    expect(
      matchesFilters(
        makeMessage({
          payload: {
            mimeType: "multipart/alternative",
            headers: [
              { name: "From", value: '"Alice" <ALICE@example.com>' },
            ],
          },
        }),
        makeConfig({ from: ["alice@example.com"] }),
      ),
    ).toBe(true);
  });

  it("OR-matches across multiple configured senders", () => {
    expect(
      matchesFilters(
        makeMessage({
          payload: {
            mimeType: "multipart/alternative",
            headers: [{ name: "From", value: "carol@example.com" }],
          },
        }),
        makeConfig({ from: ["alice@example.com", "carol@example.com"] }),
      ),
    ).toBe(true);
  });

  it("rejects when sender doesn't match any configured value", () => {
    expect(
      matchesFilters(
        makeMessage({
          payload: {
            mimeType: "multipart/alternative",
            headers: [{ name: "From", value: "eve@example.com" }],
          },
        }),
        makeConfig({ from: ["alice@example.com"] }),
      ),
    ).toBe(false);
  });

  it("empty configured from means 'any sender'", () => {
    expect(
      matchesFilters(makeMessage(), makeConfig({ from: [] })),
    ).toBe(true);
  });
});

describe("matchesFilters — subject", () => {
  it("exact match (default) requires the subject to equal exactly", () => {
    expect(
      matchesFilters(
        makeMessage({
          payload: {
            mimeType: "multipart/alternative",
            headers: [{ name: "Subject", value: "Hello world" }],
          },
        }),
        makeConfig({ subject: "Hello world" }),
      ),
    ).toBe(true);
    expect(
      matchesFilters(
        makeMessage({
          payload: {
            mimeType: "multipart/alternative",
            headers: [{ name: "Subject", value: "Hello world" }],
          },
        }),
        makeConfig({ subject: "Hello" }),
      ),
    ).toBe(false);
  });

  it("substring match when subjectExactMatch is false (case-insensitive)", () => {
    expect(
      matchesFilters(
        makeMessage({
          payload: {
            mimeType: "multipart/alternative",
            headers: [{ name: "Subject", value: "Hello WORLD" }],
          },
        }),
        makeConfig({ subject: "world", subjectExactMatch: false }),
      ),
    ).toBe(true);
  });

  it("empty configured subject means 'no constraint'", () => {
    expect(
      matchesFilters(makeMessage(), makeConfig({ subject: "" })),
    ).toBe(true);
  });
});

describe("matchesFilters — hasAttachment (heuristic on top-level mimeType)", () => {
  it("'yes' matches multipart/mixed (treated as attached)", () => {
    expect(
      matchesFilters(
        makeMessage({
          payload: {
            mimeType: "multipart/mixed",
            headers: [{ name: "Subject", value: "x" }],
          },
        }),
        makeConfig({ hasAttachment: "yes", subject: "" }),
      ),
    ).toBe(true);
  });

  it("'no' rejects multipart/mixed", () => {
    expect(
      matchesFilters(
        makeMessage({
          payload: {
            mimeType: "multipart/mixed",
            headers: [{ name: "Subject", value: "x" }],
          },
        }),
        makeConfig({ hasAttachment: "no", subject: "" }),
      ),
    ).toBe(false);
  });

  it("'no' accepts multipart/alternative", () => {
    expect(
      matchesFilters(
        makeMessage({
          payload: {
            mimeType: "multipart/alternative",
            headers: [{ name: "Subject", value: "x" }],
          },
        }),
        makeConfig({ hasAttachment: "no", subject: "" }),
      ),
    ).toBe(true);
  });

  it("'any' is a no-op", () => {
    expect(
      matchesFilters(
        makeMessage({
          payload: {
            mimeType: "multipart/mixed",
            headers: [{ name: "Subject", value: "x" }],
          },
        }),
        makeConfig({ hasAttachment: "any", subject: "" }),
      ),
    ).toBe(true);
  });
});

describe("matchesFilters — combined", () => {
  it("all filters must pass simultaneously (V1 parity: AND across categories)", () => {
    const message = makeMessage({
      labelIds: ["INBOX"],
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "alice@example.com" },
          { name: "Subject", value: "Invoice" },
        ],
      },
    });
    const passingConfig = makeConfig({
      labelIds: ["INBOX"],
      from: ["alice@example.com"],
      subject: "Invoice",
      hasAttachment: "yes",
    });
    expect(matchesFilters(message, passingConfig)).toBe(true);

    // Flip subject — overall must fail.
    const failingConfig = makeConfig({
      labelIds: ["INBOX"],
      from: ["alice@example.com"],
      subject: "Receipt",
      hasAttachment: "yes",
    });
    expect(matchesFilters(message, failingConfig)).toBe(false);
  });
});
