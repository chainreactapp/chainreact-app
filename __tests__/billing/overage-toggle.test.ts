/**
 * Unit tests for lib/billing/overage-toggle.ts.
 *
 * The toggle service is the integration point between the user's opt-in choice
 * and Stripe — it must be idempotent in both directions and fail-closed when
 * upstream config is missing (no metered price ID, no active subscription).
 */

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}))

const mockSupabase = {
  from: jest.fn(),
}
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(() => mockSupabase),
}))

const mockStripe = {
  subscriptionItems: {
    retrieve: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    del: jest.fn(),
  },
}
jest.mock('@/lib/stripe/client', () => ({
  getStripeClient: jest.fn(() => mockStripe),
}))

import { enableOverageForUser, disableOverageForUser } from '@/lib/billing/overage-toggle'

// Helper: build a chainable supabase query mock that yields a final value.
function chainable(finalResult: { data: any; error?: any }) {
  const chain: any = {}
  const proxy: any = new Proxy(chain, {
    get(_t, prop) {
      if (prop === 'then') return undefined
      if (prop === 'single') {
        return jest.fn().mockResolvedValue(finalResult)
      }
      return jest.fn().mockReturnValue(proxy)
    },
  })
  return proxy
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ─── enableOverageForUser ────────────────────────────────────────────────

describe('enableOverageForUser', () => {
  test('rejects free plan with invalid_plan code', async () => {
    mockSupabase.from.mockReturnValueOnce(
      chainable({ data: { plan: 'free', stripe_subscription_item_id: null }, error: null })
    )

    const result = await enableOverageForUser('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_plan')
  })

  test('rejects beta plan', async () => {
    mockSupabase.from.mockReturnValueOnce(
      chainable({ data: { plan: 'beta', stripe_subscription_item_id: null }, error: null })
    )
    const result = await enableOverageForUser('user-1')
    expect(result.ok).toBe(false)
  })

  test('rejects enterprise plan', async () => {
    mockSupabase.from.mockReturnValueOnce(
      chainable({ data: { plan: 'enterprise', stripe_subscription_item_id: null }, error: null })
    )
    const result = await enableOverageForUser('user-1')
    expect(result.ok).toBe(false)
  })

  test('idempotent: returns existing item when already enabled and item still exists in Stripe', async () => {
    mockSupabase.from.mockReturnValueOnce(
      chainable({ data: { plan: 'pro', stripe_subscription_item_id: 'si_existing' }, error: null })
    )
    mockStripe.subscriptionItems.retrieve.mockResolvedValueOnce({ id: 'si_existing', deleted: false })

    const result = await enableOverageForUser('user-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.subscriptionItemId).toBe('si_existing')
    expect(mockStripe.subscriptionItems.create).not.toHaveBeenCalled()
  })

  test('rejects when no active subscription found', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainable({ data: { plan: 'pro', stripe_subscription_item_id: null }, error: null }))
      .mockReturnValueOnce(chainable({ data: null, error: { message: 'no rows' } }))

    const result = await enableOverageForUser('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no_subscription')
  })

  test('rejects when plan has no metered price ID configured', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainable({ data: { plan: 'pro', stripe_subscription_item_id: null }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_subscription_id: 'sub_123', billing_cycle: 'monthly', status: 'active' }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_metered_price_id_monthly: null }, error: null }))

    const result = await enableOverageForUser('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no_metered_price')
  })

  test('creates monthly subscription_item without billing_thresholds', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainable({ data: { plan: 'pro', stripe_subscription_item_id: null }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_subscription_id: 'sub_123', billing_cycle: 'monthly', status: 'active' }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_metered_price_id_monthly: 'price_metered_pro_m' }, error: null }))
      .mockReturnValueOnce(chainable({ data: null, error: null })) // final update on user_profiles

    mockStripe.subscriptionItems.list.mockResolvedValueOnce({ data: [] })
    mockStripe.subscriptionItems.create.mockResolvedValueOnce({ id: 'si_new' })

    const result = await enableOverageForUser('user-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.subscriptionItemId).toBe('si_new')

    expect(mockStripe.subscriptionItems.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: 'sub_123',
        price: 'price_metered_pro_m',
        proration_behavior: 'none',
      })
    )
    // Monthly subs do NOT get billing_thresholds
    const createArg = mockStripe.subscriptionItems.create.mock.calls[0][0]
    expect(createArg.billing_thresholds).toBeUndefined()
  })

  test('creates yearly subscription_item with billing_thresholds.usage_gte: 1000', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainable({ data: { plan: 'pro', stripe_subscription_item_id: null }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_subscription_id: 'sub_yearly', billing_cycle: 'yearly', status: 'active' }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_metered_price_id_yearly: 'price_metered_pro_y' }, error: null }))
      .mockReturnValueOnce(chainable({ data: null, error: null }))

    mockStripe.subscriptionItems.list.mockResolvedValueOnce({ data: [] })
    mockStripe.subscriptionItems.create.mockResolvedValueOnce({ id: 'si_yearly' })

    await enableOverageForUser('user-1')

    const createArg = mockStripe.subscriptionItems.create.mock.calls[0][0]
    expect(createArg.billing_thresholds).toEqual({ usage_gte: 1000 })
  })

  test('idempotent: re-uses subscription_item already attached to subscription via Stripe list', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainable({ data: { plan: 'pro', stripe_subscription_item_id: null }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_subscription_id: 'sub_123', billing_cycle: 'monthly', status: 'active' }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_metered_price_id_monthly: 'price_metered_pro_m' }, error: null }))
      .mockReturnValueOnce(chainable({ data: null, error: null }))

    mockStripe.subscriptionItems.list.mockResolvedValueOnce({
      data: [{ id: 'si_already_there', price: { id: 'price_metered_pro_m' } }],
    })

    const result = await enableOverageForUser('user-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.subscriptionItemId).toBe('si_already_there')
    expect(mockStripe.subscriptionItems.create).not.toHaveBeenCalled()
  })

  test('returns stripe_error when Stripe.create throws', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainable({ data: { plan: 'pro', stripe_subscription_item_id: null }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_subscription_id: 'sub_123', billing_cycle: 'monthly', status: 'active' }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_metered_price_id_monthly: 'price_metered_pro_m' }, error: null }))

    mockStripe.subscriptionItems.list.mockResolvedValueOnce({ data: [] })
    mockStripe.subscriptionItems.create.mockRejectedValueOnce(new Error('Stripe is on fire'))

    const result = await enableOverageForUser('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('stripe_error')
      expect(result.error).toContain('Stripe is on fire')
    }
  })
})

