/**
 * Contract: PR-V2-WEBHOOK-DROPBOX — Dropbox webhook workflows route
 * through the unified webhook dispatcher (executeWebhookWorkflow) instead
 * of instantiating AdvancedExecutionEngine directly.
 *
 * Source: lib/webhooks/dropboxTriggerHandler.ts (dispatchDropboxWorkflow)
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 3 —
 * direct AdvancedExecutionEngine callers).
 *
 * Audit Q4: this entry path was previously listed `Dedup: None`. Now
 * passes dedupeKey = cursor || requestId so retried Dropbox webhook
 * deliveries (or our own retry-on-error logic) don't re-execute.
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
jest.mock('@/lib/security/encryption', () => ({ safeDecrypt: jest.fn() }))

import { dispatchDropboxWorkflow } from '@/lib/webhooks/dropboxTriggerHandler'

const baseWorkflow = { id: 'wf-1', user_id: 'owner-1' }

const basePayload = {
  files: [{ id: 'id:1', name: 'a.txt', pathLower: '/a.txt', pathDisplay: '/A.txt' }],
  accountId: 'acct-123',
  folderPath: '/',
  includeSubfolders: false,
  fileType: 'all',
  rawEntriesCount: 1,
  cursor: 'cursor-abc-123',
}

const baseTriggerNode = { data: { type: 'dropbox_trigger_new_file' } }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PR-V2-WEBHOOK-DROPBOX — dispatch contract', () => {
  test('routes through executeWebhookWorkflow with provider/triggerType/workflowId/userId/triggerData/metadata/dedupeKey', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, sessionId: 'sess-1' })

    await dispatchDropboxWorkflow(baseWorkflow, basePayload as any, baseTriggerNode, 'req-xyz')

    expect(mockExecuteWebhookWorkflow).toHaveBeenCalledTimes(1)
    expect(mockExecuteWebhookWorkflow).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      userId: 'owner-1',
      provider: 'dropbox',
      triggerType: 'dropbox_trigger_new_file',
      triggerData: basePayload,
      metadata: {
        requestId: 'req-xyz',
        accountId: 'acct-123',
        folderPath: '/',
      },
      dedupeKey: 'cursor-abc-123',
    })
  })

  test('AdvancedExecutionEngine is NOT instantiated', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })
    await dispatchDropboxWorkflow(baseWorkflow, basePayload as any, baseTriggerNode, 'r')
    expect(mockAdvancedEngineCtor).not.toHaveBeenCalled()
  })

  test('falls back to dropbox_webhook trigger type when triggerNode.data.type is missing', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })
    await dispatchDropboxWorkflow(baseWorkflow, basePayload as any, { data: {} }, 'r')
    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].triggerType).toBe('dropbox_webhook')
  })
})

describe('PR-V2-WEBHOOK-DROPBOX — dedupeKey fallback chain', () => {
  test('uses cursor when present', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })
    await dispatchDropboxWorkflow(baseWorkflow, basePayload as any, baseTriggerNode, 'r')
    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].dedupeKey).toBe('cursor-abc-123')
  })

  test('falls back to requestId when cursor is missing', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })
    await dispatchDropboxWorkflow(
      baseWorkflow,
      { ...basePayload, cursor: undefined } as any,
      baseTriggerNode,
      'req-fallback',
    )
    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].dedupeKey).toBe('req-fallback')
  })

  test('passes undefined dedupeKey when both cursor and requestId are missing (dispatcher auto-derives)', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })
    await dispatchDropboxWorkflow(
      baseWorkflow,
      { ...basePayload, cursor: undefined } as any,
      baseTriggerNode,
      undefined,
    )
    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].dedupeKey).toBeUndefined()
  })
})

describe('PR-V2-WEBHOOK-DROPBOX — error handling', () => {
  test('result.success: true → returns success and logs', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, sessionId: 'sess-1', duplicate: false })

    const result = await dispatchDropboxWorkflow(baseWorkflow, basePayload as any, baseTriggerNode, 'r')

    expect(result).toEqual({ success: true, sessionId: 'sess-1', duplicate: false })
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('Dropbox workflow execution completed'),
      expect.objectContaining({ workflowId: 'wf-1', sessionId: 'sess-1' }),
    )
  })

  test('result.success: false → returns failure, logs error, does not throw', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: false, error: 'billing rejected' })

    const result = await dispatchDropboxWorkflow(baseWorkflow, basePayload as any, baseTriggerNode, 'r')

    expect(result).toEqual({ success: false, error: 'billing rejected' })
    expect(mockLoggerError).toHaveBeenCalled()
  })

  test('executeWebhookWorkflow throws → caught, logged, returns failure shape', async () => {
    mockExecuteWebhookWorkflow.mockRejectedValueOnce(new Error('dispatcher boom'))

    const result = await dispatchDropboxWorkflow(baseWorkflow, basePayload as any, baseTriggerNode, 'r')

    expect(result.success).toBe(false)
    expect(result.error).toContain('dispatcher boom')
    expect(mockLoggerError).toHaveBeenCalled()
  })

  test('result.duplicate: true → returns duplicate flag', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, duplicate: true })
    const result = await dispatchDropboxWorkflow(baseWorkflow, basePayload as any, baseTriggerNode, 'r')
    expect(result.duplicate).toBe(true)
  })
})
