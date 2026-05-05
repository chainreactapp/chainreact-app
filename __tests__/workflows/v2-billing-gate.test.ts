/**
 * Contract: PR-V2-BILLING — billing gate inside WorkflowExecutionService.
 *
 * Source: lib/services/workflowExecutionService.ts (executeWorkflow)
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 3).
 *
 * What this file proves:
 *
 *   - v2 calls runBillingGate after session creation, BEFORE any
 *     NodeExecutionService.executeNode invocation.
 *   - testMode passes through to the gate as `isTestMode: true`
 *     (gate short-circuits with `kind: 'skipped'`).
 *   - eventType is `'workflow_execution'` for the route-driven entry path.
 *   - executionSessionId === the v2 session UUID (idempotency key).
 *   - On `insufficient_balance` / `subscription_inactive` /
 *     `billing_unavailable`, v2:
 *       - returns `{ success: false, billingFailed: true, billingOutcome }`
 *       - DOES NOT call `nodeExecutionService.executeNode`
 *       - updates the session row to `status: 'failed'`
 *   - On `ok` / `skipped`, v2 proceeds with execution.
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

jest.mock('@/lib/services/executionHistoryService', () => ({
  executionHistoryService: {
    startExecution: jest.fn().mockResolvedValue('hist-1'),
    completeExecution: jest.fn().mockResolvedValue(undefined),
    pauseExecution: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('@/lib/execution/executionProgressTracker', () => ({
  ExecutionProgressTracker: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
    updateNodeCompleted: jest.fn().mockResolvedValue(undefined),
    updateNodeFailed: jest.fn().mockResolvedValue(undefined),
  })),
}))

jest.mock('@/lib/notifications/errorHandler', () => ({
  notifyWorkflowFailure: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/workflows/errors/classifyExecutionFailure', () => ({
  classifyExecutionFailure: jest.fn().mockResolvedValue(null),
}))

jest.mock('@/lib/workflows/execution/rateLimiter', () => ({
  checkExecutionRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  checkCircuitBreaker: jest.fn().mockResolvedValue({ tripped: false, consecutiveFailures: 0 }),
  pauseWorkflowForCircuitBreaker: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/utils/supabase/server', () => ({
  createSupabaseRouteHandlerClient: jest.fn(),
}))

const mockNodeExecute = jest.fn().mockResolvedValue({ success: true, output: { ran: 'mocked' } })
jest.mock('@/lib/services/nodeExecutionService', () => ({
  NodeExecutionService: jest.fn().mockImplementation(() => ({
    executeNode: mockNodeExecute,
  })),
}))

const mockRunBillingGate = jest.fn()
jest.mock('@/lib/billing/executionBillingGate', () => ({
  runBillingGate: (...args: any[]) => mockRunBillingGate(...args),
}))

import { WorkflowExecutionService } from '@/lib/services/workflowExecutionService'

// ─── Stub supabase ──────────────────────────────────────────────────────

interface InsertCapture {
  payload: any
  returnedRow: any
}

interface UpdateCapture {
  table: string
  payload: any
  filter: Record<string, any>
}

function makeStubSupabase(opts: {
  inserts?: InsertCapture[]
  updates?: UpdateCapture[]
} = {}) {
  const inserts = opts.inserts ?? []
  const updates = opts.updates ?? []

  const builderFor = (table: string) => {
    let pendingFilter: Record<string, any> = {}
    let pendingSelect: string | null = null
    let pendingInsert: any = null
    let pendingUpdate: any = null
    const builder: any = {
      select: (cols?: string) => {
        pendingSelect = cols ?? '*'
        return builder
      },
      insert: (payload: any) => {
        pendingInsert = payload
        return builder
      },
      update: (payload: any) => {
        pendingUpdate = payload
        return builder
      },
      eq: (column: string, value: any) => {
        pendingFilter = { ...pendingFilter, [column]: value }
        if (pendingUpdate) {
          updates.push({ table, payload: pendingUpdate, filter: { ...pendingFilter } })
          pendingUpdate = null
        }
        return builder
      },
      order: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => {
        if (table === 'workflow_execution_sessions' && pendingInsert) {
          const returnedRow = { ...pendingInsert }
          inserts.push({ payload: pendingInsert, returnedRow })
          return { data: returnedRow, error: null }
        }
        return { data: null, error: null }
      },
    }
    builder.then = (resolve: any) => resolve({ data: [], error: null })
    return builder
  }

  return {
    from: (table: string) => builderFor(table),
    inserts,
    updates,
  }
}

const TRIGGER_NODE = {
  id: 'trigger-1',
  type: 'gmail_trigger_new_email',
  position: { x: 0, y: 0 },
  data: { type: 'gmail_trigger_new_email', isTrigger: true, config: {} },
}
const ACTION_NODE = {
  id: 'action-1',
  type: 'gmail_action_send_email',
  position: { x: 0, y: 1 },
  data: { type: 'gmail_action_send_email', isTrigger: false, config: {} },
}

const WORKFLOW_FIXTURE = { id: 'wf-test', workspace_id: null, name: 'billing test' }
const WORKFLOW_DATA = { nodes: [TRIGGER_NODE, ACTION_NODE], edges: [] }

beforeEach(() => {
  mockNodeExecute.mockClear()
  mockRunBillingGate.mockReset()
})

// ─── Gate is invoked with the right inputs ──────────────────────────────

describe('Phase 3 — v2 billing gate plumbing', () => {
  test('gate is called with the v2 session UUID as executionSessionId', async () => {
    mockRunBillingGate.mockResolvedValueOnce({ kind: 'ok', deductionResult: { tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true, resultType: 'deducted' } })
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      {},
      'user-1',
      false, // testMode
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    expect(mockRunBillingGate).toHaveBeenCalledTimes(1)
    const gateInput = mockRunBillingGate.mock.calls[0][0]
    expect(gateInput.executionSessionId).toBe(stub.inserts[0].payload.id)
    expect(gateInput.eventType).toBe('workflow_execution')
    expect(gateInput.isTestMode).toBe(false)
  })

  test('gate is called with action nodes only (triggers filtered out)', async () => {
    mockRunBillingGate.mockResolvedValueOnce({ kind: 'ok', deductionResult: { tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true, resultType: 'deducted' } })
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      {},
      'user-1',
      false,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    const gateInput = mockRunBillingGate.mock.calls[0][0]
    expect(gateInput.actionNodes).toHaveLength(1)
    expect(gateInput.actionNodes[0].id).toBe('action-1')
  })

  test('testMode passes through as isTestMode: true', async () => {
    mockRunBillingGate.mockResolvedValueOnce({ kind: 'skipped', reason: 'test_mode' })
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      {},
      'user-1',
      true, // testMode
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    expect(mockRunBillingGate.mock.calls[0][0].isTestMode).toBe(true)
  })

  test('retry: __retryOf in inputData is forwarded to the gate', async () => {
    // Stub the lineage lookup so resolveRootExecutionId doesn't blow up
    // when retry path is exercised.
    const stub = makeStubSupabase()
    mockRunBillingGate.mockResolvedValueOnce({ kind: 'ok', deductionResult: { tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true, resultType: 'deducted' } })
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      { __retryOf: 'original-session-X' },
      'user-1',
      false,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    expect(mockRunBillingGate.mock.calls[0][0].retryOf).toBe('original-session-X')
  })
})

// ─── Gate failure short-circuits execution ──────────────────────────────

describe('Phase 3 — v2 billing failure short-circuits', () => {
  test('insufficient_balance: returns billingFailed payload, no node executed, session marked failed', async () => {
    mockRunBillingGate.mockResolvedValueOnce({
      kind: 'insufficient_balance',
      tasksNeeded: 5,
      remaining: 0,
      autoBuyTriggered: false,
      error: 'Task limit reached.',
    })
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    const result = await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      {},
      'user-1',
      false,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    expect((result as any).success).toBe(false)
    expect((result as any).billingFailed).toBe(true)
    expect((result as any).billingOutcome.kind).toBe('insufficient_balance')
    expect(mockNodeExecute).not.toHaveBeenCalled()

    const failureUpdate = stub.updates.find(
      (u) => u.table === 'workflow_execution_sessions' && u.payload.status === 'failed',
    )
    expect(failureUpdate).toBeDefined()
    expect(failureUpdate?.payload.error_message).toContain('Task limit reached')
  })

  test('subscription_inactive: same shape, no node executed', async () => {
    mockRunBillingGate.mockResolvedValueOnce({
      kind: 'subscription_inactive',
      error: 'Your subscription is inactive.',
    })
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    const result = await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      {},
      'user-1',
      false,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    expect((result as any).billingFailed).toBe(true)
    expect((result as any).billingOutcome.kind).toBe('subscription_inactive')
    expect(mockNodeExecute).not.toHaveBeenCalled()
  })

  test('billing_unavailable: same shape, no node executed', async () => {
    mockRunBillingGate.mockResolvedValueOnce({
      kind: 'billing_unavailable',
      error: 'Billing system temporarily unavailable. Please retry.',
    })
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    const result = await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      {},
      'user-1',
      false,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    expect((result as any).billingFailed).toBe(true)
    expect((result as any).billingOutcome.kind).toBe('billing_unavailable')
    expect(mockNodeExecute).not.toHaveBeenCalled()
  })

  test('runBillingGate throws → fail-closed billing_unavailable, no execution', async () => {
    mockRunBillingGate.mockRejectedValueOnce(new Error('gate orchestration crash'))
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    const result = await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      {},
      'user-1',
      false,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    expect((result as any).billingFailed).toBe(true)
    expect((result as any).billingOutcome.kind).toBe('billing_unavailable')
    expect(mockNodeExecute).not.toHaveBeenCalled()
  })
})

// ─── Gate ok / skipped → execution proceeds ─────────────────────────────

describe('Phase 3 — v2 billing ok/skipped → execution proceeds', () => {
  test('ok: nodes executed normally', async () => {
    mockRunBillingGate.mockResolvedValueOnce({
      kind: 'ok',
      deductionResult: { tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true, resultType: 'deducted' },
    })
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      {},
      'user-1',
      false,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    expect(mockNodeExecute).toHaveBeenCalled()
  })

  test('skipped (test_mode): nodes executed (sandbox path runs handlers via the engine pre-call gate)', async () => {
    mockRunBillingGate.mockResolvedValueOnce({ kind: 'skipped', reason: 'test_mode' })
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      {},
      'user-1',
      true,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    // testMode runs reach the executor — they're intercepted by the
    // engine pre-call gate at the per-node layer, not by the billing
    // gate. Billing's role is only to skip charging in sandbox.
    expect(mockNodeExecute).toHaveBeenCalled()
  })
})
