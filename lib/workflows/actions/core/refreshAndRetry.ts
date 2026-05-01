/**
 * Provider-aware OAuth 401 refresh+retry wrapper (PR-C3, Q3).
 *
 * Wraps a single outbound provider call. On a 401 from that call:
 *
 *   - **OAuth-with-refresh providers** (Google, Microsoft, Notion, Shopify,
 *     HubSpot, Mailchimp, Airtable, etc.): call
 *     `tokenRefreshService.refresh(provider, userId)`, re-issue the call
 *     once with the new access token. If the retry still returns 401, emit
 *     a `token_revoked` health signal and return the standardized auth
 *     failure shape.
 *   - **Non-refreshable auth schemes** (Slack / Discord bot tokens, GitHub
 *     PAT, Stripe API key, plain API keys): no refresh attempt is made.
 *     Emit an `action_required` health signal and return the auth failure
 *     immediately.
 *
 * The 401 detector understands every shape providers throw:
 *   - Raw fetch `Response` with `status === 401`
 *   - Thrown error with `code: 401` (Google `googleapis` SDK)
 *   - Thrown error with `status: 401` / `statusCode: 401`
 *   - Thrown error with `response.status === 401` (axios-style)
 *   - `StripeAuthenticationError` (Stripe Node SDK error class)
 *
 * Other thrown errors propagate up unchanged — Q1 says only "expected"
 * failures get the structured shape; everything else is a programmer /
 * system error and the engine catches it as `category: 'internal'`.
 *
 * Contract: see `learning/docs/handler-contracts.md` Q3.
 */

import { getAuthScheme } from '@/lib/integrations/authSchemes'
import { refresh as refreshTokenForUser } from '@/lib/integrations/tokenRefreshService'
import { computeTransitionAndNotify } from '@/lib/integrations/healthTransitionEngine'
import {
  classifyOAuthError,
  type ClassifiedError,
} from '@/lib/integrations/errorClassificationService'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/utils/logger'

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type AuthFailureCode = 'TOKEN_REVOKED' | 'ACTION_REQUIRED'

export interface RefreshAndRetryParams<T> {
  provider: string
  userId: string
  /** Initial access token used for the first attempt. */
  accessToken: string
  /**
   * The outbound call. Receives the access token (initial or refreshed).
   * Should return whatever the provider returns: a `Response`, an SDK
   * result, or `void`. Throwing on non-401 errors is fine — those propagate
   * through the helper unchanged.
   */
  call: (token: string) => Promise<T>
  /**
   * Optional Supabase client. Used to load the integration row when
   * emitting a health signal. Defaults to the admin client. Tests inject a
   * stub to avoid touching the real DB.
   */
  supabase?: any
}

export interface RefreshAndRetrySuccess<T> {
  success: true
  data: T
}

export interface RefreshAndRetryFailure {
  success: false
  category: 'auth'
  error: { code: AuthFailureCode }
  message: string
  /** True iff a token refresh was attempted (i.e. provider is OAuth-with-refresh). */
  refreshAttempted: boolean
}

export type RefreshAndRetryResult<T> =
  | RefreshAndRetrySuccess<T>
  | RefreshAndRetryFailure

// ─────────────────────────────────────────────────────────────────────────────
// 401 detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true iff the given thrown error or returned value indicates a 401.
 *
 * Exported for the per-handler tests in PR-C3b — handlers may want to
 * assert the same detection in cases where they choose not to wrap a
 * specific call.
 */
export function isUnauthorized(input: { result?: any; error?: any }): boolean {
  const { result, error } = input
  if (error !== undefined && error !== null) {
    return errorIs401(error)
  }
  if (result !== undefined && result !== null) {
    return resultIs401(result)
  }
  return false
}

function errorIs401(err: any): boolean {
  // Stripe SDK class. Stripe is non_refreshable in our registry; the helper
  // still detects this so the engine can route to action_required cleanly.
  if (err?.name === 'StripeAuthenticationError') return true
  // Numeric / string code at top level (Google googleapis SDK uses `code`).
  if (matches401(err?.code)) return true
  if (matches401(err?.status)) return true
  if (matches401(err?.statusCode)) return true
  // axios-style nested response object.
  if (matches401(err?.response?.status)) return true
  if (matches401(err?.response?.statusCode)) return true
  return false
}

function resultIs401(result: any): boolean {
  // Raw `Response` from `fetch`.
  if (typeof result === 'object' && matches401(result?.status)) {
    // Heuristic: only treat as a Response-like 401 if `ok` is also explicitly
    // false (or absent — many test mocks omit `ok`). Avoids misclassifying
    // arbitrary domain objects that happen to have a `status: 401` field.
    if (result.ok === undefined || result.ok === false) {
      return true
    }
  }
  return false
}

function matches401(value: any): boolean {
  return value === 401 || value === '401'
}

