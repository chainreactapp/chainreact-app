import { createHash, randomBytes } from "node:crypto";
import {
  type EncryptedTokens,
  type ProviderOAuth,
} from "@/contracts/integration";
import { encryptToken } from "@/core/encryption/tokens";

/**
 * Gmail OAuth implementation.
 *
 * Per docs/rules/oauth-dispatcher.md and the Slice 2 plan:
 *   - PKCE S256 (Slice 2a infra; Gmail is the first real consumer).
 *   - access_type=offline + prompt=consent — guarantees a refresh token on
 *     every connect (Google's quirk: refresh token only returned on first
 *     consent OR when prompt=consent forces re-consent).
 *   - Token endpoint POSTs `code_verifier` from the consumed oauth_states
 *     row alongside `code` + `client_id` + `client_secret`.
 *   - accountId via users.getProfile → emailAddress (uses gmail.readonly).
 *   - refreshToken preserves the existing encrypted refresh token when
 *     Google's response omits a new one (Decision 2b-5: provider owns
 *     rotation/preserve-old policy).
 *   - revoke is a stub deferred to the disconnect-UX slice (matches
 *     Slack's pattern for the same parent decision).
 */

/**
 * Base URLs are env-overridable for e2e testing only. Production sets
 * none of these; defaults point at real Google. Three separate vars per
 * Slice 2 Decision 2c-5 — matches the per-endpoint pattern and lets the
 * mock server (Slice 2f) own all three at once without coupling.
 */
function googleAuthorizeBase(): string {
  return process.env.GOOGLE_AUTHORIZE_BASE ?? "https://accounts.google.com";
}

function googleTokenBase(): string {
  return process.env.GOOGLE_TOKEN_BASE ?? "https://oauth2.googleapis.com";
}

function gmailApiBase(): string {
  return process.env.GMAIL_API_BASE ?? "https://gmail.googleapis.com";
}

function getRedirectUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${baseUrl}/api/integrations/oauth/gmail/callback`;
}

function getClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID env var is not set.");
  return id;
}

function getClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET env var is not set.");
  return secret;
}

interface GoogleTokenSuccess {
  access_token: string;
  expires_in: number;
  /**
   * Google may omit refresh_token on subsequent connects without
   * prompt=consent (we always send prompt=consent, but per RFC the
   * field is still optional in the response). When omitted, the provider
   * preserves the existing refresh token (Decision 2b-5).
   */
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface GoogleTokenError {
  error: string;
  error_description?: string;
}

interface GmailUserProfile {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
}

export const gmailOAuth: ProviderOAuth = {
  /**
   * Generate a fresh PKCE pair. 32 random bytes → ~43 base64url chars
   * (RFC 7636 §4.1 minimum), exceeds entropy needed for SHA-256.
   * Method is hardcoded S256 per Slice 2 Decision 2c-3.
   */
  generatePkce() {
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: "S256",
    };
  },

  buildAuthUrl(state, scopes, pkce) {
    if (pkce === null) {
      // Should be impossible — the dispatcher always passes PKCE for
      // Gmail because generatePkce returned a non-null value. Defensive
      // throw so a future refactor that breaks the connect-time threading
      // surfaces immediately.
      throw new Error(
        "gmailOAuth.buildAuthUrl: PKCE challenge is required for Gmail. The dispatcher should have generated one via generatePkce().",
      );
    }
    const params = new URLSearchParams({
      response_type: "code",
      client_id: getClientId(),
      redirect_uri: getRedirectUrl(),
      scope: scopes.join(" "), // Google uses space-separated scopes
      state,
      access_type: "offline",
      prompt: "consent",
      code_challenge: pkce.codeChallenge,
      code_challenge_method: pkce.codeChallengeMethod,
    });
    return `${googleAuthorizeBase()}/o/oauth2/v2/auth?${params.toString()}`;
  },

  async handleCallback(code, _state, pkce) {
    if (pkce === null || !pkce.codeVerifier) {
      // The state row was missing the code_verifier — either the connect
      // path didn't issue PKCE (impossible if Gmail is the only caller),
      // or the row was tampered with, or consumeState's defensive AND
      // returned null on a half-populated row. Refuse to attempt the
      // token exchange — Google would reject it anyway with
      // invalid_grant.
      throw new Error(
        "gmailOAuth.handleCallback: PKCE code_verifier is required for Gmail; the consumed oauth_states row had none.",
      );
    }

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: getRedirectUrl(),
      code_verifier: pkce.codeVerifier,
    });

    const tokenRes = await fetch(`${googleTokenBase()}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      // Try to surface Google's error code without leaking tokens.
      let errorCode = `HTTP ${tokenRes.status}`;
      try {
        const parsed = JSON.parse(text) as GoogleTokenError;
        if (parsed.error) errorCode = parsed.error;
      } catch {
        // not JSON — keep HTTP status
      }
      throw new Error(`Google token exchange failed: ${errorCode}`);
    }
    const tokenJson = (await tokenRes.json()) as GoogleTokenSuccess;
    if (!tokenJson.access_token) {
      throw new Error("Google token response missing access_token.");
    }
    if (!tokenJson.refresh_token) {
      // First-connect with prompt=consent should always return a refresh
      // token. Missing one means scopes were re-granted without forcing
      // re-consent (impossible if buildAuthUrl ran correctly). Fail loud
      // — letting this through would silently break the refresh path.
      throw new Error(
        "Google token response missing refresh_token — Slice 2c expects offline access + prompt=consent to always issue one.",
      );
    }

    const accessToken = tokenJson.access_token;
    const expiresAt =
      typeof tokenJson.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + tokenJson.expires_in
        : null;
    const scopesGranted = (tokenJson.scope ?? "").split(" ").filter(Boolean);

    // Look up the connected account's email via the Gmail API. Uses the
    // freshly-issued access token; gmail.readonly scope (which we always
    // request) covers users.getProfile.
    const profileRes = await fetch(`${gmailApiBase()}/gmail/v1/users/me/profile`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      throw new Error(
        `Gmail users.getProfile failed: HTTP ${profileRes.status}`,
      );
    }
    const profile = (await profileRes.json()) as GmailUserProfile;
    if (!profile.emailAddress) {
      throw new Error("Gmail users.getProfile response missing emailAddress.");
    }

    return {
      tokens: {
        accessTokenEncrypted: encryptToken(accessToken),
        refreshTokenEncrypted: encryptToken(tokenJson.refresh_token),
        accessTokenExpiresAt: expiresAt,
        scopes: scopesGranted,
      },
      account: {
        providerAccountId: profile.emailAddress,
        displayName: profile.emailAddress,
        metadata: {
          email: profile.emailAddress,
          historyId: profile.historyId ?? null,
        },
      },
    };
  },

  /**
   * Exchange a refresh token for fresh tokens. Per Decision 2b-5, this
   * provider owns the rotation/preserve-old policy:
   *   - Google's response includes `refresh_token` only when the token
   *     rotates (uncommon for the default Gmail flow). When the field is
   *     present, encrypt and return it as the new refreshTokenEncrypted.
   *   - When the field is omitted, re-encrypt the input refreshToken
   *     plaintext and return that — the row's refresh token stays
   *     functionally unchanged (the ciphertext bytes change because of
   *     fresh IV, but the underlying plaintext is the same).
   */
  async refreshToken(refreshToken: string): Promise<EncryptedTokens> {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: getClientId(),
      client_secret: getClientSecret(),
      refresh_token: refreshToken,
    });
    const res = await fetch(`${googleTokenBase()}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      let errorCode = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(text) as GoogleTokenError;
        if (parsed.error) errorCode = parsed.error;
      } catch {
        // not JSON
      }
      // invalid_grant from Google during refresh means the refresh token
      // is dead (revoked, expired, or scopes shrunk). The wrapper translates
      // this to IntegrationActionRequiredError(refresh_failed).
      throw new Error(`Google token refresh failed: ${errorCode}`);
    }
    const json = (await res.json()) as GoogleTokenSuccess;
    if (!json.access_token) {
      throw new Error("Google refresh response missing access_token.");
    }
    const expiresAt =
      typeof json.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + json.expires_in
        : null;
    const scopesGranted = (json.scope ?? "").split(" ").filter(Boolean);
    return {
      accessTokenEncrypted: encryptToken(json.access_token),
      // Preserve-old when Google omits a new refresh_token (Decision 2b-5).
      refreshTokenEncrypted: json.refresh_token
        ? encryptToken(json.refresh_token)
        : encryptToken(refreshToken),
      accessTokenExpiresAt: expiresAt,
      scopes: scopesGranted,
    };
  },

  async revoke(_token: string): Promise<void> {
    // Google provides https://oauth2.googleapis.com/revoke. Implementation
    // deferred to the disconnect-UX slice (parent Slice 2 Decision 4 +
    // Slice 2c Decision 2c-6) — matches Slack's stub pattern. When this
    // slice ships, both providers' revoke methods land together with the
    // disconnect button UI.
  },
};
