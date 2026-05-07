/**
 * @jest-environment node
 */
import { usersGetProfile } from "@/integrations/gmail/api/usersGetProfile";
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

describe("usersGetProfile", () => {
  it("GETs the profile endpoint with Bearer auth", async () => {
    const fetchSpy = mockFetchOnce({
      ok: true,
      json: {
        emailAddress: "alice@example.com",
        messagesTotal: 1234,
        threadsTotal: 567,
        historyId: "987654321",
      },
    });

    const result = await usersGetProfile({ accessToken: "ya29.x" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer ya29.x" },
      }),
    );
    expect(result).toEqual({
      emailAddress: "alice@example.com",
      messagesTotal: 1234,
      threadsTotal: 567,
      historyId: "987654321",
    });
  });

  it("respects GMAIL_API_BASE override", async () => {
    process.env.GMAIL_API_BASE = "http://127.0.0.1:9877";
    const fetchSpy = mockFetchOnce({
      ok: true,
      json: { emailAddress: "a@b.com", messagesTotal: 0, threadsTotal: 0, historyId: "1" },
    });
    await usersGetProfile({ accessToken: "x" });
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "http://127.0.0.1:9877/gmail/v1/users/me/profile",
    );
  });

  it("throws Unauthorized401Error on 401 (refreshAndRetry contract)", async () => {
    mockFetchOnce({ ok: false, status: 401, json: { error: { code: 401 } } });
    await expect(usersGetProfile({ accessToken: "stale" })).rejects.toBeInstanceOf(
      Unauthorized401Error,
    );
  });

  it("surfaces Google's error.message on non-401 errors", async () => {
    mockFetchOnce({
      ok: false,
      status: 403,
      json: { error: { code: 403, message: "Insufficient Permission" } },
    });
    await expect(usersGetProfile({ accessToken: "x" })).rejects.toThrow(
      /Insufficient Permission/,
    );
  });

  it("falls back to HTTP status when response is not JSON", async () => {
    mockFetchOnce({ ok: false, status: 503, json: "Service Unavailable" });
    await expect(usersGetProfile({ accessToken: "x" })).rejects.toThrow(/HTTP 503/);
  });
});
