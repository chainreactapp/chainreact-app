/**
 * @jest-environment node
 *
 * Tests for gmailOAuth (services/oauth/dispatcher's gmail entry).
 *
 * Strategy: mock the global fetch so token exchange + profile lookup +
 * refresh hit a captured handler; verify request shape (URL, method,
 * body params), response handling (encryption round-trip, scope parse,
 * accountInfo), and the preserve-old refresh-token rotation policy.
 */
import { createHash } from "node:crypto";
import { gmailOAuth } from "@/integrations/gmail/oauth";
import { decryptToken } from "@/core/encryption/tokens";

const TOKEN_KEY = (() => {
  // 32 random bytes as base64 — token encryption requires exactly 32 bytes.
  const bytes = Buffer.alloc(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
  return bytes.toString("base64");
})();

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
  process.env.TOKEN_ENCRYPTION_KEY = TOKEN_KEY;
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.TOKEN_ENCRYPTION_KEY;
  delete process.env.GOOGLE_AUTHORIZE_BASE;
  delete process.env.GOOGLE_TOKEN_BASE;
  delete process.env.GMAIL_API_BASE;
});

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json: unknown }>) {
  const spy = jest.spyOn(globalThis, "fetch");
  for (const r of responses) {
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(r.json), {
        status: r.status ?? (r.ok ? 200 : 500),
      }),
    );
  }
  return spy;
}

describe("gmailOAuth.generatePkce", () => {
  it("returns a verifier + challenge + S256 method", () => {
    expect(gmailOAuth.generatePkce).toBeDefined();
    const pkce = gmailOAuth.generatePkce!();
    expect(pkce.codeChallengeMethod).toBe("S256");
    expect(typeof pkce.codeVerifier).toBe("string");
    expect(typeof pkce.codeChallenge).toBe("string");
  });

  it("produces a 43-char base64url verifier (32 random bytes)", () => {
    const pkce = gmailOAuth.generatePkce!();
    // base64url of 32 bytes is 43 chars (no padding).
    expect(pkce.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("challenge equals base64url(SHA256(verifier))", () => {
    const pkce = gmailOAuth.generatePkce!();
    const expected = createHash("sha256")
      .update(pkce.codeVerifier)
      .digest("base64url");
    expect(pkce.codeChallenge).toBe(expected);
  });

  it("each call produces a fresh verifier", () => {
    const a = gmailOAuth.generatePkce!();
    const b = gmailOAuth.generatePkce!();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });
});

describe("gmailOAuth.buildAuthUrl", () => {
  const SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ];
  const PKCE_CHALLENGE = {
    codeChallenge: "fake-challenge-base64url",
    codeChallengeMethod: "S256",
  };

  it("includes every required Google v2 OAuth + PKCE param", () => {
    const url = gmailOAuth.buildAuthUrl("STATE-TOKEN", SCOPES, PKCE_CHALLENGE);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("test-google-client-id");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://app.example.test/api/integrations/oauth/gmail/callback",
    );
    expect(u.searchParams.get("scope")).toBe(SCOPES.join(" "));
    expect(u.searchParams.get("state")).toBe("STATE-TOKEN");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("code_challenge")).toBe("fake-challenge-base64url");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("throws when pkce is null (Gmail requires PKCE)", () => {
    expect(() => gmailOAuth.buildAuthUrl("S", SCOPES, null)).toThrow(/PKCE/);
  });

  it("throws when GOOGLE_CLIENT_ID is unset", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(() => gmailOAuth.buildAuthUrl("S", SCOPES, PKCE_CHALLENGE)).toThrow(
      /GOOGLE_CLIENT_ID/,
    );
  });

  it("uses GOOGLE_AUTHORIZE_BASE override when set (e2e mock surface)", () => {
    process.env.GOOGLE_AUTHORIZE_BASE = "http://127.0.0.1:9877";
    const url = gmailOAuth.buildAuthUrl("S", SCOPES, PKCE_CHALLENGE);
    expect(new URL(url).origin).toBe("http://127.0.0.1:9877");
  });
});

describe("gmailOAuth.handleCallback", () => {
  const PKCE_INPUTS = { codeVerifier: "verifier-secret-43chars", codeChallengeMethod: "S256" };

  it("posts form-encoded code + code_verifier + client_id + client_secret to token endpoint", async () => {
    const fetchSpy = mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "ya29.gmail-access",
          refresh_token: "1//refresh-token-x",
          expires_in: 3599,
          scope:
            "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
        },
      },
      {
        ok: true,
        json: { emailAddress: "alice@example.com", historyId: "hist-1" },
      },
    ]);

    await gmailOAuth.handleCallback("auth-code-xyz", "state-token", PKCE_INPUTS);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
    const body = fetchSpy.mock.calls[0]![1]!.body as string;
    const params = new URLSearchParams(body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("auth-code-xyz");
    expect(params.get("code_verifier")).toBe("verifier-secret-43chars");
    expect(params.get("client_id")).toBe("test-google-client-id");
    expect(params.get("client_secret")).toBe("test-google-client-secret");
    expect(params.get("redirect_uri")).toBe(
      "https://app.example.test/api/integrations/oauth/gmail/callback",
    );
  });

  it("calls users.getProfile with Bearer access token", async () => {
    const fetchSpy = mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "ya29.access",
          refresh_token: "1//refresh",
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        },
      },
      { ok: true, json: { emailAddress: "alice@example.com" } },
    ]);

    await gmailOAuth.handleCallback("c", "s", PKCE_INPUTS);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer ya29.access" },
      }),
    );
  });

  it("encrypts both access and refresh tokens; decrypt round-trips", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "ya29.real-access",
          refresh_token: "1//real-refresh",
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        },
      },
      { ok: true, json: { emailAddress: "alice@example.com" } },
    ]);

    const result = await gmailOAuth.handleCallback("c", "s", PKCE_INPUTS);

    expect(result.tokens.accessTokenEncrypted).not.toContain("ya29.real-access");
    expect(result.tokens.refreshTokenEncrypted).not.toContain("1//real-refresh");
    expect(decryptToken(result.tokens.accessTokenEncrypted)).toBe("ya29.real-access");
    expect(decryptToken(result.tokens.refreshTokenEncrypted!)).toBe("1//real-refresh");
  });

  it("populates accountInfo from emailAddress (Decision 2c-1)", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "ya29.x",
          refresh_token: "1//y",
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        },
      },
      { ok: true, json: { emailAddress: "bob@example.com", historyId: "h-42" } },
    ]);

    const result = await gmailOAuth.handleCallback("c", "s", PKCE_INPUTS);

    expect(result.account.providerAccountId).toBe("bob@example.com");
    expect(result.account.displayName).toBe("bob@example.com");
    expect(result.account.metadata).toEqual({
      email: "bob@example.com",
      historyId: "h-42",
    });
  });

  it("throws when pkce is null", async () => {
    await expect(gmailOAuth.handleCallback("c", "s", null)).rejects.toThrow(
      /PKCE code_verifier is required/,
    );
  });

  it("throws when pkce.codeVerifier is empty", async () => {
    await expect(
      gmailOAuth.handleCallback("c", "s", { codeVerifier: "", codeChallengeMethod: "S256" }),
    ).rejects.toThrow(/PKCE code_verifier is required/);
  });

  it("surfaces Google's error code on token-exchange HTTP error", async () => {
    mockFetchSequence([
      { ok: false, status: 400, json: { error: "invalid_grant", error_description: "code expired" } },
    ]);
    await expect(gmailOAuth.handleCallback("bad-code", "s", PKCE_INPUTS)).rejects.toThrow(
      /invalid_grant/,
    );
  });

  it("throws when token response is missing refresh_token", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "ya29.x",
          // no refresh_token
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        },
      },
    ]);
    await expect(gmailOAuth.handleCallback("c", "s", PKCE_INPUTS)).rejects.toThrow(
      /missing refresh_token/,
    );
  });

  it("throws when profile response is missing emailAddress", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "ya29.x",
          refresh_token: "1//y",
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        },
      },
      { ok: true, json: {} }, // no emailAddress
    ]);
    await expect(gmailOAuth.handleCallback("c", "s", PKCE_INPUTS)).rejects.toThrow(
      /emailAddress/,
    );
  });

  it("uses GOOGLE_TOKEN_BASE + GMAIL_API_BASE overrides when set", async () => {
    process.env.GOOGLE_TOKEN_BASE = "http://127.0.0.1:9877";
    process.env.GMAIL_API_BASE = "http://127.0.0.1:9877";
    const fetchSpy = mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "ya29.x",
          refresh_token: "1//y",
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        },
      },
      { ok: true, json: { emailAddress: "alice@example.com" } },
    ]);

    await gmailOAuth.handleCallback("c", "s", PKCE_INPUTS);

    expect(fetchSpy.mock.calls[0]![0]).toBe("http://127.0.0.1:9877/token");
    expect(fetchSpy.mock.calls[1]![0]).toBe("http://127.0.0.1:9877/gmail/v1/users/me/profile");
  });
});

