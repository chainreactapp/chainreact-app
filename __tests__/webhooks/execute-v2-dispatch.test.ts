/**
 * Contract: PR-V2-WEBHOOKS — unified webhook dispatcher routes through
 * v2 (`WorkflowExecutionService`) when both `ENABLE_V2_LIVE_EXECUTION`
 * and the workflow owner's `user_profiles.opt_in_v2_execution` are true.
 *
 * Source: lib/webhooks/execute.ts (executeWebhookWorkflow)
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 3).
 *
 * What this file proves:
 *
 *   Default path (flag off / opt-in off):
 *     - v1 (AdvancedExecutionEngine) runs as before — covered by
 *       existing __tests__/webhooks/execute.test.ts (19 tests).
 *
 *   v2 election:
 *     - Flag on + opt-in true → v2 (WorkflowExecutionService) runs
 *     - Flag on + opt-in false → v1
 *     - Flag off + opt-in true → v1
 *     - Workflow lookup failure → conservative fall-through to v1
 *
 *   eventType plumbing:
 *     - v2 executeWorkflow is called with
 *       `{ billingEventType: 'workflow_execution_webhook', source: 'webhook' }`
 *
 *   Critical rollout guardrail (no-v1-fallback):
 *     - If v2 throws, dispatcher returns the error and does NOT also
 *       try v1. Falls back to v1 would mask v2 bugs and double-execute.
 *     - If v2 returns billingFailed, same — no v1 attempt.
 *
 *   Logging:
 *     - Dispatch decision is logged once with executionMode: 'webhook'
 *       so rollout dashboards can attribute every webhook execution.
 */

jest.mock('server-only', () => ({}))

const mockLoggerInfo = jest.fn()
const mockLoggerWarn = jest.fn()
const mockLoggerError = jest.fn()
jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: (...args: any[]) => mockLoggerInfo(...args),
    warn: (...args: any[]) => mockLoggerWarn(...args),
    error: (...args: any[]) => mockLoggerError(...args),
    debug: jest.fn(),
  },
}))

const mockV1CreateSession = jest.fn().mockResolvedValue({ id: 'v1-session' })
const mockV1Execute = jest.fn().mockResolvedValue({ success: true })
const mockAdvancedEngineCtor = jest.fn().mockImplementation(() => ({
  createExecutionSession: mockV1CreateSession,
  executeWorkflowAdvanced: mockV1Execute,
}))
jest.mock('@/lib/execution/advancedExecutionEngine', () => ({
  AdvancedExecutionEngine: mockAdvancedEngineCtor,
}))

const mockV2Execute = jest.fn()
jest.mock('@/lib/services/workflowExecutionService', () => ({
  WorkflowExecutionService: jest.fn().mockImplementation(() => ({
    executeWorkflow: mockV2Execute,
  })),
}))

// Toggle the FEATURE_FLAGS values per test via this mutable object.
let mockFeatureFlags: any = {
  V2_LIVE_EXECUTION: false,
  TASK_PACKS: false,
  LOOP_COST_EXPANSION: false,
  OVERAGE_BILLING: false,
  RESUME_FROM_FAILED_NODE: false,
}
jest.mock('@/lib/featureFlags', () => ({
  get FEATURE_FLAGS() {
    return mockFeatureFlags
  },
}))

// Toggle workflow + opt-in lookups per test via this mutable object.
let mockLookupOverride: {
  workflow?: any
  optIn?: boolean
  workflowError?: Error | null
  optInError?: Error | null
} = {}

const mockAdminFrom = jest.fn().mockImplementation((table: string) => {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => {
      if (table === 'workflows') {
        if (mockLookupOverride.workflowError) throw mockLookupOverride.workflowError
        // Use `'workflow' in override` so an explicit `null` lookup
        // returns null (workflow not found) instead of being treated
        // as "fall through to default" by `??`.
        const data = 'workflow' in mockLookupOverride
          ? mockLookupOverride.workflow
          : { id: 'wf-1', user_id: 'owner-1', name: 'wf' }
        return { data, error: null }
      }
      if (table === 'user_profiles') {
        if (mockLookupOverride.optInError) throw mockLookupOverride.optInError
        return {
          data: { opt_in_v2_execution: !!mockLookupOverride.optIn },
          error: null,
        }
      }
      return { data: null, error: null }
    },
  }
  return builder
})
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(() => ({ from: mockAdminFrom })),
}))

