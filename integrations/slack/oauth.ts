import {
  type ProviderOAuth,
  RefreshNotSupportedError,
} from "@/contracts/integration";

/**
 * Slack OAuth implementation.
 *
 * Per docs/rules/oauth-dispatcher.md:
 *   - Slack's default v2 flow does NOT return refresh tokens. Token rotation
 *     is opt-in per app config and Slice 1 does not enable it. refreshToken()
 *     therefore throws RefreshNotSupportedError; the caller (refreshAndRetry
 *     in core/integrations/) should detect this and emit `action_required`
 *     immediately rather than attempting a refresh.
 *   - handleCallback / revoke land in Slice 1E once the integrations
 *     repository + encryption are wired together end-to-end.
 */

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";

function getRedirectUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${baseUrl}/api/integrations/oauth/slack/callback`;
}

function getClientId(): string {
  const id = process.env.SLACK_CLIENT_ID;
  if (!id) throw new Error("SLACK_CLIENT_ID env var is not set.");
  return id;
}

export const slackOAuth: ProviderOAuth = {
  buildAuthUrl(state, scopes) {
    const params = new URLSearchParams({
      client_id: getClientId(),
      scope: scopes.join(","),
      state,
      redirect_uri: getRedirectUrl(),
    });
    return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
  },

  async handleCallback(_code, _state) {
    throw new Error("slackOAuth.handleCallback: not implemented (lands in Slice 1E).");
  },

  async refreshToken(_refreshToken) {
    throw new RefreshNotSupportedError("slack");
  },

  async revoke(_token) {
    // Slack provides https://slack.com/api/auth.revoke. Implementation deferred to Slice 1E
    // when the integrations repository + token decryption are wired in.
  },
};
