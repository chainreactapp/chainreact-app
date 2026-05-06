import { randomBytes } from "node:crypto";

const mockOAuthStatesCreate = jest.fn();
const mockOAuthStatesConsume = jest.fn();

jest.mock("@/repositories/oauthStates", () => ({
  create: (...args: unknown[]) => mockOAuthStatesCreate(...args),
  consumeByNonce: (...args: unknown[]) => mockOAuthStatesConsume(...args),
}));

import { connect } from "@/services/oauth/dispatcher";
import { verifyState } from "@/services/oauth/state";

beforeEach(() => {
  process.env.OAUTH_STATE_SIGNING_KEY = randomBytes(32).toString("base64");
  process.env.SLACK_CLIENT_ID = "test-slack-client-id";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
  mockOAuthStatesCreate.mockReset();
  mockOAuthStatesCreate.mockResolvedValue(undefined);
  mockOAuthStatesConsume.mockReset();
});

afterEach(() => {
  delete process.env.OAUTH_STATE_SIGNING_KEY;
  delete process.env.SLACK_CLIENT_ID;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe("dispatcher.connect", () => {
  it("returns a Slack redirect URL with a verifiable state token AND writes the nonce row", async () => {
    const { redirectUrl } = await connect({ userId: "user-123", provider: "slack" });
    const u = new URL(redirectUrl);
    expect(u.origin + u.pathname).toBe("https://slack.com/oauth/v2/authorize");
    const state = u.searchParams.get("state");
    expect(state).toBeTruthy();
    const payload = verifyState(state!);
    expect(payload.userId).toBe("user-123");
    expect(payload.provider).toBe("slack");
    expect(payload.requestedScopes).toEqual(
      expect.arrayContaining(["chat:write", "channels:read", "channels:history"]),
    );
    // Nonce row write is the new replay-protection contract
    expect(mockOAuthStatesCreate).toHaveBeenCalledTimes(1);
    expect(mockOAuthStatesCreate.mock.calls[0]![0]).toMatchObject({
      nonce: payload.nonce,
      userId: "user-123",
      provider: "slack",
    });
  });

  it("rejects an unknown provider", async () => {
    await expect(connect({ userId: "u", provider: "does-not-exist" })).rejects.toThrow(
      /Unknown provider/,
    );
    expect(mockOAuthStatesCreate).not.toHaveBeenCalled();
  });

  it("rejects when userId is empty", async () => {
    await expect(connect({ userId: "", provider: "slack" })).rejects.toThrow(/userId/);
    expect(mockOAuthStatesCreate).not.toHaveBeenCalled();
  });

  it("includes optional scopes alongside required scopes in the auth URL", async () => {
    const { redirectUrl } = await connect({ userId: "u", provider: "slack" });
    const scopes = new URL(redirectUrl).searchParams.get("scope")!.split(",");
    expect(scopes).toEqual(
      expect.arrayContaining([
        "channels:history",
        "channels:read",
        "chat:write",
        "users:read",
      ]),
    );
  });
});