import { executeWebhookWorkflow, _clearDedupCache } from '@/lib/webhooks/execute'

const baseParams = {
  workflowId: 'wf-1',
  userId: 'owner-1',
  provider: 'shopify',
  triggerType: 'shopify_trigger_new_order',
  triggerData: { orderId: '123' },
}

beforeEach(() => {
  jest.clearAllMocks()
  _clearDedupCache()
  mockFeatureFlags = {
    V2_LIVE_EXECUTION: false,
    TASK_PACKS: false,
    LOOP_COST_EXPANSION: false,
    OVERAGE_BILLING: false,
    RESUME_FROM_FAILED_NODE: false,
  }
  mockLookupOverride = {}
  mockV2Execute.mockReset()
})

// ─── v2 election matrix ─────────────────────────────────────────────────

describe('PR-V2-WEBHOOKS — dispatch matrix', () => {
  test('flag off + opt-in true → v1 (default path)', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = false
    mockLookupOverride.optIn = true

    const result = await executeWebhookWorkflow(baseParams)

    expect(mockAdvancedEngineCtor).toHaveBeenCalled()
    expect(mockV2Execute).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.sessionId).toBe('v1-session')
  })

  test('flag on + opt-in false → v1', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = true
    mockLookupOverride.optIn = false

    await executeWebhookWorkflow(baseParams)

    expect(mockAdvancedEngineCtor).toHaveBeenCalled()
    expect(mockV2Execute).not.toHaveBeenCalled()
  })

  test('flag on + opt-in true → v2', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = true
    mockLookupOverride.optIn = true
    mockV2Execute.mockResolvedValueOnce({
      success: true,
      executionId: 'v2-session-uuid',
    })

    const result = await executeWebhookWorkflow(baseParams)

    expect(mockV2Execute).toHaveBeenCalledTimes(1)
    expect(mockAdvancedEngineCtor).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.sessionId).toBe('v2-session-uuid')
  })

  test('workflow row lookup throws → v1 (conservative fall-through)', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = true
    mockLookupOverride.workflowError = new Error('DB blip')

    await executeWebhookWorkflow(baseParams)

    expect(mockAdvancedEngineCtor).toHaveBeenCalled()
    expect(mockV2Execute).not.toHaveBeenCalled()
  })

  test('workflow row missing entirely → v1 (defensive — needed by v2 service)', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = true
    mockLookupOverride.optIn = true
    mockLookupOverride.workflow = null

    await executeWebhookWorkflow(baseParams)

    expect(mockAdvancedEngineCtor).toHaveBeenCalled()
    expect(mockV2Execute).not.toHaveBeenCalled()
  })
})

// ─── eventType plumbing ─────────────────────────────────────────────────

describe('PR-V2-WEBHOOKS — eventType plumbing', () => {
  test('v2 receives billingEventType: workflow_execution_webhook', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = true
    mockLookupOverride.optIn = true
    mockV2Execute.mockResolvedValueOnce({ success: true, executionId: 'v2-1' })

    await executeWebhookWorkflow(baseParams)

    expect(mockV2Execute).toHaveBeenCalledTimes(1)
    const call = mockV2Execute.mock.calls[0]
    // Position 9 — executionOptions (after workflow, inputData, userId,
    // testMode, workflowData, skipTriggers, testModeConfig, supabase)
    const executionOptions = call[8]
    expect(executionOptions).toEqual({
      billingEventType: 'workflow_execution_webhook',
      source: 'webhook',
    })
  })

  test('v2 receives the trigger data as inputData', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = true
    mockLookupOverride.optIn = true
    mockV2Execute.mockResolvedValueOnce({ success: true, executionId: 'v2-2' })

    await executeWebhookWorkflow({
      ...baseParams,
      triggerData: { orderId: '999', customer: 'alice' },
    })

    const call = mockV2Execute.mock.calls[0]
    expect(call[1]).toEqual({ orderId: '999', customer: 'alice' })
  })

  test('v2 receives testMode: false (webhooks are always live)', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = true
    mockLookupOverride.optIn = true
    mockV2Execute.mockResolvedValueOnce({ success: true, executionId: 'v2-3' })

    await executeWebhookWorkflow(baseParams)

    expect(mockV2Execute.mock.calls[0][3]).toBe(false)
  })
})

