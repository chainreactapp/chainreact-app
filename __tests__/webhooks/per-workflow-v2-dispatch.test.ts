/**
 * Contract: PR-V2-WEBHOOK-PER-WORKFLOW — per-workflow webhook routes
 * (`/api/workflow-webhooks/[workflowId]`) dispatch through the unified
 * webhook dispatcher.
 *
 * Source: app/api/workflow-webhooks/[workflowId]/route.ts
 *   (dispatchPerWorkflowWebhook)
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
  NextResponse: class {},
  after: jest.fn(),
}))
jest.mock('@/lib/webhooks/webhookManager', () => ({ webhookManager: {} }))
jest.mock('@/lib/utils/rate-limit', () => ({
  checkRateLimit: jest.fn(),
  RateLimitPresets: { webhook: {} },
}))

import { dispatchPerWorkflowWebhook } from '@/app/api/workflow-webhooks/[workflowId]/route'

const baseWorkflow = { id: 'wf-1', user_id: 'owner-1' }
const basePayload = { id: 'evt-789', type: 'order.created', data: { orderId: 'ord-1' } }
const baseHeaders = { 'content-type': 'application/json', 'x-some-header': 'value' }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PR-V2-WEBHOOK-PER-WORKFLOW — dispatch contract', () => {
  test('routes through executeWebhookWorkflow with full param set', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, sessionId: 'sess-1' })

    await dispatchPerWorkflowWebhook(baseWorkflow, basePayload, baseHeaders)

    expect(mockExecuteWebhookWorkflow).toHaveBeenCalledTimes(1)
    expect(mockExecuteWebhookWorkflow).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      userId: 'owner-1',
      provider: 'webhook',
      triggerType: 'workflow_webhook',
      triggerData: basePayload,
      metadata: {
        webhookHeaders: baseHeaders,
      },
    })
  })

  test('AdvancedExecutionEngine is NOT instantiated', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })
    await dispatchPerWorkflowWebhook(baseWorkflow, basePayload, baseHeaders)
    expect(mockAdvancedEngineCtor).not.toHaveBeenCalled()
  })

  test('passes payload as-is (dispatcher auto-derives dedupeKey from payload.id)', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })
    await dispatchPerWorkflowWebhook(baseWorkflow, { id: 'event-abc' }, {})
    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].triggerData).toEqual({ id: 'event-abc' })
    // Helper does not pass an explicit dedupeKey — the dispatcher
    // auto-derives one from triggerData.id.
    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].dedupeKey).toBeUndefined()
  })
})

describe('PR-V2-WEBHOOK-PER-WORKFLOW — error handling', () => {
  test('result.success: true → returns success', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, sessionId: 'sess-1' })

    const result = await dispatchPerWorkflowWebhook(baseWorkflow, basePayload, baseHeaders)

    expect(result.success).toBe(true)
    expect(result.sessionId).toBe('sess-1')
    expect(mockLoggerInfo).toHaveBeenCalled()
  })

  test('result.success: false → logs error, returns failure shape', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: false, error: 'billing rejected' })

    const result = await dispatchPerWorkflowWebhook(baseWorkflow, basePayload, baseHeaders)

    expect(result).toEqual({ success: false, error: 'billing rejected' })
    expect(mockLoggerError).toHaveBeenCalled()
  })

  test('executeWebhookWorkflow throws → caught, returns failure', async () => {
    mockExecuteWebhookWorkflow.mockRejectedValueOnce(new Error('dispatcher boom'))

    const result = await dispatchPerWorkflowWebhook(baseWorkflow, basePayload, baseHeaders)

    expect(result.success).toBe(false)
    expect(result.error).toContain('dispatcher boom')
    expect(mockLoggerError).toHaveBeenCalled()
  })

  test('result.duplicate: true → returned in result', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, duplicate: true })
    const result = await dispatchPerWorkflowWebhook(baseWorkflow, basePayload, baseHeaders)
    expect(result.duplicate).toBe(true)
  })
})
