import { RefreshNotSupportedError } from "@/contracts/integration";
import { decryptToken } from "@/core/encryption/tokens";
import { getActiveForExecution } from "@/repositories/integrations";
import { refresh as dispatcherRefresh } from "@/services/oauth/dispatcher";

/**
 * Reactive refresh-and-retry wrapper.
 *
 * Per docs/rules/oauth-dispatcher.md §"Allowed flows" — handlers wrap their
 * principal outbound call in this helper so a 401 triggers exactly one
 * refresh + retry cycle. Adopted by Slice 2c's Gmail handler; existing
 * Slack handlers are unaffected (Slack tokens don't expire by default).
 *
 * Placement: lives in `services/oauth/` co-located with `state.ts`,
 * `dispatcher.ts`, and `refreshLock.ts`. The whole-codebase rule
 * (project-structure-and-module-boundaries.md §4) restricts `core/` to
 * imports from `contracts/` only, and this wrapper orchestrates the
 * repository + dispatcher + encryption — so it cannot satisfy `core/`'s
 * purity constraint.
 *
 * Contract (Slice 2 plan, decisions 2b-2 + 2b-3):
 *   - Caller's `apiCall` is opaque from this layer's perspective. It must
 *     throw `Unauthorized401Error` exactly when the provider returned
 *     HTTP 401. Any other error propagates untouched (network failures,
 *     4xx/5xx other than 401, application errors all bypass the refresh
 *     path — refresh fixes only auth, not other failures).
 *   - This wrapper owns the integration lookup AND token decryption. The
 *     handler hands over `(userId, provider, accountId?)` and an
 *     `apiCall(accessToken)` callback; the wrapper threads the live token
 *     into each invocation. The "stale closed-over token after refresh"
 *     bug is impossible by construction.
 *   - Exactly one retry. A second 401 surfaces as
 *     `IntegrationActionRequiredError({ reason: "refresh_failed" })` —
 *     refresh succeeded but the new token is still rejected, which means
 *     scope, account, or downstream state needs human attention.
 *
 * Concurrent 401s for the same integration coalesce via the dispatcher's
 * in-process refresh lock (`services/oauth/refreshLock.ts`): only one
 * provider refresh fires; all waiters share the result and retry with
 * the same new token.
 */

/**
 * Thrown by handler-level API wrappers when the provider returned HTTP 401.
 * The wrapper's only "this is an auth-expired error" signal — any other
 * error class indicates a non-auth failure that refresh wouldn't fix.
 */
export class Unauthorized401Error extends Error {
  constructor(message?: string) {
    super(message ?? "Provider returned HTTP 401 (Unauthorized).");
    this.name = "Unauthorized401Error";
  }
}

export type IntegrationActionRequiredReason =
  | "refresh_not_supported"
  | "refresh_failed";

/**
 * Surfaced when refresh-and-retry concludes the integration needs human
 * action — either the provider doesn't support refresh at all (Slack v2,
 * Discord, GitHub Apps with offline tokens) or refresh succeeded but the
 * subsequent retry still got 401 (scope shrunk, account changed, etc.).
 *
 * Slice 2b defines the class; the future health-engine listener catches
 * it and emits an `action_required` health signal. Today, the run fails
 * with this error and the workflow's error_classification carries the
 * reason forward to the user-facing notification.
 */
export class IntegrationActionRequiredError extends Error {
  readonly userId: string;
  readonly provider: string;
  readonly accountId: string | null;
  readonly reason: IntegrationActionRequiredReason;

  constructor(input: {
    userId: string;
    provider: string;
    accountId: string | null;
    reason: IntegrationActionRequiredReason;
    cause?: unknown;
  }) {
    super(
      `Integration action required: ${input.reason} (user=${input.userId}, provider=${input.provider}${
        input.accountId !== null ? `, account=${input.accountId}` : ""
      }).`,
      input.cause !== undefined ? { cause: input.cause } : undefined,
    );
    this.name = "IntegrationActionRequiredError";
    this.userId = input.userId;
    this.provider = input.provider;
    this.accountId = input.accountId;
    this.reason = input.reason;
  }
}

