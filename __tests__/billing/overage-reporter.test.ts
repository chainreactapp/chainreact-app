/**
 * Unit tests for lib/billing/overage-reporter.ts.
 *
 * The reporter must be idempotent under retry — if the DB stamp fails after
 * Stripe success, the next tick's call must produce the same meter-event
 * `identifier` so Stripe dedupes server-side and we don't double-charge.
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
  billing: {
    meterEvents: {
      create: jest.fn(),
    },
  },
}
jest.mock('@/lib/stripe/client', () => ({
  getStripeClient: jest.fn(() => mockStripe),
}))

import { reportOverageToStripe } from '@/lib/billing/overage-reporter'

function chainable(finalResult: { data: any; error?: any }) {
  const proxy: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return undefined
      if (prop === 'single') return jest.fn().mockResolvedValue(finalResult)
      if (prop === Symbol.toPrimitive) return undefined
      return jest.fn().mockReturnValue(proxy)
    },
  })
  return proxy
}

// Special chainable that resolves on .in() (used for the bulk update at end of reporter)
function chainableTerminalOnIn(finalResult: { data: any; error?: any }) {
  const proxy: any = {
    update: jest.fn().mockReturnThis(),
    in: jest.fn().mockResolvedValue(finalResult),
  }
  return proxy
}

// Special chainable that resolves on .order().limit() with the events list
function chainableEventList(events: any[], error: any = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: events, error }),
  }
}

// Reporter calls supabase in this order:
//   1. user_profiles  (.single())                — gate: stripe_subscription_item_id
//   2. subscriptions  (.single())                — fetch stripe_customer_id
//   3. task_overage_events (.order().limit())    — events to drain
//   4. task_overage_events (.update().in())      — DB stamp on success
function mockHappyPath(events: any[], stampResult: { data: any; error?: any } = { data: null, error: null }) {
  mockSupabase.from
    .mockReturnValueOnce(chainable({ data: { stripe_subscription_item_id: 'si_1' }, error: null }))
    .mockReturnValueOnce(chainable({ data: { stripe_customer_id: 'cus_abc' }, error: null }))
    .mockReturnValueOnce(chainableEventList(events))
    .mockReturnValueOnce(chainableTerminalOnIn(stampResult))
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('reportOverageToStripe', () => {
  test('skips when user has no stripe_subscription_item_id', async () => {
    mockSupabase.from.mockReturnValueOnce(
      chainable({ data: { stripe_subscription_item_id: null }, error: null })
    )

    const result = await reportOverageToStripe('user-1')
    expect(result.ok).toBe(false)
    expect(result.skipped).toBe('no_subscription_item')
    expect(mockStripe.billing.meterEvents.create).not.toHaveBeenCalled()
  })

  test('skips when no stripe_customer_id is found', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainable({ data: { stripe_subscription_item_id: 'si_1' }, error: null }))
      .mockReturnValueOnce(chainable({ data: null, error: null }))

    const result = await reportOverageToStripe('user-1')
    expect(result.ok).toBe(false)
    expect(result.skipped).toBe('no_customer')
    expect(mockStripe.billing.meterEvents.create).not.toHaveBeenCalled()
  })

  test('skips when no unreported events exist', async () => {
    mockSupabase.from
      .mockReturnValueOnce(chainable({ data: { stripe_subscription_item_id: 'si_1' }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_customer_id: 'cus_abc' }, error: null }))
      .mockReturnValueOnce(chainableEventList([]))

    const result = await reportOverageToStripe('user-1')
    expect(result.ok).toBe(true)
    expect(result.skipped).toBe('no_events')
    expect(mockStripe.billing.meterEvents.create).not.toHaveBeenCalled()
  })

  test('reports sum of unreported events with stable identifier', async () => {
    const events = [
      { id: 'evt-aaa', amount: 50, created_at: '2026-05-01T10:00:00Z', stripe_subscription_item_id: 'si_1' },
      { id: 'evt-bbb', amount: 30, created_at: '2026-05-01T11:00:00Z', stripe_subscription_item_id: 'si_1' },
    ]

    mockHappyPath(events)
    mockStripe.billing.meterEvents.create.mockResolvedValueOnce({ identifier: 'overage:user-1:abc' })

    const result = await reportOverageToStripe('user-1')
    expect(result.ok).toBe(true)
    expect(result.reportedCount).toBe(2)
    expect(result.reportedAmount).toBe(80)
    // The reporter stamps the *deterministic* identifier we computed, not whatever Stripe echoes back.
    expect(result.stripeUsageRecordId).toMatch(/^overage:user-1:[a-f0-9]{24}$/)

    // Validate single Stripe call — event_name + payload + identifier
    expect(mockStripe.billing.meterEvents.create).toHaveBeenCalledTimes(1)
    const [body] = mockStripe.billing.meterEvents.create.mock.calls[0]
    expect(body.event_name).toBe('task_overage')
    expect(body.payload).toEqual({
      stripe_customer_id: 'cus_abc',
      value: '80', // payload values must be strings
    })
    expect(typeof body.timestamp).toBe('number')
    expect(body.identifier).toMatch(/^overage:user-1:[a-f0-9]{24}$/)
  })

  test('identifier is stable across retries with the same event set', async () => {
    const events = [
      { id: 'evt-aaa', amount: 10, created_at: '2026-05-01T10:00:00Z', stripe_subscription_item_id: 'si_1' },
      { id: 'evt-bbb', amount: 20, created_at: '2026-05-01T11:00:00Z', stripe_subscription_item_id: 'si_1' },
    ]

    // First call — Stripe succeeds, DB stamp succeeds
    mockHappyPath(events)
    mockStripe.billing.meterEvents.create.mockResolvedValueOnce({ identifier: 'x' })
    await reportOverageToStripe('user-1')

    const firstId = mockStripe.billing.meterEvents.create.mock.calls[0][0].identifier

    // Second call (retry) — same events, must produce same identifier.
    mockStripe.billing.meterEvents.create.mockClear()
    mockHappyPath(events)
    mockStripe.billing.meterEvents.create.mockResolvedValueOnce({ identifier: 'x' })
    await reportOverageToStripe('user-1')

    const secondId = mockStripe.billing.meterEvents.create.mock.calls[0][0].identifier

    expect(secondId).toBe(firstId)
  })

  test('returns failure but preserves Stripe success when DB stamp fails', async () => {
    const events = [
      { id: 'evt-1', amount: 100, created_at: '2026-05-01T10:00:00Z', stripe_subscription_item_id: 'si_1' },
    ]

    mockHappyPath(events, { data: null, error: { message: 'connection lost' } })
    mockStripe.billing.meterEvents.create.mockResolvedValueOnce({ identifier: 'x' })

    const result = await reportOverageToStripe('user-1')
    expect(result.ok).toBe(false)
    // Critical: we surface the deterministic identifier so the next retry uses
    // the exact same value and Stripe dedupes the second send.
    expect(result.stripeUsageRecordId).toMatch(/^overage:user-1:[a-f0-9]{24}$/)
    expect(result.error).toContain('DB stamp failed')
  })

  test('returns failure when Stripe billing.meterEvents.create throws', async () => {
    const events = [
      { id: 'evt-1', amount: 5, created_at: '2026-05-01T10:00:00Z', stripe_subscription_item_id: 'si_1' },
    ]

    mockSupabase.from
      .mockReturnValueOnce(chainable({ data: { stripe_subscription_item_id: 'si_1' }, error: null }))
      .mockReturnValueOnce(chainable({ data: { stripe_customer_id: 'cus_abc' }, error: null }))
      .mockReturnValueOnce(chainableEventList(events))

    mockStripe.billing.meterEvents.create.mockRejectedValueOnce(new Error('Stripe rate-limited'))

    const result = await reportOverageToStripe('user-1')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Stripe rate-limited')
  })
})
