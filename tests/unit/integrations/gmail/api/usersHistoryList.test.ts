/**
 * @jest-environment node
 */
import {
  HistoryListStaleCursorError,
  usersHistoryList,
} from "@/integrations/gmail/api/usersHistoryList";
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

describe("usersHistoryList — request shape", () => {
  it("sends startHistoryId, maxResults, and BOTH historyTypes (V1 parity)", async () => {
    const fetchSpy = mockFetchOnce({
      ok: true,
      json: { history: [], historyId: "100" },
    });

    await usersHistoryList({
      accessToken: "x",
      startHistoryId: "42",
    });

    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain("startHistoryId=42");
    expect(url).toContain("maxResults=100");
    // Both historyTypes must be appended — V1 caught label-only changes too.
    expect(url.match(/historyTypes=messageAdded/g)).toHaveLength(1);
    expect(url.match(/historyTypes=labelAdded/g)).toHaveLength(1);
  });

  it("does NOT send a labelId param — V1 omitted it; multi-label is filtered client-side", async () => {
    const fetchSpy = mockFetchOnce({
      ok: true,
      json: { history: [], historyId: "1" },
    });

    await usersHistoryList({ accessToken: "x", startHistoryId: "1" });

    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).not.toContain("labelId=");
  });

  it("threads pageToken through when provided", async () => {
    const fetchSpy = mockFetchOnce({
      ok: true,
      json: { history: [], historyId: "1" },
    });

    await usersHistoryList({
      accessToken: "x",
      startHistoryId: "1",
      pageToken: "pg-abc",
    });

    expect(fetchSpy.mock.calls[0]![0] as string).toContain("pageToken=pg-abc");
  });

  it("returns history records and nextPageToken when present", async () => {
    mockFetchOnce({
      ok: true,
      json: {
        history: [
          {
            id: "h1",
            messagesAdded: [{ message: { id: "m1", threadId: "t1" } }],
          },
        ],
        nextPageToken: "next-page",
        historyId: "200",
      },
    });

    const result = await usersHistoryList({
      accessToken: "x",
      startHistoryId: "100",
    });

    expect(result.history).toHaveLength(1);
    expect(result.nextPageToken).toBe("next-page");
    expect(result.historyId).toBe("200");
  });

  it("falls back to startHistoryId when API omits historyId in response", async () => {
    mockFetchOnce({ ok: true, json: { history: [] } });
    const result = await usersHistoryList({ accessToken: "x", startHistoryId: "42" });
    expect(result.historyId).toBe("42");
  });
});

describe("usersHistoryList — error handling", () => {
  it("throws Unauthorized401Error on 401", async () => {
    mockFetchOnce({ ok: false, status: 401, json: { error: { code: 401 } } });
    await expect(
      usersHistoryList({ accessToken: "x", startHistoryId: "1" }),
    ).rejects.toBeInstanceOf(Unauthorized401Error);
  });

  it("throws HistoryListStaleCursorError on 404 (stale historyId)", async () => {
    mockFetchOnce({ ok: false, status: 404, json: { error: { code: 404 } } });
    await expect(
      usersHistoryList({ accessToken: "x", startHistoryId: "1" }),
    ).rejects.toBeInstanceOf(HistoryListStaleCursorError);
  });

  it("throws HistoryListStaleCursorError on 410 (older Gmail docs use this)", async () => {
    mockFetchOnce({ ok: false, status: 410, json: { error: { code: 410 } } });
    await expect(
      usersHistoryList({ accessToken: "x", startHistoryId: "1" }),
    ).rejects.toBeInstanceOf(HistoryListStaleCursorError);
  });

  it("surfaces error.message on other 4xx", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      json: { error: { code: 400, message: "Invalid value at startHistoryId" } },
    });
    await expect(
      usersHistoryList({ accessToken: "x", startHistoryId: "junk" }),
    ).rejects.toThrow(/Invalid value at startHistoryId/);
  });
});