// ─────────────────────────────────────────────────────────────────────────────
// Health signal
// ─────────────────────────────────────────────────────────────────────────────

interface AuthSignalParams {
  provider: string
  userId: string
  supabase?: any
  classifiedError: ClassifiedError
}

/**
 * Best-effort emit of an auth-related health signal via
 * `computeTransitionAndNotify`. Failures here MUST NOT mask the original
 * auth failure — we always log and continue so the caller still returns
 * the standardized auth-failure shape to the workflow engine.
 */
async function emitAuthSignal(params: AuthSignalParams): Promise<void> {
  const { provider, userId, classifiedError } = params
  try {
    const supabase = params.supabase ?? createAdminClient()
    const { data: integration, error } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single()

    if (error || !integration) {
      logger.warn(
        `[refreshAndRetry] Could not load integration row for health signal: ${provider}/${userId}`
      )
      return
    }

    await computeTransitionAndNotify(supabase, integration, {
      classifiedError,
      source: 'token_refresh',
      isRecovery: false,
    })
  } catch (err: any) {
    logger.warn(
      `[refreshAndRetry] emitAuthSignal failed for ${provider}: ${err?.message}`
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build standardized failure
// ─────────────────────────────────────────────────────────────────────────────

function buildFailure(
  code: AuthFailureCode,
  message: string,
  refreshAttempted: boolean
): RefreshAndRetryFailure {
  return {
    success: false,
    category: 'auth',
    error: { code },
    message,
    refreshAttempted,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the provided call once with the initial access token. On 401:
 *  - Non-refreshable provider → action_required, no refresh attempted.
 *  - OAuth-with-refresh provider → refresh once, retry once. Permanent
 *    failure → token_revoked.
 * Other errors propagate. Successful results return `{ success: true, data }`.
 */
export async function refreshAndRetry<T>(
  params: RefreshAndRetryParams<T>
): Promise<RefreshAndRetryResult<T>> {
  const { provider, userId, accessToken, call, supabase } = params

  // ─── First attempt ───────────────────────────────────────────────────────
  let initialError: any | undefined
  let initialResult: T | undefined
  try {
    const data = await call(accessToken)
    if (!isUnauthorized({ result: data })) {
      return { success: true, data }
    }
    initialResult = data
  } catch (err) {
    if (!isUnauthorized({ error: err })) throw err
    initialError = err
  }

  // ─── Recovery path depends on auth scheme ────────────────────────────────
  const scheme = getAuthScheme(provider)

  if (scheme === 'non_refreshable') {
    await emitAuthSignal({
      provider,
      userId,
      supabase,
      classifiedError: classifyOAuthError(
        provider,
        401,
        initialError ?? initialResult
      ),
    })
    return buildFailure(
      'ACTION_REQUIRED',
      `Provider "${provider}" returned 401 and has no refresh path — user must reconnect.`,
      false
    )
  }

  // oauth_with_refresh
  const refreshResult = await refreshTokenForUser(provider, userId, { supabase })

  if (!refreshResult.success || !refreshResult.accessToken) {
    const classified =
      refreshResult.classifiedError ??
      classifyOAuthError(
        provider,
        refreshResult.statusCode ?? 401,
        refreshResult.error ?? initialError ?? initialResult
      )
    await emitAuthSignal({ provider, userId, supabase, classifiedError: classified })
    // Prefer the classifiedError's human-readable message (which always
    // contains "reconnect" / "Please reconnect your account") over the raw
    // provider error code (e.g., "invalid_grant"). Falls back to the raw
    // error string if no classifiedError surfaces.
    const message =
      classified?.message ??
      refreshResult.error ??
      `Token refresh failed for "${provider}" — user must reconnect.`
    return buildFailure('TOKEN_REVOKED', message, true)
  }

  // ─── Retry once with the refreshed token ─────────────────────────────────
  try {
    const data = await call(refreshResult.accessToken)
    if (!isUnauthorized({ result: data })) {
      return { success: true, data }
    }
    // Refresh succeeded but the retry still returned 401 — token revoked
    // server-side or the refreshed token doesn't grant the needed scope.
    await emitAuthSignal({
      provider,
      userId,
      supabase,
      classifiedError: classifyOAuthError(provider, 401, data),
    })
    return buildFailure(
      'TOKEN_REVOKED',
      `Refresh succeeded but retry still returned 401 for "${provider}" — user must reconnect.`,
      true
    )
  } catch (err) {
    if (!isUnauthorized({ error: err })) throw err
    await emitAuthSignal({
      provider,
      userId,
      supabase,
      classifiedError: classifyOAuthError(provider, 401, err),
    })
    return buildFailure(
      'TOKEN_REVOKED',
      `Refresh succeeded but retry threw 401 for "${provider}" — user must reconnect.`,
      true
    )
  }
}
