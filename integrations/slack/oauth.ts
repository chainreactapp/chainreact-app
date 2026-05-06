import {
  type ProviderOAuth,
  RefreshNotSupportedError,
} from "@/contracts/integration";
import { encryptToken } from "@/core/encryption/tokens";

/**
 * Slack OAuth implementation.
 *
 * Per docs/rules/oauth-dispatcher.md:
 *   - Slack's default v2 flow does NOT return refresh tokens. Token rotation
 *     is opt-in per app config and Slice 1 does not enable it. refreshToken()
 *     therefore throws RefreshNotSupportedError; refreshAndRetry detects
 *     this and emits `action_required` rather than attempting a refresh.
 *   - handleCallback exchanges the authorization code at oauth.v2.access,
 *     encrypts the bot token, and returns the tokens + account info for the
 *     repository to persist.
 */

/**
 * Base URLs are env-overridable for e2e testing only. Production sets
 * neither variable; defaults point at real Slack. The override is opt-in
 * (must be explicitly set), can't be reached accidentally, and lives at
 * the network boundary — V2's signed-state + token-encryption + dispatcher
 * paths all run unchanged regardless.
 */
function slackApiBase(): string {
  return process.env.SLACK_API_BASE ?? "https://slack.com";
}

function slackAuthorizeBase(): string {
  return process.env.SLACK_AUTHORIZE_BASE ?? "https://slack.com";
}

interface SlackOAuthV2Success {
  ok: true;
  access_token: string;
  scope: string;
  team: { id: string; name?: string };
  bot_user_id?: string;
  app_id?: string;
  authed_user?: { id: string };
}

interface SlackOAuthV2Error {
  ok: false;
  error: string;
}

type SlackOAuthV2Response = SlackOAuthV2Success | SlackOAuthV2Error;

function getRedirectUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${baseUrl}/api/integrations/oauth/slack/callback`;
}

function getClientId(): string {
  const id = process.env.SLACK_CLIENT_ID;
  if (!id) throw new Error("SLACK_CLIENT_ID env var is not set.");
  return id;
}

function getClientSecret(): string {
  const secret = process.env.SLACK_CLIENT_SECRET;
  if (!secret) throw new Error("SLACK_CLIENT_SECRET env var is not set.");
  return secret;
}

export const slackOAuth: ProviderOAuth = {
  buildAuthUrl(state, scopes) {
    const params = new URLSearchParams({
      client_id: getClientId(),
      scope: scopes.join(","),
      state,
      redirect_uri: getRedirectUrl(),
    });
    return `${slackAuthorizeBase()}/oauth/v2/authorize?${params.toString()}`;
  },

  async handleCallback(code, _state) {
    const params = new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      code,
      redirect_uri: getRedirectUrl(),
    });
    const res = await fetch(`${slackApiBase()}/api/oauth.v2.access`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      throw new Error(`Slack token exchange failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as SlackOAuthV2Response;
    if (!json.ok) {
      throw new Error(`Slack OAuth error: ${json.error}`);
    }
    if (!json.access_token || !json.team?.id) {
      throw new Error("Slack OAuth response missing access_token or team.id");
    }

    const scopes = (json.scope ?? "").split(",").filter(Boolean);

    return {
      tokens: {
        accessTokenEncrypted: encryptToken(json.access_token),
        refreshTokenEncrypted: null,
        accessTokenExpiresAt: null,
        scopes,
      },
      account: {
        providerAccountId: json.team.id,
        displayName: json.team.name ?? null,
        metadata: {
          teamId: json.team.id,
          teamName: json.team.name ?? null,
          botUserId: json.bot_user_id ?? null,
          appId: json.app_id ?? null,
          authedUserId: json.authed_user?.id ?? null,
        },
      },
    };
  },

  async refreshToken(_refreshToken) {
    throw new RefreshNotSupportedError("slack");
  },

  async revoke(_token) {
    // Slack provides https://slack.com/api/auth.revoke. Implementation deferred to Slice 1E
    // when the integrations repository + token decryption are wired in.
  },
};
