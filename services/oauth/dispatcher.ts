import { type ProviderOAuth } from "@/contracts/integration";
import { getProvider } from "@/integrations/_registry";
import { slackOAuth } from "@/integrations/slack/oauth";
import {
  upsertActive,
  type IntegrationRecord,
} from "@/repositories/integrations";
import { createState, verifyState, InvalidStateError } from "./state";

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
  const { token: state } = createState({
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
  // Verify state — this re-runs the signature/expiry check the dispatcher
  // promises. A malformed or expired state token throws InvalidStateError
  // (the route layer maps this to a redirect with ?integration_error=...).
  const payload = verifyState(input.state);
  if (payload.provider !== input.provider) {
    throw new InvalidStateError("provider mismatch between state and route");
  }

  const oauth = OAUTH_BY_PROVIDER[input.provider];
  if (!oauth) {
    throw new Error(
      `No OAuth implementation registered for provider '${input.provider}'.`,
    );
  }

  const { tokens, account } = await oauth.handleCallback(input.code, input.state);

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
