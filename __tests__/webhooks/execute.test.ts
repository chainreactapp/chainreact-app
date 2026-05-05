/**
 * Shared Webhook Execution Helper Tests
 *
 * Tests the executeWebhookWorkflow() function that all providers now use.
 *
 * Run: npx jest __tests__/webhooks/execute.test.ts --verbose
 */

jest.mock('server-only', () => ({}))

const mockCreateSession = jest.fn().mockResolvedValue({ id: 'session-1' })
const mockExecuteWorkflow = jest.fn().mockResolvedValue({ success: true })

jest.mock('@/lib/execution/advancedExecutionEngine', () => ({
  AdvancedExecutionEngine: jest.fn().mockImplementation(() => ({
    createExecutionSession: mockCreateSession,
    executeWorkflowAdvanced: mockExecuteWorkflow,
  })),
}))

// Mock WorkflowExecutionService — existing tests pin v1 default path.
const mockV2Execute = jest.fn()
jest.mock('@/lib/services/workflowExecutionService', () => ({
  WorkflowExecutionService: jest.fn().mockImplementation(() => ({
    executeWorkflow: mockV2Execute,
  })),
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// PR-V2-WEBHOOKS — the dispatcher now looks up workflow row + opt-in
// before deciding v1/v2. These existing tests pin the v1 default path,
// so the lookup mock returns workflow + opt-in:false → v1 dispatch.
const mockAdminFrom = jest.fn().mockImplementation((table: string) => {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => {
      if (table === 'workflows') {
        return { data: { id: 'wf-1', user_id: 'user-1', name: 'test' }, error: null }
      }
      if (table === 'user_profiles') {
        return { data: { opt_in_v2_execution: false }, error: null }
      }
      return { data: null, error: null }
    },
  }
  return builder
})
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(() => ({ from: mockAdminFrom })),
}))

import { executeWebhookWorkflow, _clearDedupCache, _getDedupCacheSize } from '@/lib/webhooks/execute'

beforeEach(() => {
  jest.clearAllMocks()
  _clearDedupCache()
})

describe('executeWebhookWorkflow', () => {
  const baseParams = {
    workflowId: 'wf-1',
    userId: 'user-1',
    provider: 'shopify',
    triggerType: 'shopify_trigger_new_order',
    triggerData: { orderId: '123', total: 99.99 },
  }

  test('creates execution session with correct parameters', async () => {
    await executeWebhookWorkflow(baseParams)

    expect(mockCreateSession).toHaveBeenCalledWith(
      'wf-1',
      'user-1',
      'webhook',
      expect.objectContaining({
        inputData: baseParams.triggerData,
        triggerData: baseParams.triggerData,
        webhookEvent: expect.objectContaining({
          provider: 'shopify',
          triggerType: 'shopify_trigger_new_order',
        }),
      })
    )
  })

  test('executes workflow with trigger data and parallel config', async () => {
    await executeWebhookWorkflow(baseParams)

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      'session-1',
      baseParams.triggerData,
      { enableParallel: true, maxConcurrency: 5 }
    )
  })

  test('returns success with sessionId', async () => {
    const result = await executeWebhookWorkflow(baseParams)

    expect(result.success).toBe(true)
    expect(result.sessionId).toBe('session-1')
    expect(result.error).toBeUndefined()
  })

  test('returns error when session creation fails', async () => {
    mockCreateSession.mockRejectedValueOnce(new Error('DB connection failed'))

    const result = await executeWebhookWorkflow(baseParams)

    expect(result.success).toBe(false)
    expect(result.error).toBe('DB connection failed')
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
  })

  test('returns error when workflow execution fails', async () => {
    mockExecuteWorkflow.mockRejectedValueOnce(new Error('Node execution timeout'))

    const result = await executeWebhookWorkflow(baseParams)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Node execution timeout')
  })

  test('passes metadata in webhookEvent context', async () => {
    await executeWebhookWorkflow({
      ...baseParams,
      metadata: { requestId: 'req-123', topic: 'orders/create' },
    })

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'webhook',
      expect.objectContaining({
        webhookEvent: expect.objectContaining({
          metadata: { requestId: 'req-123', topic: 'orders/create' },
        }),
      })
    )
  })

  test('works with different providers', async () => {
    const providers = [
      { provider: 'hubspot', triggerType: 'hubspot_trigger_contact_created' },
      { provider: 'gumroad', triggerType: 'gumroad_trigger_new_sale' },
      { provider: 'teams', triggerType: 'teams_trigger_new_message' },
      { provider: 'monday', triggerType: 'monday_trigger_new_item' },
      { provider: 'discord', triggerType: 'discord_trigger_new_message' },
      { provider: 'slack', triggerType: 'slack_trigger_new_message' },
    ]

    for (const { provider, triggerType } of providers) {
      jest.clearAllMocks()
      const result = await executeWebhookWorkflow({
        ...baseParams,
        provider,
        triggerType,
      })
      expect(result.success).toBe(true)
      expect(mockCreateSession).toHaveBeenCalledTimes(1)
      expect(mockExecuteWorkflow).toHaveBeenCalledTimes(1)
    }
  })
})

// ─── Deduplication Tests ────────────────────────────────────────────────────

