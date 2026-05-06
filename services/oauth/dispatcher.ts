import { type ProviderOAuth } from "@/contracts/integration";
import { decryptToken } from "@/core/encryption/tokens";
import { gmailOAuth } from "@/integrations/gmail/oauth";
import { getProvider } from "@/integrations/_registry";
import { slackOAuth } from "@/integrations/slack/oauth";
import {
  getActiveForExecution,
  updateTokens,
  upsertActive,
  type IntegrationRecord,
} from "@/repositories/integrations";
import { refreshLockKey, withRefreshLock } from "./refreshLock";
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
  gmail: gmailOAuth,
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

  // Provider-owned PKCE. Providers that need PKCE implement generatePkce
  // and the dispatcher routes the verifier to createState (persisted on
  // the oauth_states row) and the challenge into buildAuthUrl. Non-PKCE
  // providers (Slack default v2) omit generatePkce entirely → no PKCE
  // metadata flows anywhere.
  const pkceGen = oauth.generatePkce?.();
  const { token: state } = await createState({
    userId: input.userId,
    provider: input.provider,
    requestedScopes,
    ...(pkceGen !== undefined
      ? {
          pkce: {
            codeVerifier: pkceGen.codeVerifier,
            codeChallengeMethod: pkceGen.codeChallengeMethod,
          },
        }
      : {}),
  });
  const redirectUrl = oauth.buildAuthUrl(
    state,
    requestedScopes,
    pkceGen !== undefined
      ? { codeChallenge: pkceGen.codeChallenge, codeChallengeMethod: pkceGen.codeChallengeMethod }
      : null,
  );
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

export interface RefreshInput {
  userId: string;
  provider: string;
  /**
   * Optional account discriminator for multi-account users (Slack
   * workspaces, multiple Gmail inboxes). When omitted and the user has a
   * single active row for the provider, that row is refreshed; when
   * multiple active rows exist, the repository's lookup picks one
   * arbitrarily — callers with multi-account users SHOULD pass an
   * accountId to disambiguate.
   */
  accountId?: string | null;
}

export interface RefreshOutput {
  integration: IntegrationRecord;
}

/**
 * Refresh an integration's access token via the provider's refresh flow.
 *
 * Concurrent calls for the same `(userId, provider, accountId)` triple
 * collapse into one provider call via the in-process single-flight lock
 * (`services/oauth/refreshLock.ts`). All callers receive the same
 * `RefreshOutput`.
 *
 * Throws:
 *   - `RefreshNotSupportedError` (from the provider's `refreshToken()`)
 *     for non-refreshable providers (Slack default v2). The wrapper
 *     `services/oauth/refreshAndRetry.ts` catches and translates this
 *     into `IntegrationActionRequiredError`.
 *   - `Error("No active integration ...")` when the lookup returns null.
 *   - `Error("No refresh token stored ...")` when the row exists but its
 *     `refresh_token_encrypted` is null (provider was non-refreshable at
 *     connect time, or token has been wiped).
 *   - Any error the provider's `refreshToken()` throws (network, 4xx, 5xx).
 */
export async function refresh(input: RefreshInput): Promise<RefreshOutput> {
  if (!input.userId) throw new Error("refresh: userId is required.");
  const manifest = getProvider(input.provider);
  if (!manifest) throw new Error(`Unknown provider: ${input.provider}`);
  if (!manifest.capabilities.oauth) {
    throw new Error(`Provider '${input.provider}' does not support OAuth.`);
  }

  const oauth = OAUTH_BY_PROVIDER[input.provider];
  if (!oauth) {
    throw new Error(
      `No OAuth implementation registered for provider '${input.provider}'.`,
    );
  }

  const accountId = input.accountId ?? null;
  const lockKey = refreshLockKey({
    userId: input.userId,
    provider: input.provider,
    accountId,
  });

  return withRefreshLock(lockKey, async () => {
    const row = await getActiveForExecution(input.userId, input.provider, accountId);
    if (!row) {
      throw new Error(
        `refresh: no active integration found for user ${input.userId} provider ${input.provider}${
          accountId !== null ? ` account ${accountId}` : ""
        }.`,
      );
    }
    if (!row.refreshTokenEncrypted) {
      throw new Error(
        `refresh: no refresh token stored on integration ${row.id} (provider ${input.provider}).`,
      );
    }
    const refreshTokenPlaintext = decryptToken(row.refreshTokenEncrypted);
    // Provider may throw RefreshNotSupportedError or any provider-specific
    // error. We don't catch — callers (refreshAndRetry) own the
    // translation to IntegrationActionRequiredError.
    const newTokens = await oauth.refreshToken(refreshTokenPlaintext);
    const integration = await updateTokens({ id: row.id, tokens: newTokens });
    return { integration };
  });
}
