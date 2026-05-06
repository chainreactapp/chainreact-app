/**
 * @jest-environment node
 *
 * Tests for integrations/slack/api/chatPostMessage.
 *
 * Mocks global fetch. Verifies:
 *   - URL + method + body + auth header
 *   - Successful response is parsed into the typed shape
 *   - Slack `ok: false` payloads throw SlackApiError with the slack code
 *   - Non-2xx HTTP throws SlackApiError with `http_<status>`
 *   - Malformed-but-ok responses throw `malformed_response`
 */
import {
  SlackApiError,
  chatPostMessage,
} from "@/integrations/slack/api/chatPostMessage";

beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("chatPostMessage", () => {
  it("POSTs to chat.postMessage with the bot token and JSON body", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          ts: "1730000000.000123",
          channel: "C123",
          message: { text: "hi", user: "U_BOT" },
        }),
        { status: 200 },
      ),
    );

    const result = await chatPostMessage({
      botToken: "xoxb-test",
      channel: "C123",
      text: "hi",
    });

    expect(result).toEqual({
      ts: "1730000000.000123",
      channel: "C123",
      message: { text: "hi", user: "U_BOT" },
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    const reqInit = init as {
      method: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(reqInit.method).toBe("POST");
    expect(reqInit.headers.authorization).toBe("Bearer xoxb-test");
    expect(JSON.parse(reqInit.body)).toEqual({
      channel: "C123",
      text: "hi",
    });
  });

  it("throws SlackApiError with the Slack error code when ok=false", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), {
        status: 200,
      }),
    );
    await expect(
      chatPostMessage({ botToken: "x", channel: "C", text: "t" }),
    ).rejects.toMatchObject({
      name: "SlackApiError",
      slackErrorCode: "channel_not_found",
    });
  });

  it("throws SlackApiError 'unknown_error' when ok=false but error is missing", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 200 }));
    await expect(
      chatPostMessage({ botToken: "x", channel: "C", text: "t" }),
    ).rejects.toMatchObject({ slackErrorCode: "unknown_error" });
  });

  it("throws SlackApiError with http_<status> on non-2xx responses", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    await expect(
      chatPostMessage({ botToken: "x", channel: "C", text: "t" }),
    ).rejects.toMatchObject({ slackErrorCode: "http_429" });
  });

  it("throws SlackApiError 'malformed_response' when ok=true but ts/channel/message is missing", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, ts: "1.0" }), { status: 200 }),
    );
    await expect(
      chatPostMessage({ botToken: "x", channel: "C", text: "t" }),
    ).rejects.toMatchObject({ slackErrorCode: "malformed_response" });
  });

  it("SlackApiError has the right name (so callers can branch with instanceof)", () => {
    const e = new SlackApiError("foo");
    expect(e).toBeInstanceOf(SlackApiError);
    expect(e.name).toBe("SlackApiError");
  });
});
