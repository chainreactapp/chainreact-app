/**
 * @jest-environment node
 *
 * Tests for the Gmail users.messages.send API wrapper. Mocks fetch and
 * verifies request shape, response handling, and the 401-throws-
 * Unauthorized401Error contract that refreshAndRetry depends on.
 */
import { usersMessagesSend } from "@/integrations/gmail/api/usersMessagesSend";
import { Unauthorized401Error } from "@/services/oauth/refreshAndRetry";

beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockReset?.();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.GMAIL_API_BASE;
});

function mockFetchOnce(response: { ok: boolean; status?: number; json: unknown }) {
  return jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response(
        typeof response.json === "string"
          ? response.json
          : JSON.stringify(response.json),
        { status: response.status ?? (response.ok ? 200 : 500) },
      ),
    );
}

describe("usersMessagesSend — request shape", () => {
  it("POSTs to the Gmail send endpoint with Bearer auth + JSON body", async () => {
    const fetchSpy = mockFetchOnce({
      ok: true,
      json: { id: "msg-1", threadId: "thr-1", labelIds: ["SENT"] },
    });

    await usersMessagesSend({
      accessToken: "ya29.access-token",
      rawMessage: "RFC5322-base64url",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer ya29.access-token",
          "Content-Type": "application/json",
        },
      }),
    );
    const body = fetchSpy.mock.calls[0]![1]!.body as string;
    expect(JSON.parse(body)).toEqual({ raw: "RFC5322-base64url" });
  });

  it("returns the parsed response unchanged", async () => {
    mockFetchOnce({
      ok: true,
      json: { id: "msg-abc", threadId: "thr-xyz", labelIds: ["SENT", "INBOX"] },
    });

    const result = await usersMessagesSend({
      accessToken: "x",
      rawMessage: "y",
    });

    expect(result).toEqual({
      id: "msg-abc",
      threadId: "thr-xyz",
      labelIds: ["SENT", "INBOX"],
    });
  });

  it("respects GMAIL_API_BASE override (e2e mock surface)", async () => {
    process.env.GMAIL_API_BASE = "http://127.0.0.1:9877";
    const fetchSpy = mockFetchOnce({
      ok: true,
      json: { id: "m", threadId: "t" },
    });

    await usersMessagesSend({ accessToken: "x", rawMessage: "y" });

    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "http://127.0.0.1:9877/gmail/v1/users/me/messages/send",
    );
  });
});

describe("usersMessagesSend — error handling", () => {
  it("throws Unauthorized401Error on HTTP 401 (refreshAndRetry contract)", async () => {
    mockFetchOnce({ ok: false, status: 401, json: { error: { code: 401, message: "invalid_token" } } });

    await expect(
      usersMessagesSend({ accessToken: "stale", rawMessage: "y" }),
    ).rejects.toBeInstanceOf(Unauthorized401Error);
  });

  it("surfaces Google's error.message on 4xx (non-401)", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      json: { error: { code: 400, message: "Invalid recipient address.", status: "INVALID_ARGUMENT" } },
    });

    await expect(
      usersMessagesSend({ accessToken: "x", rawMessage: "y" }),
    ).rejects.toThrow(/Invalid recipient address/);
  });

  it("falls back to Google's error.status when message is missing", async () => {
    mockFetchOnce({
      ok: false,
      status: 403,
      json: { error: { code: 403, status: "PERMISSION_DENIED" } },
    });

    await expect(
      usersMessagesSend({ accessToken: "x", rawMessage: "y" }),
    ).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it("falls back to HTTP status when response is not JSON", async () => {
    mockFetchOnce({ ok: false, status: 502, json: "Bad Gateway plain text" });

    await expect(
      usersMessagesSend({ accessToken: "x", rawMessage: "y" }),
    ).rejects.toThrow(/HTTP 502/);
  });
});