// ─── No-v1-fallback guardrail ───────────────────────────────────────────
//
// Critical for staged rollout: once v2 has been elected, the dispatcher
// must NOT also try v1 on failure. Falling back would:
//   1. Mask v2 bugs (Phase 5 stages need that signal visible)
//   2. Double-execute the workflow if v2 partially succeeded
//   3. Double-bill (v1 path runs its own billing gate)

describe('PR-V2-WEBHOOKS — no-v1-fallback guardrail', () => {
  test('v2 throws → returns error, v1 NOT attempted', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = true
    mockLookupOverride.optIn = true
    mockV2Execute.mockRejectedValueOnce(new Error('v2 internal crash'))

    const result = await executeWebhookWorkflow(baseParams)

    expect(result.success).toBe(false)
    expect(result.error).toContain('v2 internal crash')
    // The guardrail: AdvancedExecutionEngine constructor was not called
    // even though v2 failed.
    expect(mockAdvancedEngineCtor).not.toHaveBeenCalled()
    expect(mockV1CreateSession).not.toHaveBeenCalled()
    expect(mockV1Execute).not.toHaveBeenCalled()
  })

  test('v2 returns billingFailed: true → returns error, v1 NOT attempted', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = true
    mockLookupOverride.optIn = true
    mockV2Execute.mockResolvedValueOnce({
      success: false,
      billingFailed: true,
      billingOutcome: {
        kind: 'insufficient_balance',
        tasksNeeded: 5,
        remaining: 0,
        autoBuyTriggered: false,
        error: 'Task limit reached.',
      },
    })

    const result = await executeWebhookWorkflow(baseParams)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Task limit reached')
    expect(mockAdvancedEngineCtor).not.toHaveBeenCalled()
  })

  test('v2 returns success: false (non-billing reason) → returns that, v1 NOT attempted', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = true
    mockLookupOverride.optIn = true
    mockV2Execute.mockResolvedValueOnce({
      success: false,
      executionId: 'v2-failed',
    })

    const result = await executeWebhookWorkflow(baseParams)

    // Whatever v2 said, dispatcher passes it through. No silent retry.
    expect(result.success).toBe(false)
    expect(result.sessionId).toBe('v2-failed')
    expect(mockAdvancedEngineCtor).not.toHaveBeenCalled()
  })
})

// ─── Logging ────────────────────────────────────────────────────────────

describe('PR-V2-WEBHOOKS — dispatch log', () => {
  test('engine dispatch log includes executionMode: webhook + structured fields', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = true
    mockLookupOverride.optIn = true
    mockV2Execute.mockResolvedValueOnce({ success: true, executionId: 'v2-x' })

    await executeWebhookWorkflow(baseParams)

    const dispatchLog = mockLoggerInfo.mock.calls.find(
      (call) => call[0] === '[Webhook Execute] Engine dispatch',
    )
    expect(dispatchLog).toBeDefined()
    expect(dispatchLog?.[1]).toMatchObject({
      workflowId: 'wf-1',
      provider: 'shopify',
      triggerType: 'shopify_trigger_new_order',
      executionEngine: 'v2',
      executionMode: 'webhook',
      v2LiveExecutionEnabled: true,
      userOptedIntoV2Execution: true,
    })
  })

  test('v1 dispatch log shows executionEngine: v1 (default path observability)', async () => {
    mockFeatureFlags.V2_LIVE_EXECUTION = false
    mockLookupOverride.optIn = false

    await executeWebhookWorkflow(baseParams)

    const dispatchLog = mockLoggerInfo.mock.calls.find(
      (call) => call[0] === '[Webhook Execute] Engine dispatch',
    )
    expect(dispatchLog).toBeDefined()
    expect(dispatchLog?.[1].executionEngine).toBe('v1')
    expect(dispatchLog?.[1].v2LiveExecutionEnabled).toBe(false)
    expect(dispatchLog?.[1].userOptedIntoV2Execution).toBe(false)
  })
})