// ─── disableOverageForUser ────────────────────────────────────────────────

describe('disableOverageForUser', () => {
  test('idempotent no-op when no item recorded', async () => {
    mockSupabase.from.mockReturnValueOnce(
      chainable({ data: { stripe_subscription_item_id: null }, error: null })
    )

    const result = await disableOverageForUser('user-1')
    expect(result.ok).toBe(true)
    expect(mockStripe.subscriptionItems.del).not.toHaveBeenCalled()
  })

  test('deletes subscription_item and clears DB column on success', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainable({ data: { stripe_subscription_item_id: 'si_remove' }, error: null }))
      .mockReturnValueOnce(chainable({ data: null, error: null }))

    mockStripe.subscriptionItems.del.mockResolvedValueOnce({ id: 'si_remove', deleted: true })

    const result = await disableOverageForUser('user-1')
    expect(result.ok).toBe(true)
    expect(mockStripe.subscriptionItems.del).toHaveBeenCalledWith(
      'si_remove',
      expect.objectContaining({ proration_behavior: 'none', clear_usage: false })
    )
  })

  test('treats Stripe 404 as already-deleted and clears DB column', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainable({ data: { stripe_subscription_item_id: 'si_gone' }, error: null }))
      .mockReturnValueOnce(chainable({ data: null, error: null }))

    const stripeErr: any = new Error('No such subscription_item')
    stripeErr.statusCode = 404
    mockStripe.subscriptionItems.del.mockRejectedValueOnce(stripeErr)

    const result = await disableOverageForUser('user-1')
    expect(result.ok).toBe(true)
  })

  test('returns error when Stripe fails with non-404', async () => {
    mockSupabase.from.mockReturnValueOnce(
      chainable({ data: { stripe_subscription_item_id: 'si_x' }, error: null })
    )

    const stripeErr: any = new Error('Stripe internal error')
    stripeErr.statusCode = 500
    mockStripe.subscriptionItems.del.mockRejectedValueOnce(stripeErr)

    const result = await disableOverageForUser('user-1')
    expect(result.ok).toBe(false)
  })
})