describe('Deduplication', () => {
  const baseParams = {
    workflowId: 'wf-dedup',
    userId: 'user-1',
    provider: 'shopify',
    triggerType: 'shopify_trigger_new_order',
    triggerData: { orderId: 'order-123', total: 99.99 },
  }

  test('first call executes normally', async () => {
    const result = await executeWebhookWorkflow(baseParams)
    expect(result.success).toBe(true)
    expect(result.duplicate).toBeUndefined()
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
  })

  test('second call with same event ID is skipped as duplicate', async () => {
    // First call
    await executeWebhookWorkflow(baseParams)
    expect(mockCreateSession).toHaveBeenCalledTimes(1)

    // Second call (retry from provider)
    jest.clearAllMocks()
    const result = await executeWebhookWorkflow(baseParams)
    expect(result.success).toBe(true)
    expect(result.duplicate).toBe(true)
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  test('different event IDs are NOT deduplicated', async () => {
    await executeWebhookWorkflow({
      ...baseParams,
      triggerData: { orderId: 'order-111' },
    })

    jest.clearAllMocks()
    const result = await executeWebhookWorkflow({
      ...baseParams,
      triggerData: { orderId: 'order-222' },
    })

    expect(result.duplicate).toBeUndefined()
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
  })

  test('same event ID but different workflow is NOT deduplicated', async () => {
    await executeWebhookWorkflow(baseParams)

    jest.clearAllMocks()
    const result = await executeWebhookWorkflow({
      ...baseParams,
      workflowId: 'wf-different',
    })

    expect(result.duplicate).toBeUndefined()
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
  })

  test('explicit dedupeKey takes priority over auto-derived key', async () => {
    await executeWebhookWorkflow({
      ...baseParams,
      dedupeKey: 'custom-key-1',
    })

    jest.clearAllMocks()
    const result = await executeWebhookWorkflow({
      ...baseParams,
      dedupeKey: 'custom-key-1',
    })

    expect(result.duplicate).toBe(true)
  })

  test('skipDedup=true bypasses dedup check', async () => {
    await executeWebhookWorkflow(baseParams)

    jest.clearAllMocks()
    const result = await executeWebhookWorkflow({
      ...baseParams,
      skipDedup: true,
    })

    expect(result.duplicate).toBeUndefined()
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
  })

  test('events without extractable ID skip dedup (no crash)', async () => {
    const params = {
      ...baseParams,
      triggerData: { someField: 'no id here' },
      metadata: undefined,
    }

    const result1 = await executeWebhookWorkflow(params)
    const result2 = await executeWebhookWorkflow(params)

    // Both execute because no dedup key could be derived
    expect(result1.success).toBe(true)
    expect(result2.success).toBe(true)
    expect(mockCreateSession).toHaveBeenCalledTimes(2)
  })

  test('cache cleanup prevents memory leaks', async () => {
    // Fill cache with entries
    for (let i = 0; i < 50; i++) {
      await executeWebhookWorkflow({
        ...baseParams,
        triggerData: { orderId: `order-${i}` },
      })
    }

    expect(_getDedupCacheSize()).toBe(50)

    // Clear and verify
    _clearDedupCache()
    expect(_getDedupCacheSize()).toBe(0)
  })

  test('dedup works across different providers', async () => {
    // Shopify order
    await executeWebhookWorkflow({
      ...baseParams,
      provider: 'shopify',
      triggerData: { orderId: 'shared-id' },
    })

    // HubSpot with different provider but same ID — should NOT dedup
    // because the key includes provider
    jest.clearAllMocks()
    const result = await executeWebhookWorkflow({
      ...baseParams,
      provider: 'hubspot',
      triggerData: { orderId: 'shared-id' },
    })

    // Different provider = different dedup key = executes
    // Actually the key is `workflowId:provider:eventId` so same workflowId
    // but different provider means different key
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
  })

  test('HubSpot objectId is used for dedup', async () => {
    await executeWebhookWorkflow({
      ...baseParams,
      provider: 'hubspot',
      triggerData: { objectId: 12345 },
    })

    jest.clearAllMocks()
    const result = await executeWebhookWorkflow({
      ...baseParams,
      provider: 'hubspot',
      triggerData: { objectId: 12345 },
    })

    expect(result.duplicate).toBe(true)
  })

  test('Discord messageId is used for dedup', async () => {
    await executeWebhookWorkflow({
      ...baseParams,
      provider: 'discord',
      triggerData: { messageId: 'disc-msg-1' },
    })

    jest.clearAllMocks()
    const result = await executeWebhookWorkflow({
      ...baseParams,
      provider: 'discord',
      triggerData: { messageId: 'disc-msg-1' },
    })

    expect(result.duplicate).toBe(true)
  })

  test('Slack client_msg_id is used for dedup', async () => {
    await executeWebhookWorkflow({
      ...baseParams,
      provider: 'slack',
      triggerData: { message: { id: 'slack-msg-1' } },
    })

    jest.clearAllMocks()
    const result = await executeWebhookWorkflow({
      ...baseParams,
      provider: 'slack',
      triggerData: { message: { id: 'slack-msg-1' } },
    })

    expect(result.duplicate).toBe(true)
  })
})
