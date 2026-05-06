import { type ProviderOAuth } from "@/contracts/integration";
import { getProvider } from "@/integrations/_registry";
import { slackOAuth } from "@/integrations/slack/oauth";
import {
  upsertActive,
  type IntegrationRecord,
} from "@/repositories/integrations";
import { createState, consumeState, InvalidStateError } from "./state";

/**
 * Generic OAuth dispatcher.
 *
 * Per docs/rules/oauth-dispatcher.md: zero provider-specific logic lives here.
 * Each provider in `integrations/<id>/oauth.ts` implements ProviderOAuth and is
 * registered in OAUTH_BY_PROVIDER below (hand-maintained per the registry rule
 * — explicit imports surface in PRs).
 */

const OAUTH_BY_PROVIDER: Readonly<Record<string, ProviderOAuth>> = Object.freeze({
  slack: slackOAuth,
});

export interface ConnectInput {
  userId: string;
  provider: string;
}

export interface ConnectOutput {
  redirectUrl: string;
}

export async function connect(input: ConnectInput): Promise<ConnectOutput> {
  if (!input.userId) throw new Error("connect: userId is required.");
  const manifest = getProvider(input.provider);
  if (!manifest) throw new Error(`Unknown provider: ${input.provider}`);
  if (!manifest.isEnabled) throw new Error(`Provider '${input.provider}' is disabled.`);
  if (!manifest.capabilities.oauth) {
    throw new Error(`Provider '${input.provider}' does not support OAuth.`);
  }

  const oauth = OAUTH_BY_PROVIDER[input.provider];
  if (!oauth) {
    throw new Error(
      `No OAuth implementation registered for provider '${input.provider}'. Update services/oauth/dispatcher.ts.`,
    );
  }

  const requestedScopes = [...manifest.scopes.required, ...manifest.scopes.optional];
  const { token: state } = await createState({
    userId: input.userId,
    provider: input.provider,
    requestedScopes,
  });
  const redirectUrl = oauth.buildAuthUrl(state, requestedScopes);
  return { redirectUrl };
}

export interface HandleCallbackInput {
  provider: string;
  code: string;
  state: string;
}

export interface HandleCallbackOutput {
  integration: IntegrationRecord;
}

export async function handleCallback(
  input: HandleCallbackInput,
): Promise<HandleCallbackOutput> {
  // Verify-and-consume the state in one atomic step. consumeState does the
  // signature + expiry check AND deletes the matching oauth_states row; a
  // second callback with the same state throws InvalidStateError("already
  // consumed or expired") — that's the replay-protection layer that the JWT
  // alone cannot enforce. The route maps this exception to a redirect with
  // ?integration_error=...
  //
  // We consume BEFORE checking provider mismatch on purpose: a malformed
  // request (wrong provider in URL but valid state) still uses up the nonce
  // so it can't be replayed against the correct provider's route either.
  //
  // pkce is non-null only for providers whose connect path issued a PKCE
  // challenge (Gmail and future PKCE providers). Slack default v2 → null.
  const { payload, pkce } = await consumeState(input.state);
  if (payload.provider !== input.provider) {
    throw new InvalidStateError("provider mismatch between state and route");
  }

  const oauth = OAUTH_BY_PROVIDER[input.provider];
  if (!oauth) {
    throw new Error(
      `No OAuth implementation registered for provider '${input.provider}'.`,
    );
  }

  const { tokens, account } = await oauth.handleCallback(input.code, input.state, pkce);

  const integration = await upsertActive({
    userId: payload.userId,
    provider: input.provider,
    providerAccountId: account.providerAccountId,
    displayName: account.displayName,
    tokens,
    accountMetadata: account.metadata,
  });

  return { integration };
}