describe("gmailOAuth.refreshToken", () => {
  it("posts grant_type=refresh_token with the input refresh token", async () => {
    const fetchSpy = mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "ya29.new-access",
          refresh_token: "1//rotated-refresh", // Google rotated
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        },
      },
    ]);

    await gmailOAuth.refreshToken("1//old-refresh");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
    const body = fetchSpy.mock.calls[0]![1]!.body as string;
    const params = new URLSearchParams(body);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("1//old-refresh");
    expect(params.get("client_id")).toBe("test-google-client-id");
    expect(params.get("client_secret")).toBe("test-google-client-secret");
  });

  it("when Google returns a new refresh_token, uses the rotated one", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "ya29.new",
          refresh_token: "1//rotated",
          expires_in: 3599,
          scope: "",
        },
      },
    ]);

    const result = await gmailOAuth.refreshToken("1//old");

    expect(decryptToken(result.refreshTokenEncrypted!)).toBe("1//rotated");
    expect(decryptToken(result.accessTokenEncrypted)).toBe("ya29.new");
  });

  it("when Google omits refresh_token, preserves the input refresh token (Decision 2b-5)", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "ya29.new",
          // no refresh_token — Google's default Gmail behavior
          expires_in: 3599,
          scope: "",
        },
      },
    ]);

    const result = await gmailOAuth.refreshToken("1//original");

    // The encrypted ciphertext bytes WILL change (fresh IV per encryption)
    // but the underlying plaintext is the same.
    expect(decryptToken(result.refreshTokenEncrypted!)).toBe("1//original");
  });

  it("surfaces Google's error code on refresh failure", async () => {
    mockFetchSequence([
      { ok: false, status: 400, json: { error: "invalid_grant" } },
    ]);
    await expect(gmailOAuth.refreshToken("dead-token")).rejects.toThrow(/invalid_grant/);
  });
});

describe("gmailOAuth.revoke", () => {
  it("is a no-op stub for Slice 2c (matches Slack's pattern; deferred)", async () => {
    await expect(gmailOAuth.revoke("any-token")).resolves.toBeUndefined();
  });
});
