/**
 * @jest-environment node
 *
 * Tests for slackOAuth.handleCallback. Mocks the global fetch so we don't hit
 * Slack. Verifies the request shape, error handling, and that the response
 * tokens are encrypted before returning (decrypt round-trips to the original).
 */
import { randomBytes } from "node:crypto";
import { slackOAuth } from "@/integrations/slack/oauth";
import { decryptToken } from "@/core/encryption/tokens";

const TOKEN_KEY = randomBytes(32).toString("base64");

beforeEach(() => {
  process.env.SLACK_CLIENT_ID = "test-client-id";
  process.env.SLACK_CLIENT_SECRET = "test-client-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
  process.env.TOKEN_ENCRYPTION_KEY = TOKEN_KEY;
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SLACK_CLIENT_ID;
  delete process.env.SLACK_CLIENT_SECRET;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.TOKEN_ENCRYPTION_KEY;
  delete process.env.SLACK_API_BASE;
});

function mockFetchOnce(response: { ok: boolean; status?: number; json: unknown }) {
  jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(response.json), {
      status: response.status ?? (response.ok ? 200 : 500),
    }),
  );
}

describe("slackOAuth.handleCallback", () => {
  it("posts form-encoded credentials to oauth.v2.access", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            access_token: "xoxb-test-token",
            scope: "chat:write,channels:read",
            team: { id: "T123", name: "Acme" },
            bot_user_id: "U123",
            app_id: "A123",
          }),
          { status: 200 },
        ),
      );

    await slackOAuth.handleCallback("auth-code-xyz", "state-token");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://slack.com/api/oauth.v2.access",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: expect.any(String),
      }),
    );
    const body = fetchSpy.mock.calls[0]![1]!.body as string;
    const params = new URLSearchParams(body);
    expect(params.get("client_id")).toBe("test-client-id");
    expect(params.get("client_secret")).toBe("test-client-secret");
    expect(params.get("code")).toBe("auth-code-xyz");
    expect(params.get("redirect_uri")).toBe(
      "https://app.example.test/api/integrations/oauth/slack/callback",
    );
  });

  it("encrypts the access_token; decrypt round-trips to the original", async () => {
    mockFetchOnce({
      ok: true,
      json: {
        ok: true,
        access_token: "xoxb-real-bot-token",
        scope: "chat:write,channels:read",
        team: { id: "T123", name: "Acme" },
      },
    });
    const result = await slackOAuth.handleCallback("code", "state");
    expect(result.tokens.accessTokenEncrypted).not.toContain("xoxb-real-bot-token");
    expect(decryptToken(result.tokens.accessTokenEncrypted)).toBe("xoxb-real-bot-token");
  });

  it("returns null refresh token (Slack default v2 doesn't issue one)", async () => {
    mockFetchOnce({
      ok: true,
      json: {
        ok: true,
        access_token: "xoxb-x",
        scope: "chat:write",
        team: { id: "T", name: "N" },
      },
    });
    const result = await slackOAuth.handleCallback("c", "s");
    expect(result.tokens.refreshTokenEncrypted).toBeNull();
    expect(result.tokens.accessTokenExpiresAt).toBeNull();
  });

  it("parses scopes from comma-separated string", async () => {
    mockFetchOnce({
      ok: true,
      json: {
        ok: true,
        access_token: "x",
        scope: "chat:write,channels:read,channels:history,users:read",
        team: { id: "T", name: "N" },
      },
    });
    const result = await slackOAuth.handleCallback("c", "s");
    expect(result.tokens.scopes).toEqual([
      "chat:write",
      "channels:read",
      "channels:history",
      "users:read",
    ]);
  });

  it("populates ProviderAccountInfo from the team payload", async () => {
    mockFetchOnce({
      ok: true,
      json: {
        ok: true,
        access_token: "x",
        scope: "chat:write",
        team: { id: "T-team-123", name: "Acme Inc" },
        bot_user_id: "U-bot-1",
        app_id: "A-app-1",
        authed_user: { id: "U-user-1" },
      },
    });
    const result = await slackOAuth.handleCallback("c", "s");
    expect(result.account.providerAccountId).toBe("T-team-123");
    expect(result.account.displayName).toBe("Acme Inc");
    expect(result.account.metadata).toEqual({
      teamId: "T-team-123",
      teamName: "Acme Inc",
      botUserId: "U-bot-1",
      appId: "A-app-1",
      authedUserId: "U-user-1",
    });
  });

  it("throws on Slack OAuth error response (ok: false)", async () => {
    mockFetchOnce({
      ok: true,
      json: { ok: false, error: "invalid_code" },
    });
    await expect(slackOAuth.handleCallback("bad-code", "s")).rejects.toThrow(/invalid_code/);
  });

  it("throws on HTTP-level failure", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ratelimit", { status: 429 }));
    await expect(slackOAuth.handleCallback("c", "s")).rejects.toThrow(/HTTP 429/);
  });

  it("throws when SLACK_CLIENT_SECRET is missing", async () => {
    delete process.env.SLACK_CLIENT_SECRET;
    await expect(slackOAuth.handleCallback("c", "s")).rejects.toThrow(/SLACK_CLIENT_SECRET/);
  });

  it("throws when response is missing access_token or team.id", async () => {
    mockFetchOnce({
      ok: true,
      json: { ok: true, scope: "chat:write", team: {} },
    });
    await expect(slackOAuth.handleCallback("c", "s")).rejects.toThrow(/missing/);
  });

  it("uses SLACK_API_BASE override for the token exchange (e2e mock surface)", async () => {
    process.env.SLACK_API_BASE = "http://localhost:9876";
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          access_token: "xoxb-x",
          scope: "chat:write",
          team: { id: "T", name: "N" },
        }),
        { status: 200 },
      ),
    );
    await slackOAuth.handleCallback("c", "s");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:9876/api/oauth.v2.access",
      expect.any(Object),
    );
  });
});
