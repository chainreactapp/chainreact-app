/**
 * Contract: PR-C3a — provider-aware refresh+retry wrapper (Q3).
 *
 * Source files exercised:
 *   - lib/integrations/authSchemes.ts        (provider → scheme map)
 *   - lib/workflows/actions/core/refreshAndRetry.ts (the wrapper)
 *
 * Contract: see learning/docs/handler-contracts.md Q3.
 *
 * What this file proves (pure-function level):
 *   - 401 normalization across raw-fetch Response, Google googleapis SDK
 *     thrown error (`code: 401`), axios-style nested error
 *     (`error.response.status === 401`), and Stripe SDK
 *     (`name: 'StripeAuthenticationError'`).
 *   - OAuth-with-refresh provider: transient 401 → refresh once → retry
 *     succeeds → caller sees `{ success: true, data }`.
 *   - OAuth-with-refresh provider: permanent 401 → refresh succeeds but
 *     retry still 401 → standardized auth failure (TOKEN_REVOKED) + health
 *     signal emitted.
 *   - OAuth-with-refresh provider: refresh itself fails → standardized
 *     auth failure (TOKEN_REVOKED) + health signal.
 *   - Non-refreshable provider: 401 → no refresh attempted → standardized
 *     auth failure (ACTION_REQUIRED) + health signal.
 *   - Successful first attempt → no refresh, no signal.
 *   - Non-401 thrown errors propagate (Q1: only expected failures get the
 *     structured shape).
 *
 * Per-handler tests with raw-fetch / SDK / Stripe paths arrive in PR-C3b.
 */

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}))

// `refreshAndRetry` calls `tokenRefreshService.refresh(provider, userId)`.
// Mock the module so each test controls the outcome explicitly.
const mockRefresh = jest.fn()
jest.mock('@/lib/integrations/tokenRefreshService', () => ({
  refresh: mockRefresh,
}))

// `refreshAndRetry` emits health signals via `computeTransitionAndNotify`.
const mockComputeTransitionAndNotify = jest.fn()
jest.mock('@/lib/integrations/healthTransitionEngine', () => ({
  computeTransitionAndNotify: mockComputeTransitionAndNotify,
}))

// Stub the admin Supabase client so test runs never reach the network.
// Callers can pass `supabase` explicitly via the helper to override; the
// default-injection path is exercised once below.
const mockIntegrationRow = {
  id: 'int-1',
  user_id: 'user-1',
  provider: 'gmail',
  health_check_status: 'healthy',
  last_notification_milestone: 'none',
  requires_user_action: false,
  user_action_type: null,
  user_action_deadline: null,
}
const mockAdminSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: mockIntegrationRow, error: null }),
}
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(() => mockAdminSupabase),
}))

import {
  refreshAndRetry,
  isUnauthorized,
} from '@/lib/workflows/actions/core/refreshAndRetry'
import { getAuthScheme } from '@/lib/integrations/authSchemes'

beforeEach(() => {
  mockRefresh.mockReset()
  mockComputeTransitionAndNotify.mockReset().mockResolvedValue({ stateChanged: true })
  mockAdminSupabase.from.mockClear()
  mockAdminSupabase.select.mockClear()
  mockAdminSupabase.eq.mockClear()
  mockAdminSupabase.single.mockClear().mockResolvedValue({ data: mockIntegrationRow, error: null })
})

// ─────────────────────────────────────────────────────────────────────────────
// authSchemes registry
// ─────────────────────────────────────────────────────────────────────────────

