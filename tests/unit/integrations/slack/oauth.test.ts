import { slackOAuth } from "@/integrations/slack/oauth";
import { RefreshNotSupportedError } from "@/contracts/integration";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.SLACK_CLIENT_ID = "test-slack-client-id";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("slackOAuth.buildAuthUrl", () => {
  it("produces a Slack v2 authorize URL with all required params", () => {
    const url = slackOAuth.buildAuthUrl("STATE-TOKEN", ["chat:write", "channels:read"]);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(u.searchParams.get("client_id")).toBe("test-slack-client-id");
    expect(u.searchParams.get("scope")).toBe("chat:write,channels:read");
    expect(u.searchParams.get("state")).toBe("STATE-TOKEN");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://app.example.test/api/integrations/oauth/slack/callback",
    );
  });

  it("falls back to localhost redirect_uri when NEXT_PUBLIC_APP_URL is not set", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const url = slackOAuth.buildAuthUrl("S", ["chat:write"]);
    expect(new URL(url).searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/oauth/slack/callback",
    );
  });

  it("throws when SLACK_CLIENT_ID is not set", () => {
    delete process.env.SLACK_CLIENT_ID;
    expect(() => slackOAuth.buildAuthUrl("S", ["chat:write"])).toThrow(/SLACK_CLIENT_ID/);
  });

  it("uses SLACK_AUTHORIZE_BASE override when set (e2e mock surface)", () => {
    process.env.SLACK_AUTHORIZE_BASE = "http://localhost:9876";
    const url = slackOAuth.buildAuthUrl("S", ["chat:write"]);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "http://localhost:9876/oauth/v2/authorize",
    );
  });

  it("defaults to slack.com when SLACK_AUTHORIZE_BASE is unset (production-safe)", () => {
    delete process.env.SLACK_AUTHORIZE_BASE;
    const url = slackOAuth.buildAuthUrl("S", ["chat:write"]);
    expect(new URL(url).origin).toBe("https://slack.com");
  });

  it("URL-encodes scopes with special characters", () => {
    const url = slackOAuth.buildAuthUrl("S", ["channels:history", "chat:write.public"]);
    const u = new URL(url);
    expect(u.searchParams.get("scope")).toBe("channels:history,chat:write.public");
  });
});

describe("slackOAuth — refresh + revoke", () => {
  // handleCallback has its own dedicated test file (oauth-callback.test.ts).
  it("refreshToken throws RefreshNotSupportedError (Slack default v2)", async () => {
    await expect(slackOAuth.refreshToken("any")).rejects.toThrow(RefreshNotSupportedError);
  });

  it("revoke is a no-op (Slice 1E+)", async () => {
    await expect(slackOAuth.revoke("any-token")).resolves.toBeUndefined();
  });
});