export interface RefreshAndRetryInput<T> {
  userId: string;
  provider: string;
  /** Account discriminator for multi-account users; null if not applicable. */
  accountId?: string | null;
  /**
   * The principal outbound call. Receives the current decrypted access
   * token. Must throw `Unauthorized401Error` on HTTP 401; other errors
   * propagate to the caller without triggering refresh.
   */
  apiCall: (accessToken: string) => Promise<T>;
}

/**
 * Runs `apiCall` with the current access token. On 401, refreshes the
 * integration via the dispatcher and retries `apiCall` exactly once with
 * the new token. Returns the apiCall's value.
 *
 * Throws:
 *   - `IntegrationActionRequiredError` (reason "refresh_not_supported")
 *     when the provider's `refreshToken()` throws `RefreshNotSupportedError`.
 *   - `IntegrationActionRequiredError` (reason "refresh_failed") when the
 *     refresh itself throws any other error, OR when the post-refresh
 *     retry also returns 401.
 *   - Any non-401 error from `apiCall` — propagated verbatim.
 *   - `Error("No active integration ...")` when the integration row is
 *     missing at lookup time.
 */
export async function refreshAndRetry<T>(input: RefreshAndRetryInput<T>): Promise<T> {
  if (!input.userId) throw new Error("refreshAndRetry: userId is required.");
  if (!input.provider) throw new Error("refreshAndRetry: provider is required.");

  const accountId = input.accountId ?? null;

  // First attempt — fetch current row, decrypt access token, run apiCall.
  const initialRow = await getActiveForExecution(
    input.userId,
    input.provider,
    accountId,
  );
  if (!initialRow) {
    throw new Error(
      `refreshAndRetry: no active integration for user ${input.userId} provider ${input.provider}${
        accountId !== null ? ` account ${accountId}` : ""
      }.`,
    );
  }

  const initialToken = decryptToken(initialRow.accessTokenEncrypted);
  try {
    return await input.apiCall(initialToken);
  } catch (err) {
    if (!(err instanceof Unauthorized401Error)) {
      throw err;
    }
    // Fall through to refresh+retry.
  }

  // Refresh.
  try {
    await dispatcherRefresh({
      userId: input.userId,
      provider: input.provider,
      accountId,
    });
  } catch (refreshErr) {
    if (refreshErr instanceof RefreshNotSupportedError) {
      throw new IntegrationActionRequiredError({
        userId: input.userId,
        provider: input.provider,
        accountId,
        reason: "refresh_not_supported",
        cause: refreshErr,
      });
    }
    throw new IntegrationActionRequiredError({
      userId: input.userId,
      provider: input.provider,
      accountId,
      reason: "refresh_failed",
      cause: refreshErr,
    });
  }

  // Refresh succeeded — refetch row to read the new access token.
  const refreshedRow = await getActiveForExecution(
    input.userId,
    input.provider,
    accountId,
  );
  if (!refreshedRow) {
    throw new Error(
      `refreshAndRetry: integration disappeared between refresh and retry (user ${input.userId} provider ${input.provider}).`,
    );
  }

  const newToken = decryptToken(refreshedRow.accessTokenEncrypted);
  try {
    return await input.apiCall(newToken);
  } catch (retryErr) {
    if (retryErr instanceof Unauthorized401Error) {
      // Refresh succeeded but the new token is still rejected — the
      // integration genuinely needs user action (scope shrunk, account
      // moved, provider-side revoke, etc.).
      throw new IntegrationActionRequiredError({
        userId: input.userId,
        provider: input.provider,
        accountId,
        reason: "refresh_failed",
        cause: retryErr,
      });
    }
    throw retryErr;
  }
}