describe('authSchemes — getAuthScheme', () => {
  test.each([
    ['gmail', 'oauth_with_refresh'],
    ['google-calendar', 'oauth_with_refresh'],
    ['google-drive', 'oauth_with_refresh'],
    ['microsoft-outlook', 'oauth_with_refresh'],
    ['notion', 'oauth_with_refresh'],
    ['hubspot', 'oauth_with_refresh'],
    ['airtable', 'oauth_with_refresh'],
  ])('OAuth-with-refresh provider %s', (provider, expected) => {
    expect(getAuthScheme(provider)).toBe(expected)
  })

  test.each([
    ['slack', 'non_refreshable'],
    ['discord', 'non_refreshable'],
    ['github', 'non_refreshable'],
    ['stripe', 'non_refreshable'],
    // Shopify offline access tokens have no refresh grant — treat as
    // non_refreshable. A 401 means the merchant uninstalled / token was
    // revoked.
    ['shopify', 'non_refreshable'],
  ])('non-refreshable provider %s', (provider, expected) => {
    expect(getAuthScheme(provider)).toBe(expected)
  })

  test('unknown providers default to non_refreshable (safe default)', () => {
    expect(getAuthScheme('a-provider-that-does-not-exist')).toBe('non_refreshable')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 401 normalization (the isUnauthorized predicate)
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshAndRetry — 401 normalization', () => {
  test('raw-fetch Response with status 401 is detected', () => {
    expect(isUnauthorized({ result: { status: 401, ok: false } })).toBe(true)
  })

  test('raw-fetch Response with status 200 is NOT detected', () => {
    expect(isUnauthorized({ result: { status: 200, ok: true } })).toBe(false)
  })

  test('Google googleapis SDK thrown error (code: 401) is detected', () => {
    const sdkError = Object.assign(new Error('Unauthorized'), { code: 401 })
    expect(isUnauthorized({ error: sdkError })).toBe(true)
  })

  test('error with statusCode: 401 is detected', () => {
    const err = Object.assign(new Error('boom'), { statusCode: 401 })
    expect(isUnauthorized({ error: err })).toBe(true)
  })

  test('axios-style error.response.status: 401 is detected', () => {
    const err = Object.assign(new Error('boom'), { response: { status: 401 } })
    expect(isUnauthorized({ error: err })).toBe(true)
  })

  test('StripeAuthenticationError (by class name) is detected', () => {
    const stripeErr = Object.assign(new Error('Invalid API key provided'), {
      name: 'StripeAuthenticationError',
    })
    expect(isUnauthorized({ error: stripeErr })).toBe(true)
  })

  test('non-401 errors (500, ECONNRESET, generic) are NOT detected', () => {
    expect(
      isUnauthorized({ error: Object.assign(new Error('server error'), { status: 500 }) })
    ).toBe(false)
    expect(
      isUnauthorized({ error: Object.assign(new Error('econnreset'), { code: 'ECONNRESET' }) })
    ).toBe(false)
    expect(isUnauthorized({ error: new Error('generic') })).toBe(false)
  })

  test('Response with status 401 BUT ok: true is NOT treated as 401 (avoids false positives on weird domain objects)', () => {
    expect(isUnauthorized({ result: { status: 401, ok: true } })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Happy path — first attempt succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshAndRetry — first attempt succeeds', () => {
  test('returns { success: true, data } and does NOT call refresh or signal', async () => {
    const call = jest.fn().mockResolvedValue({ status: 200, ok: true, body: 'ok' })

    const result = await refreshAndRetry({
      provider: 'gmail',
      userId: 'user-1',
      accessToken: 'tok-initial',
      call,
    })

    expect(result).toEqual({
      success: true,
      data: { status: 200, ok: true, body: 'ok' },
    })
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('tok-initial')
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockComputeTransitionAndNotify).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// OAuth-with-refresh — transient 401 → refresh → retry succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshAndRetry — OAuth transient 401 (refresh + retry succeed)', () => {
  test('raw-fetch path: 401 Response → refresh → retry returns 200', async () => {
    mockRefresh.mockResolvedValue({ success: true, accessToken: 'tok-refreshed' })

    const call = jest
      .fn()
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true, body: 'ok' })

    const result = await refreshAndRetry({
      provider: 'gmail',
      userId: 'user-1',
      accessToken: 'tok-initial',
      call,
    })

    expect(result).toEqual({
      success: true,
      data: { status: 200, ok: true, body: 'ok' },
    })
    expect(mockRefresh).toHaveBeenCalledWith('gmail', 'user-1', expect.any(Object))
    expect(call).toHaveBeenNthCalledWith(1, 'tok-initial')
    expect(call).toHaveBeenNthCalledWith(2, 'tok-refreshed')
    expect(mockComputeTransitionAndNotify).not.toHaveBeenCalled()
  })

  test('SDK path (Google): thrown 401 → refresh → retry returns SDK data', async () => {
    mockRefresh.mockResolvedValue({ success: true, accessToken: 'tok-refreshed' })

    const sdkError = Object.assign(new Error('Unauthorized'), { code: 401 })
    const call = jest
      .fn()
      .mockRejectedValueOnce(sdkError)
      .mockResolvedValueOnce({ data: { id: 'msg-1' } })

    const result = await refreshAndRetry({
      provider: 'gmail',
      userId: 'user-1',
      accessToken: 'tok-initial',
      call,
    })

    expect(result).toEqual({
      success: true,
      data: { data: { id: 'msg-1' } },
    })
    expect(mockComputeTransitionAndNotify).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// OAuth-with-refresh — permanent 401 (refresh succeeds, retry still 401)
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshAndRetry — OAuth permanent 401 (refresh succeeds but retry still 401)', () => {
  test('returns standardized auth failure (TOKEN_REVOKED) and emits health signal', async () => {
    mockRefresh.mockResolvedValue({ success: true, accessToken: 'tok-refreshed' })

    const call = jest.fn().mockResolvedValue({ status: 401, ok: false })

    const result = await refreshAndRetry({
      provider: 'gmail',
      userId: 'user-1',
      accessToken: 'tok-initial',
      call,
      supabase: mockAdminSupabase,
    })

    expect(result).toEqual({
      success: false,
      category: 'auth',
      error: { code: 'TOKEN_REVOKED' },
      message: expect.any(String),
      refreshAttempted: true,
    })
    expect(call).toHaveBeenCalledTimes(2)
    expect(mockComputeTransitionAndNotify).toHaveBeenCalledTimes(1)
    const [, integration, signal] = mockComputeTransitionAndNotify.mock.calls[0]
    expect(integration).toEqual(mockIntegrationRow)
    expect(signal.isRecovery).toBe(false)
    expect(signal.classifiedError.requiresUserAction).toBe(true)
  })

  test('SDK 401 on retry produces same standardized shape', async () => {
    mockRefresh.mockResolvedValue({ success: true, accessToken: 'tok-refreshed' })

    const sdkError = Object.assign(new Error('Unauthorized'), { code: 401 })
    const call = jest.fn().mockRejectedValue(sdkError)

    const result = await refreshAndRetry({
      provider: 'gmail',
      userId: 'user-1',
      accessToken: 'tok-initial',
      call,
      supabase: mockAdminSupabase,
    })

    expect(result.success).toBe(false)
    expect((result as any).error.code).toBe('TOKEN_REVOKED')
    expect((result as any).refreshAttempted).toBe(true)
    expect(mockComputeTransitionAndNotify).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// OAuth-with-refresh — refresh itself fails (no second attempt)
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshAndRetry — OAuth refresh itself fails', () => {
  test('refresh returns success=false → no retry, returns TOKEN_REVOKED, signals user', async () => {
    mockRefresh.mockResolvedValue({
      success: false,
      error: 'invalid_grant',
      needsReauthorization: true,
      classifiedError: {
        code: 'invalid_grant',
        isRecoverable: false,
        requiresUserAction: true,
        userActionType: 'reconnect',
        message: 'Authentication expired. Please reconnect your account.',
      },
    })

    const call = jest.fn().mockResolvedValueOnce({ status: 401, ok: false })

    const result = await refreshAndRetry({
      provider: 'gmail',
      userId: 'user-1',
      accessToken: 'tok-initial',
      call,
      supabase: mockAdminSupabase,
    })

    expect(result).toEqual({
      success: false,
      category: 'auth',
      error: { code: 'TOKEN_REVOKED' },
      // Prefer the classifiedError's human-readable message ("Please
      // reconnect") over the raw provider code ("invalid_grant"); see
      // refreshAndRetry's permanent-failure branch.
      message: expect.stringMatching(/reconnect/i),
      refreshAttempted: true,
    })
    // Only the first call ran; no retry because refresh failed.
    expect(call).toHaveBeenCalledTimes(1)
    expect(mockComputeTransitionAndNotify).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Non-refreshable providers — no refresh attempt
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshAndRetry — non-refreshable providers (Slack / Discord / GitHub / Stripe)', () => {
  test('Slack 401 → no refresh attempt → ACTION_REQUIRED + health signal', async () => {
    const call = jest.fn().mockResolvedValueOnce({ status: 401, ok: false })

    const result = await refreshAndRetry({
      provider: 'slack',
      userId: 'user-1',
      accessToken: 'xoxb-bot-token',
      call,
      supabase: {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest
          .fn()
          .mockResolvedValue({ data: { ...mockIntegrationRow, provider: 'slack' }, error: null }),
      },
    })

    expect(result).toEqual({
      success: false,
      category: 'auth',
      error: { code: 'ACTION_REQUIRED' },
      message: expect.stringContaining('slack'),
      refreshAttempted: false,
    })
    // Critical: refresh was NOT called.
    expect(mockRefresh).not.toHaveBeenCalled()
    // Health signal still emitted.
    expect(mockComputeTransitionAndNotify).toHaveBeenCalledTimes(1)
  })

  test('Discord SDK 401 thrown error → no refresh → ACTION_REQUIRED', async () => {
    const sdkError = Object.assign(new Error('Unauthorized'), { status: 401 })
    const call = jest.fn().mockRejectedValueOnce(sdkError)

    const result = await refreshAndRetry({
      provider: 'discord',
      userId: 'user-1',
      accessToken: 'bot-tok',
      call,
      supabase: {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest
          .fn()
          .mockResolvedValue({ data: { ...mockIntegrationRow, provider: 'discord' }, error: null }),
      },
    })

    expect(result.success).toBe(false)
    expect((result as any).error.code).toBe('ACTION_REQUIRED')
    expect((result as any).refreshAttempted).toBe(false)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  test('Stripe authentication error (StripeAuthenticationError class) → no refresh → ACTION_REQUIRED', async () => {
    const stripeErr = Object.assign(new Error('Invalid API key provided'), {
      name: 'StripeAuthenticationError',
      statusCode: 401,
    })
    const call = jest.fn().mockRejectedValueOnce(stripeErr)

    const result = await refreshAndRetry({
      provider: 'stripe',
      userId: 'user-1',
      accessToken: 'sk_test_xxx',
      call,
      supabase: {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest
          .fn()
          .mockResolvedValue({ data: { ...mockIntegrationRow, provider: 'stripe' }, error: null }),
      },
    })

    expect(result.success).toBe(false)
    expect((result as any).error.code).toBe('ACTION_REQUIRED')
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  test('GitHub 401 (PAT) → no refresh → ACTION_REQUIRED', async () => {
    const call = jest.fn().mockResolvedValueOnce({ status: 401, ok: false })

    const result = await refreshAndRetry({
      provider: 'github',
      userId: 'user-1',
      accessToken: 'ghp_xxx',
      call,
      supabase: {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest
          .fn()
          .mockResolvedValue({ data: { ...mockIntegrationRow, provider: 'github' }, error: null }),
      },
    })

    expect(result.success).toBe(false)
    expect((result as any).error.code).toBe('ACTION_REQUIRED')
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Non-401 errors must propagate (Q1 — only expected failures get the shape)
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshAndRetry — non-401 errors propagate unchanged', () => {
  test('thrown 500 propagates and is NOT converted to the auth-failure shape', async () => {
    const serverErr = Object.assign(new Error('server boom'), { status: 500 })
    const call = jest.fn().mockRejectedValue(serverErr)

    await expect(
      refreshAndRetry({
        provider: 'gmail',
        userId: 'user-1',
        accessToken: 'tok',
        call,
      })
    ).rejects.toBe(serverErr)

    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockComputeTransitionAndNotify).not.toHaveBeenCalled()
  })

  test('non-401 Response (e.g., 500) on first attempt is returned to the caller as success-shaped data — handler decides', async () => {
    // The 401 detector only fires on `status === 401 && ok !== true`. Other
    // non-OK Responses (e.g., 500) flow through as `data` so the handler can
    // inspect `response.ok` itself (Q1 — provider 5xx is an expected failure
    // the handler returns as `success:false`, not an auth concern).
    const call = jest.fn().mockResolvedValue({ status: 500, ok: false, body: 'boom' })

    const result = await refreshAndRetry({
      provider: 'gmail',
      userId: 'user-1',
      accessToken: 'tok',
      call,
    })

    expect(result).toEqual({
      success: true,
      data: { status: 500, ok: false, body: 'boom' },
    })
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockComputeTransitionAndNotify).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Resilience — health-signal emission failure must NOT mask the auth failure
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshAndRetry — health-signal emit failure is non-fatal', () => {
  test('if computeTransitionAndNotify throws, the auth-failure shape is still returned', async () => {
    mockComputeTransitionAndNotify.mockRejectedValue(new Error('engine offline'))

    const call = jest.fn().mockResolvedValueOnce({ status: 401, ok: false })

    const result = await refreshAndRetry({
      provider: 'slack',
      userId: 'user-1',
      accessToken: 'xoxb',
      call,
      supabase: {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest
          .fn()
          .mockResolvedValue({ data: { ...mockIntegrationRow, provider: 'slack' }, error: null }),
      },
    })

    expect(result.success).toBe(false)
    expect((result as any).error.code).toBe('ACTION_REQUIRED')
  })

  test('if integration row lookup fails, auth failure is still returned (no signal emitted)', async () => {
    const stubSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    }

    const call = jest.fn().mockResolvedValueOnce({ status: 401, ok: false })

    const result = await refreshAndRetry({
      provider: 'slack',
      userId: 'user-1',
      accessToken: 'xoxb',
      call,
      supabase: stubSupabase,
    })

    expect(result.success).toBe(false)
    expect((result as any).error.code).toBe('ACTION_REQUIRED')
    // Signal was attempted but row lookup failed; computeTransitionAndNotify
    // is never called because we couldn't load the integration.
    expect(mockComputeTransitionAndNotify).not.toHaveBeenCalled()
  })
})
