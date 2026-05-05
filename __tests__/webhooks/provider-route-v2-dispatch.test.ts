/**
 * Contract: PR-V2-WEBHOOK-PROVIDER — provider-specific webhook routes
 * (`/api/workflow/[provider]`) dispatch through the unified webhook
 * dispatcher.
 *
 * Source: app/api/workflow/[provider]/route.ts (dispatchProviderWebhook)
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

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }))
jest.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: class {},
}))
jest.mock('@/lib/webhooks/dropboxTriggerHandler', () => ({
  handleDropboxWebhookEvent: jest.fn(),
}))

import { dispatchProviderWebhook } from '@/app/api/workflow/[provider]/route'

const baseWorkflow = { id: 'wf-1', user_id: 'owner-1' }
const baseTriggerNode = { data: { type: 'github_trigger_pull_request_opened' } }
const basePayload = { id: 'evt-789', action: 'opened' }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PR-V2-WEBHOOK-PROVIDER — dispatch contract', () => {
  test('routes through executeWebhookWorkflow with full param set', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, sessionId: 'sess-1' })

    await dispatchProviderWebhook(baseWorkflow, 'github', baseTriggerNode, basePayload, 'req-xyz')

    expect(mockExecuteWebhookWorkflow).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      userId: 'owner-1',
      provider: 'github',
      triggerType: 'github_trigger_pull_request_opened',
      triggerData: basePayload,
      metadata: {
        requestId: 'req-xyz',
        providerId: 'github',
      },
      dedupeKey: 'req-xyz',
    })
  })

  test('AdvancedExecutionEngine is NOT instantiated', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })
    await dispatchProviderWebhook(baseWorkflow, 'github', baseTriggerNode, basePayload, 'r')
    expect(mockAdvancedEngineCtor).not.toHaveBeenCalled()
  })

  test('falls back to ${provider}_webhook trigger type when triggerNode.data.type is missing', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })
    await dispatchProviderWebhook(baseWorkflow, 'mailchimp', { data: {} }, basePayload, 'r')
    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].triggerType).toBe('mailchimp_webhook')
  })

  test('different requestIds produce different dedupeKeys', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })
    await dispatchProviderWebhook(baseWorkflow, 'github', baseTriggerNode, basePayload, 'req-A')
    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].dedupeKey).toBe('req-A')
  })
})

describe('PR-V2-WEBHOOK-PROVIDER — error handling', () => {
  test('result.success: true → returns success', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, sessionId: 'sess-1', duplicate: false })

    const result = await dispatchProviderWebhook(baseWorkflow, 'github', baseTriggerNode, basePayload, 'r')

    expect(result).toEqual({ success: true, sessionId: 'sess-1', duplicate: false })
  })

  test('result.success: false → returns failure shape', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: false, error: 'billing rejected' })

    const result = await dispatchProviderWebhook(baseWorkflow, 'github', baseTriggerNode, basePayload, 'r')

    expect(result).toEqual({ success: false, error: 'billing rejected' })
  })

  test('executeWebhookWorkflow throws → caught, returns failure', async () => {
    mockExecuteWebhookWorkflow.mockRejectedValueOnce(new Error('dispatcher boom'))

    const result = await dispatchProviderWebhook(baseWorkflow, 'github', baseTriggerNode, basePayload, 'r')

    expect(result.success).toBe(false)
    expect(result.error).toContain('dispatcher boom')
  })

  test('result.duplicate: true → returned in result', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, duplicate: true })
    const result = await dispatchProviderWebhook(baseWorkflow, 'github', baseTriggerNode, basePayload, 'r')
    expect(result.duplicate).toBe(true)
  })
})
