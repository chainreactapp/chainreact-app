/**
 * Unit tests for lib/billing/auto-buy.ts.
 *
 * Auto-buy is the most error-prone path — it touches both Stripe (off-session
 * payment intent) and DB (pack_purchases insert/update + user_profiles balance
 * + task_billing_events audit). These tests verify it bails early when any
 * prerequisite is missing, handles SCA / decline correctly, and credits
 * balance synchronously on success.
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
  paymentIntents: {
    create: jest.fn(),
  },
}
jest.mock('@/lib/stripe/client', () => ({
  getStripeClient: jest.fn(() => mockStripe),
}))

import { triggerAutoBuyIfEnabled } from '@/lib/billing/auto-buy'

// Returns a chainable proxy whose `.single()` resolves to `finalResult`.
function chainableSingle(finalResult: { data: any; error?: any }) {
  const proxy: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return undefined
      if (prop === 'single') return jest.fn().mockResolvedValue(finalResult)
      return jest.fn().mockReturnValue(proxy)
    },
  })
  return proxy
}

// Returns a chainable proxy whose terminal `.eq()` resolves (used for UPDATE chains).
function chainableTerminalOnEq(finalResult: { data: any; error?: any }) {
  const proxy: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return undefined
      // any chained method returns the proxy; .eq is the terminal
      if (prop === 'eq') {
        // first .eq returns proxy; second .eq is the terminal
        let calls = 0
        return jest.fn().mockImplementation(() => {
          calls++
          return calls === 2 ? Promise.resolve(finalResult) : proxy
        })
      }
      return jest.fn().mockReturnValue(proxy)
    },
  })
  return proxy
}

// Update chain that resolves on the FIRST .eq() (e.g. .update().eq()).
function updateOneEq(finalResult: { data: any; error?: any }) {
  return {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue(finalResult),
  }
}

// Update chain that resolves on the SECOND .eq() (e.g. .update().eq().eq()).
function updateTwoEqs(finalResult: { data: any; error?: any }) {
  let calls = 0
  const obj: any = {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockImplementation(() => {
      calls++
      return calls < 2 ? obj : Promise.resolve(finalResult)
    }),
  }
  return obj
}

// Insert chain that resolves on .insert()
function insertReturning(finalResult: { data: any; error?: any }) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue(finalResult),
      }),
    }),
  }
}

// Plain insert (audit row)
function plainInsert() {
  return {
    insert: jest.fn().mockResolvedValue({ data: null, error: null }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('triggerAutoBuyIfEnabled', () => {
  test('bails with not_enabled when auto_buy_packs is false', async () => {
    mockSupabase.from.mockReturnValueOnce(
      chainableSingle({ data: { plan: 'pro', auto_buy_packs: false, task_pack_balance: 0 }, error: null })
    )

    const result = await triggerAutoBuyIfEnabled('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_enabled')
    expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled()
  })

  test('bails with plan_ineligible for free tier even if auto_buy_packs=true', async () => {
    mockSupabase.from.mockReturnValueOnce(
      chainableSingle({ data: { plan: 'free', auto_buy_packs: true, task_pack_balance: 0 }, error: null })
    )

    const result = await triggerAutoBuyIfEnabled('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('plan_ineligible')
  })

  test('bails with no_pack_configured when plan has no pack_size', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainableSingle({ data: { plan: 'pro', auto_buy_packs: true, task_pack_balance: 0 }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { pack_size: null, pack_price_cents: null, stripe_pack_price_id: null }, error: null }))

    const result = await triggerAutoBuyIfEnabled('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no_pack_configured')
  })

  test('bails with no_subscription when no active subscription found', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainableSingle({ data: { plan: 'pro', auto_buy_packs: true, task_pack_balance: 0 }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { pack_size: 1000, pack_price_cents: 1500, stripe_pack_price_id: 'price_pack' }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: null, error: { message: 'no rows' } }))

    const result = await triggerAutoBuyIfEnabled('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no_subscription')
  })

  test('bails with no_payment_method when subscription has no default_payment_method_id', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainableSingle({ data: { plan: 'pro', auto_buy_packs: true, task_pack_balance: 0 }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { pack_size: 1000, pack_price_cents: 1500, stripe_pack_price_id: 'price_pack' }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { stripe_customer_id: 'cus_1', default_payment_method_id: null }, error: null }))

    const result = await triggerAutoBuyIfEnabled('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no_payment_method')
  })

  test('happy path: creates payment intent and credits balance synchronously', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainableSingle({ data: { plan: 'pro', auto_buy_packs: true, task_pack_balance: 50 }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { pack_size: 1000, pack_price_cents: 1500, stripe_pack_price_id: 'price_pack' }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_card' }, error: null }))
      .mockReturnValueOnce(insertReturning({ data: { id: 'pp_pending' }, error: null })) // pre-insert pack_purchases
      .mockReturnValueOnce(updateTwoEqs({ data: null, error: null })) // flip to paid: .eq('id').eq('status')
      .mockReturnValueOnce(updateOneEq({ data: null, error: null })) // credit user_profiles balance
      .mockReturnValueOnce(plainInsert()) // audit row insert

    mockStripe.paymentIntents.create.mockResolvedValueOnce({
      id: 'pi_success',
      status: 'succeeded',
    })

    const result = await triggerAutoBuyIfEnabled('user-1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.packSize).toBe(1000)
      expect(result.newBalance).toBe(1050) // 50 existing + 1000 new
      expect(result.paymentIntentId).toBe('pi_success')
    }

    // Validate Stripe call shape
    const [piArgs, piOpts] = mockStripe.paymentIntents.create.mock.calls[0]
    expect(piArgs).toEqual(expect.objectContaining({
      amount: 1500,
      currency: 'usd',
      customer: 'cus_1',
      payment_method: 'pm_card',
      off_session: true,
      confirm: true,
    }))
    expect(piArgs.metadata.pack_purchase_id).toBe('pp_pending')
    expect(piArgs.metadata.triggered_by).toBe('auto_buy')
    expect(piOpts.idempotencyKey).toBe('auto_buy:pp_pending')
  })

  test('returns sca_required when Stripe throws authentication_required', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainableSingle({ data: { plan: 'pro', auto_buy_packs: true, task_pack_balance: 0 }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { pack_size: 1000, pack_price_cents: 1500, stripe_pack_price_id: 'price_pack' }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_card' }, error: null }))
      .mockReturnValueOnce(insertReturning({ data: { id: 'pp_pending' }, error: null }))
      .mockReturnValueOnce(updateOneEq({ data: null, error: null })) // failed flip

    const stripeErr: any = new Error('Authentication required')
    stripeErr.code = 'authentication_required'
    mockStripe.paymentIntents.create.mockRejectedValueOnce(stripeErr)

    const result = await triggerAutoBuyIfEnabled('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('sca_required')
  })

  test('returns declined when Stripe throws non-SCA error', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainableSingle({ data: { plan: 'pro', auto_buy_packs: true, task_pack_balance: 0 }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { pack_size: 1000, pack_price_cents: 1500, stripe_pack_price_id: 'price_pack' }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_card' }, error: null }))
      .mockReturnValueOnce(insertReturning({ data: { id: 'pp_pending' }, error: null }))
      .mockReturnValueOnce(updateOneEq({ data: null, error: null }))

    const stripeErr: any = new Error('Your card was declined.')
    stripeErr.code = 'card_declined'
    mockStripe.paymentIntents.create.mockRejectedValueOnce(stripeErr)

    const result = await triggerAutoBuyIfEnabled('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('declined')
  })

  test('returns sca_required when payment intent status is not succeeded synchronously', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainableSingle({ data: { plan: 'pro', auto_buy_packs: true, task_pack_balance: 0 }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { pack_size: 1000, pack_price_cents: 1500, stripe_pack_price_id: 'price_pack' }, error: null }))
      .mockReturnValueOnce(chainableSingle({ data: { stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_card' }, error: null }))
      .mockReturnValueOnce(insertReturning({ data: { id: 'pp_pending' }, error: null }))

    mockStripe.paymentIntents.create.mockResolvedValueOnce({ id: 'pi_x', status: 'requires_action' })

    const result = await triggerAutoBuyIfEnabled('user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('sca_required')
  })
})
