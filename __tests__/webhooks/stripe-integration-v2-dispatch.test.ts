/**
 * Contract: PR-V2-WEBHOOK-STRIPE-INT — Stripe-integration webhook
 * dispatch routes through executeWebhookWorkflow.
 *
 * Source: app/api/webhooks/stripe-integration/route.ts
 *   (dispatchStripeIntegrationWorkflow)
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 3 —
 * direct AdvancedExecutionEngine callers).
 *
 * Audit: this entry path was previously listed `Dedup: None`. Now passes
 *   dedupeKey = event.id
 * Stripe re-sends the same event.id on retry, so this is the correct
 * stable dedup signal across the full retry window.
 */

const mockExecuteWebhookWorkflow = jest.fn()
jest.mock('@/lib/webhooks/execute', () => ({
  executeWebhookWorkflow: (...args: any[]) => mockExecuteWebhookWorkflow(...args),
}))

const mockAdvancedEngineCtor = jest.fn().mockImplementation(() => ({
  createExecutionSession: jest.fn(),
  executeWorkflowAdvanced: jest.fn(),
}))
jest.mock('@/lib/execution/advancedExecutionEngine', () => ({
  AdvancedExecutionEngine: mockAdvancedEngineCtor,
}))

const mockLoggerInfo = jest.fn()
const mockLoggerError = jest.fn()
jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: (...args: any[]) => mockLoggerInfo(...args),
    error: (...args: any[]) => mockLoggerError(...args),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }))
jest.mock('next/server', () => ({
  NextRequest: class {},
  after: jest.fn((cb: any) => cb()),
}))
jest.mock('stripe', () => {
  const StripeMock: any = jest.fn()
  StripeMock.Event = class {}
  return StripeMock
})

import { dispatchStripeIntegrationWorkflow } from '@/app/api/webhooks/stripe-integration/route'

const baseWorkflow = { id: 'wf-1', user_id: 'owner-1' }

const baseEvent = {
  id: 'evt_1Abc123',
  type: 'payment_intent.succeeded',
  account: 'acct_connected',
  data: { object: { id: 'pi_1' } },
} as any

const baseResources = [{ id: 'res-1' }, { id: 'res-2' }]

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PR-V2-WEBHOOK-STRIPE-INT — dispatch contract', () => {
  test('routes through executeWebhookWorkflow with full param set', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, sessionId: 'sess-1' })

    await dispatchStripeIntegrationWorkflow(baseWorkflow, baseEvent, baseResources, 'req-xyz')

    expect(mockExecuteWebhookWorkflow).toHaveBeenCalledTimes(1)
    expect(mockExecuteWebhookWorkflow).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      userId: 'owner-1',
      provider: 'stripe',
      triggerType: 'stripe_event_payment_intent.succeeded',
      triggerData: {
        stripeEvent: baseEvent,
        triggerResourceIds: ['res-1', 'res-2'],
      },
      metadata: {
        requestId: 'req-xyz',
        eventId: 'evt_1Abc123',
        eventType: 'payment_intent.succeeded',
        connectedAccount: 'acct_connected',
      },
      dedupeKey: 'evt_1Abc123',
    })
  })

  test('AdvancedExecutionEngine is NOT instantiated', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })

    await dispatchStripeIntegrationWorkflow(baseWorkflow, baseEvent, baseResources, 'r')

    expect(mockAdvancedEngineCtor).not.toHaveBeenCalled()
  })

  test('connectedAccount falls back to null when event.account is missing', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })

    await dispatchStripeIntegrationWorkflow(
      baseWorkflow,
      { ...baseEvent, account: undefined },
      baseResources,
      'r',
    )

    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].metadata.connectedAccount).toBeNull()
  })
})

describe('PR-V2-WEBHOOK-STRIPE-INT — dedupeKey is stable across Stripe retries', () => {
  test('uses event.id directly (Stripe sends same event.id on retry)', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })

    await dispatchStripeIntegrationWorkflow(baseWorkflow, baseEvent, baseResources, 'r1')

    const firstCall = mockExecuteWebhookWorkflow.mock.calls[0][0]
    expect(firstCall.dedupeKey).toBe('evt_1Abc123')
  })

  test('different events produce different dedupeKeys', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })
    await dispatchStripeIntegrationWorkflow(
      baseWorkflow,
      { ...baseEvent, id: 'evt_other' },
      baseResources,
      'r',
    )
    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].dedupeKey).toBe('evt_other')
  })
})

describe('PR-V2-WEBHOOK-STRIPE-INT — error handling', () => {
  test('result.success: true → returns success', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, sessionId: 'sess-1', duplicate: false })

    const result = await dispatchStripeIntegrationWorkflow(baseWorkflow, baseEvent, baseResources, 'r')

    expect(result).toEqual({ success: true, sessionId: 'sess-1', duplicate: false })
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      '[Stripe Integration Webhook] Workflow execution completed',
      expect.objectContaining({ eventId: 'evt_1Abc123' }),
    )
  })

  test('result.success: false → logs error, returns failure shape, does not throw', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: false, error: 'billing rejected' })

    const result = await dispatchStripeIntegrationWorkflow(baseWorkflow, baseEvent, baseResources, 'r')

    expect(result).toEqual({ success: false, error: 'billing rejected' })
    expect(mockLoggerError).toHaveBeenCalled()
  })

  test('executeWebhookWorkflow throws → caught, logged, returns failure', async () => {
    mockExecuteWebhookWorkflow.mockRejectedValueOnce(new Error('dispatcher boom'))

    const result = await dispatchStripeIntegrationWorkflow(baseWorkflow, baseEvent, baseResources, 'r')

    expect(result.success).toBe(false)
    expect(result.error).toContain('dispatcher boom')
    expect(mockLoggerError).toHaveBeenCalled()
  })

  test('result.duplicate: true → returned in result', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, duplicate: true })
    const result = await dispatchStripeIntegrationWorkflow(baseWorkflow, baseEvent, baseResources, 'r')
    expect(result.duplicate).toBe(true)
  })
})
