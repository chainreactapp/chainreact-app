/**
 * Contract: PR-V2-BILLING — runBillingGate helper.
 *
 * Source: lib/billing/executionBillingGate.ts
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 3).
 *
 * What this file proves:
 *   - test mode → `kind: 'skipped', reason: 'test_mode'`, no DB hit
 *   - empty action nodes → `kind: 'skipped', reason: 'no_action_nodes'`,
 *     no DB hit
 *   - successful deduction → `kind: 'ok'`
 *   - idempotent replay → `kind: 'ok'` (already authorized)
 *   - insufficient balance with TASK_PACKS on → `insufficient_balance`,
 *     auto-buy fired, `autoBuyTriggered: true`
 *   - insufficient balance with TASK_PACKS off → `insufficient_balance`,
 *     no auto-buy, `autoBuyTriggered: false`
 *   - subscription_inactive → mapped to `kind: 'subscription_inactive'`
 *   - billing_unavailable → mapped to `kind: 'billing_unavailable'`
 *   - deduct throws → `kind: 'billing_unavailable'` (fail-closed)
 *   - eventType is forwarded to deductTasksAtomic options
 *   - retryOf is forwarded as metadata (`is_retry: true`)
 */

jest.mock('server-only', () => ({}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

const mockResolveBillingScope = jest.fn().mockReturnValue({ scopeType: 'user', scopeId: 'user-1' })
jest.mock('@/lib/billing/resolveBillingScope', () => ({
  resolveBillingScope: (...args: any[]) => mockResolveBillingScope(...args),
}))

const mockScopeToBillingUser = jest.fn().mockResolvedValue('user-1')
jest.mock('@/lib/billing/scopeToBillingUser', () => ({
  scopeToBillingUser: (...args: any[]) => mockScopeToBillingUser(...args),
}))

const mockDeductTasksAtomic = jest.fn()
jest.mock('@/lib/workflows/taskDeduction', () => ({
  deductTasksAtomic: (...args: any[]) => mockDeductTasksAtomic(...args),
}))

const mockTriggerAutoBuy = jest.fn().mockResolvedValue({ ok: true, newBalance: 100 })
jest.mock('@/lib/billing/auto-buy', () => ({
  triggerAutoBuyIfEnabled: (...args: any[]) => mockTriggerAutoBuy(...args),
}))

// FEATURE_FLAGS is read inside the helper via dynamic import. Use a
// dynamic-mock variable so each test can flip the flag without re-importing.
let mockFeatureFlags: { TASK_PACKS: boolean; LOOP_COST_EXPANSION: boolean; OVERAGE_BILLING: boolean; RESUME_FROM_FAILED_NODE: boolean; V2_LIVE_EXECUTION: boolean } = {
  TASK_PACKS: false,
  LOOP_COST_EXPANSION: false,
  OVERAGE_BILLING: false,
  RESUME_FROM_FAILED_NODE: false,
  V2_LIVE_EXECUTION: false,
}
jest.mock('@/lib/featureFlags', () => ({
  get FEATURE_FLAGS() {
    return mockFeatureFlags
  },
}))

import { runBillingGate, type BillingGateInput } from '@/lib/billing/executionBillingGate'

const baseInput = (overrides: Partial<BillingGateInput> = {}): BillingGateInput => ({
  workflow: { id: 'wf-1', user_id: 'owner-1' },
  actionNodes: [{ id: 'action-1', data: { type: 'gmail_action_send_email' } }],
  edges: [],
  executionSessionId: 'exec-1',
  isTestMode: false,
  eventType: 'workflow_execution',
  ...overrides,
})

beforeEach(() => {
  mockResolveBillingScope.mockClear().mockReturnValue({ scopeType: 'user', scopeId: 'user-1' })
  mockScopeToBillingUser.mockClear().mockResolvedValue('user-1')
  mockDeductTasksAtomic.mockClear()
  mockTriggerAutoBuy.mockClear().mockResolvedValue({ ok: true, newBalance: 100 })
  mockFeatureFlags = {
    TASK_PACKS: false,
    LOOP_COST_EXPANSION: false,
    OVERAGE_BILLING: false,
    RESUME_FROM_FAILED_NODE: false,
    V2_LIVE_EXECUTION: false,
  }
})

// ─── Skip paths ─────────────────────────────────────────────────────────

describe('runBillingGate — skip paths', () => {
  test('test mode → skipped(test_mode), no deduct call', async () => {
    const outcome = await runBillingGate(baseInput({ isTestMode: true }))
    expect(outcome).toEqual({ kind: 'skipped', reason: 'test_mode' })
    expect(mockDeductTasksAtomic).not.toHaveBeenCalled()
    expect(mockResolveBillingScope).not.toHaveBeenCalled()
  })

  test('empty action nodes → skipped(no_action_nodes), no deduct call', async () => {
    const outcome = await runBillingGate(baseInput({ actionNodes: [] }))
    expect(outcome).toEqual({ kind: 'skipped', reason: 'no_action_nodes' })
    expect(mockDeductTasksAtomic).not.toHaveBeenCalled()
  })
})

// ─── Success paths ──────────────────────────────────────────────────────

describe('runBillingGate — success paths', () => {
  test('deducted → ok with deductionResult passed through', async () => {
    const stubResult = {
      tasksDeducted: 5,
      newBalance: 95,
      breakdown: { 'gmail_action_send_email': 1 },
      applied: true,
      resultType: 'deducted' as const,
    }
    mockDeductTasksAtomic.mockResolvedValueOnce(stubResult)

    const outcome = await runBillingGate(baseInput())

    expect(outcome).toEqual({ kind: 'ok', deductionResult: stubResult })
  })

  test('idempotent_replay → ok (already authorized)', async () => {
    const stubResult = {
      tasksDeducted: 5,
      newBalance: 95,
      breakdown: {},
      applied: false,
      resultType: 'idempotent_replay' as const,
    }
    mockDeductTasksAtomic.mockResolvedValueOnce(stubResult)

    const outcome = await runBillingGate(baseInput())

    expect(outcome.kind).toBe('ok')
  })
})

// ─── Insufficient balance paths ─────────────────────────────────────────

describe('runBillingGate — insufficient_balance', () => {
  test('TASK_PACKS off → insufficient_balance, no auto-buy', async () => {
    mockFeatureFlags.TASK_PACKS = false
    mockDeductTasksAtomic.mockResolvedValueOnce({
      tasksDeducted: 5,
      newBalance: 0,
      breakdown: {},
      applied: false,
      resultType: 'insufficient_balance',
      error: 'Task limit reached.',
    })

    const outcome = await runBillingGate(baseInput())

    expect(outcome.kind).toBe('insufficient_balance')
    if (outcome.kind === 'insufficient_balance') {
      expect(outcome.tasksNeeded).toBe(5)
      expect(outcome.remaining).toBe(0)
      expect(outcome.autoBuyTriggered).toBe(false)
      expect(outcome.error).toBe('Task limit reached.')
    }
    expect(mockTriggerAutoBuy).not.toHaveBeenCalled()
  })

  test('TASK_PACKS on → insufficient_balance, auto-buy fired (fire-and-forget)', async () => {
    mockFeatureFlags.TASK_PACKS = true
    mockDeductTasksAtomic.mockResolvedValueOnce({
      tasksDeducted: 5,
      newBalance: 0,
      breakdown: {},
      applied: false,
      resultType: 'insufficient_balance',
      error: 'Task limit reached.',
    })

    const outcome = await runBillingGate(baseInput())

    expect(outcome.kind).toBe('insufficient_balance')
    if (outcome.kind === 'insufficient_balance') {
      expect(outcome.autoBuyTriggered).toBe(true)
    }
    expect(mockTriggerAutoBuy).toHaveBeenCalledTimes(1)
    expect(mockTriggerAutoBuy).toHaveBeenCalledWith('user-1')
  })
})

// ─── Other failure paths ────────────────────────────────────────────────

describe('runBillingGate — subscription_inactive / billing_unavailable', () => {
  test('subscription_inactive → mapped to kind:subscription_inactive', async () => {
    mockDeductTasksAtomic.mockResolvedValueOnce({
      tasksDeducted: 0,
      newBalance: 0,
      breakdown: {},
      applied: false,
      resultType: 'subscription_inactive',
      error: 'Your subscription is inactive.',
    })

    const outcome = await runBillingGate(baseInput())

    expect(outcome.kind).toBe('subscription_inactive')
    if (outcome.kind === 'subscription_inactive') {
      expect(outcome.error).toBe('Your subscription is inactive.')
    }
  })

  test('billing_unavailable → mapped to kind:billing_unavailable', async () => {
    mockDeductTasksAtomic.mockResolvedValueOnce({
      tasksDeducted: 0,
      newBalance: null,
      breakdown: {},
      applied: false,
      resultType: 'billing_unavailable',
      error: 'Billing system temporarily unavailable. Please retry.',
    })

    const outcome = await runBillingGate(baseInput())

    expect(outcome.kind).toBe('billing_unavailable')
  })

  test('deduct throws → fail-closed billing_unavailable', async () => {
    mockDeductTasksAtomic.mockRejectedValueOnce(new Error('network blip'))

    const outcome = await runBillingGate(baseInput())

    expect(outcome.kind).toBe('billing_unavailable')
  })
})

// ─── Plumbing — eventType / retryOf ─────────────────────────────────────

describe('runBillingGate — plumbing forwards to deductTasksAtomic', () => {
  test('eventType is forwarded into deduct options', async () => {
    mockDeductTasksAtomic.mockResolvedValueOnce({
      tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true,
      resultType: 'deducted',
    })

    await runBillingGate(baseInput({ eventType: 'workflow_execution_resume' }))

    const call = mockDeductTasksAtomic.mock.calls[0]
    const optionsArg = call[5] // (userId, nodes, edges, sessionId, isTestMode, options)
    expect(optionsArg.eventType).toBe('workflow_execution_resume')
  })

  test('retryOf is forwarded as metadata.is_retry + original_execution_id', async () => {
    mockDeductTasksAtomic.mockResolvedValueOnce({
      tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true,
      resultType: 'deducted',
    })

    await runBillingGate(baseInput({ retryOf: 'original-session-1' }))

    const call = mockDeductTasksAtomic.mock.calls[0]
    const optionsArg = call[5]
    expect(optionsArg.metadata).toEqual({
      is_retry: true,
      original_execution_id: 'original-session-1',
    })
    expect(optionsArg.source).toBe('retry')
  })

  test('no retryOf → metadata empty, source = "execution"', async () => {
    mockDeductTasksAtomic.mockResolvedValueOnce({
      tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true,
      resultType: 'deducted',
    })

    await runBillingGate(baseInput())

    const optionsArg = mockDeductTasksAtomic.mock.calls[0][5]
    expect(optionsArg.metadata).toEqual({})
    expect(optionsArg.source).toBe('execution')
  })

  test('executionSessionId is the deduct idempotency key', async () => {
    mockDeductTasksAtomic.mockResolvedValueOnce({
      tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true,
      resultType: 'deducted',
    })

    await runBillingGate(baseInput({ executionSessionId: 'session-uuid-X' }))

    const sessionArg = mockDeductTasksAtomic.mock.calls[0][3]
    expect(sessionArg).toBe('session-uuid-X')
  })

  test('billing-scope resolution is invoked with the workflow row', async () => {
    mockDeductTasksAtomic.mockResolvedValueOnce({
      tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true,
      resultType: 'deducted',
    })

    await runBillingGate(baseInput({ workflow: { id: 'wf-Y', user_id: 'owner-Y' } }))

    expect(mockResolveBillingScope).toHaveBeenCalledWith({ id: 'wf-Y', user_id: 'owner-Y' })
  })
})
