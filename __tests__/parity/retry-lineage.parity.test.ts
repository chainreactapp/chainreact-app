/**
 * Phase 4 — v1↔v2 parity test: retry-lineage propagation
 *
 * Scenario: a fresh execution then a retry. Both engines should:
 *   - Fresh run: rootExecutionId === new sessionId
 *   - Retry run: rootExecutionId inherits from original.root_execution_id
 *
 * The rootExecutionId is what the dispatcher uses to compute Q4
 * idempotency keys (`buildIdempotencyKey({ executionSessionId, nodeId,
 * actionType, ... })` reads root). If both engines pass the same root to
 * handlers on retry, Q4 dedupe works equivalently across both engines.
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 4).
 *
 * Reference: PR-R1a + Phase 2 (v2 lineage threading) — both engines
 * resolve root via the shared `lib/execution/sessionLineage.ts` helpers
 * (engine-agnostic, exhaustively tested in
 * __tests__/workflows/engine-create-session-lineage.test.ts).
 */

jest.mock('server-only', () => ({}))
jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('@/lib/logging/backendLogger', () => ({
  logInfo: jest.fn(), logError: jest.fn(), logSuccess: jest.fn(), logWarning: jest.fn(),
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
  sendWorkflowErrorNotifications: jest.fn().mockResolvedValue(undefined),
  extractErrorMessage: (e: any) => (e?.message ?? String(e)),
}))
jest.mock('@/lib/workflows/errors/classifyExecutionFailure', () => ({
  classifyExecutionFailure: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/workflows/execution/rateLimiter', () => ({
  checkExecutionRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  checkCircuitBreaker: jest.fn().mockResolvedValue({ tripped: false, consecutiveFailures: 0 }),
  pauseWorkflowForCircuitBreaker: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/utils/supabase/server', () => ({ createSupabaseRouteHandlerClient: jest.fn() }))
jest.mock('@/lib/billing/executionBillingGate', () => ({
  runBillingGate: jest.fn().mockResolvedValue({
    kind: 'ok',
    deductionResult: { tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true, resultType: 'deducted' },
  }),
}))

interface RootCapture {
  nodeId: string
  rootExecutionId: string | null
  executionId: string | null
}

const v2RootCaptures: RootCapture[] = []
jest.mock('@/lib/services/executionHandlers/integrationHandlers', () => ({
  IntegrationNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation(async (node: any, ctx: any) => {
      v2RootCaptures.push({
        nodeId: node.id,
        rootExecutionId: ctx?.rootExecutionId ?? null,
        executionId: ctx?.executionId ?? null,
      })
      return { success: true, output: { dispatched: true } }
    }),
  })),
}))
jest.mock('@/lib/services/executionHandlers/actionHandlers', () => ({
  ActionNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation(async (node: any, _allNodes: any[], _conns: any[], ctx: any) => {
      v2RootCaptures.push({
        nodeId: node.id,
        rootExecutionId: ctx?.rootExecutionId ?? null,
        executionId: ctx?.executionId ?? null,
      })
      return { success: true, output: { dispatched: true } }
    }),
  })),
}))

const v1RootCaptures: RootCapture[] = []
jest.mock('@/lib/workflows/executeNode', () => ({
  executeAction: jest.fn().mockImplementation(async (params: any) => {
    v1RootCaptures.push({
      nodeId: params.node.id,
      rootExecutionId: params.input?.rootExecutionId ?? null,
      executionId: params.input?.executionId ?? null,
    })
    return { success: true, output: { dispatched: true } }
  }),
}))

interface SessionRow {
  id: string
  workflow_id: string
  user_id: string
  status: string
  root_execution_id: string | null
  workflow_definition_hash: string | null
  input_data: any
  started_at: string
}
const sessionStore: Record<string, SessionRow> = {}
function makeStubSupabase() {
  const builderFor = (table: string) => {
    let pendingFilter: Record<string, any> = {}
    let pendingInsert: any = null
    let pendingUpdate: any = null
    let pendingSelect: string | null = null
    const builder: any = {
      select: (cols?: string) => { pendingSelect = cols ?? '*'; return builder },
      insert: (payload: any) => { pendingInsert = payload; return builder },
      update: (payload: any) => { pendingUpdate = payload; return builder },
      upsert: (payload: any) => { pendingInsert = payload; return builder },
      eq: (column: string, value: any) => {
        pendingFilter = { ...pendingFilter, [column]: value }
        if (pendingUpdate && table === 'workflow_execution_sessions') {
          const id = pendingFilter.id
          if (id && sessionStore[id]) sessionStore[id] = { ...sessionStore[id], ...pendingUpdate }
          pendingUpdate = null
        }
        return builder
      },
      in: () => builder, order: () => builder, gte: () => builder, limit: () => builder,
      maybeSingle: async () => {
        if (table === 'workflow_execution_sessions' && pendingFilter.id) {
          const row = sessionStore[pendingFilter.id]
          if (!row) return { data: null, error: null }
          if (pendingSelect === 'root_execution_id') return { data: { root_execution_id: row.root_execution_id }, error: null }
          return { data: row, error: null }
        }
        return { data: null, error: null }
      },
      single: async () => {
        if (table === 'workflow_execution_sessions') {
          if (pendingInsert) {
            sessionStore[pendingInsert.id] = pendingInsert as SessionRow
            return { data: pendingInsert, error: null }
          }
          if (pendingFilter.id) return { data: sessionStore[pendingFilter.id] ?? null, error: null }
        }
        return { data: null, error: null }
      },
    }
    builder.then = (resolve: any) => resolve({ data: [], error: null })
    return builder
  }
  return { from: (table: string) => builderFor(table) }
}
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeStubSupabase() }))

import { AdvancedExecutionEngine } from '@/lib/execution/advancedExecutionEngine'
import { WorkflowExecutionService } from '@/lib/services/workflowExecutionService'

const TRIGGER_NODE = {
  id: 'trigger-1', type: 'gmail_trigger_new_email',
  position: { x: 0, y: 0 },
  data: { type: 'gmail_trigger_new_email', label: 'T', title: 'T', isTrigger: true, config: {}, providerId: 'gmail' },
}
const ACTION_NODE = {
  id: 'action-1', type: 'slack_action_send_message',
  position: { x: 0, y: 1 },
  data: { type: 'slack_action_send_message', label: 'A', title: 'A', isTrigger: false, config: { channel: '#g' }, providerId: 'slack' },
}
const WORKFLOW_FIXTURE = {
  id: 'wf-retry',
  name: 'retry parity',
  user_id: 'user-1',
  workspace_id: null,
  nodes: [TRIGGER_NODE, ACTION_NODE],
  connections: [{ id: 'e1', source: 'trigger-1', target: 'action-1', sourceHandle: 'source', targetHandle: 'target' }],
}
const WORKFLOW_DATA_V2 = { nodes: WORKFLOW_FIXTURE.nodes, edges: WORKFLOW_FIXTURE.connections }
const TRIGGER_TYPES = new Set(['gmail_trigger_new_email'])

beforeEach(() => {
  v1RootCaptures.length = 0
  v2RootCaptures.length = 0
  for (const k of Object.keys(sessionStore)) delete sessionStore[k]
})

// ─── Fresh-run lineage parity ───────────────────────────────────────────

describe('Phase 4 parity — fresh-run lineage', () => {
  test('v1 fresh run: action receives rootExecutionId === sessionId', async () => {
    const engine = new AdvancedExecutionEngine()
    const session = await engine.createExecutionSession(WORKFLOW_FIXTURE.id, 'user-1', 'manual', { inputData: {} })
    await engine.executeWorkflowAdvanced(session.id, {}, { workflow: WORKFLOW_FIXTURE })

    const actionCapture = v1RootCaptures.find((c) => c.nodeId === 'action-1')
    expect(actionCapture).toBeDefined()
    expect(actionCapture?.rootExecutionId).toBe(session.id)
  })

  test('v2 fresh run: action receives rootExecutionId === sessionId', async () => {
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()
    const result: any = await service.executeWorkflow(
      WORKFLOW_FIXTURE, {}, 'user-1', false, WORKFLOW_DATA_V2, false, undefined, stub as any,
    )
    const sessionId = result?.executionId

    const actionCapture = v2RootCaptures.find((c) => c.nodeId === 'action-1')
    expect(actionCapture).toBeDefined()
    expect(actionCapture?.rootExecutionId).toBe(sessionId)
  })
})

// ─── Retry-run lineage parity ───────────────────────────────────────────

describe('Phase 4 parity — retry-run lineage (root inherits from original)', () => {
  test('v1 retry: action receives rootExecutionId === original.root_execution_id', async () => {
    const engine = new AdvancedExecutionEngine()
    // ── 1. Original run ──
    const original = await engine.createExecutionSession(WORKFLOW_FIXTURE.id, 'user-1', 'manual', { inputData: {} })
    await engine.executeWorkflowAdvanced(original.id, {}, { workflow: WORKFLOW_FIXTURE })

    const originalRoot = sessionStore[original.id].root_execution_id
    expect(originalRoot).toBe(original.id) // fresh run sets root = id

    v1RootCaptures.length = 0 // clear captures for retry leg

    // ── 2. Retry run ──
    const retry = await engine.createExecutionSession(WORKFLOW_FIXTURE.id, 'user-1', 'manual', {
      inputData: {},
      retryOf: original.id,
    })
    await engine.executeWorkflowAdvanced(retry.id, {}, { workflow: WORKFLOW_FIXTURE })

    const retryAction = v1RootCaptures.find((c) => c.nodeId === 'action-1')
    expect(retryAction).toBeDefined()
    expect(retryAction?.rootExecutionId).toBe(originalRoot)
    expect(retryAction?.rootExecutionId).not.toBe(retry.id) // retry session's own id is NOT the root
  })

  test('v2 retry: action receives rootExecutionId === original.root_execution_id', async () => {
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    // ── 1. Original run ──
    const originalResult: any = await service.executeWorkflow(
      WORKFLOW_FIXTURE, {}, 'user-1', false, WORKFLOW_DATA_V2, false, undefined, stub as any,
    )
    const originalId = originalResult?.executionId
    expect(originalId).toBeDefined()
    const originalRoot = sessionStore[originalId].root_execution_id
    expect(originalRoot).toBe(originalId)

    v2RootCaptures.length = 0

    // ── 2. Retry run (retryOf packed via inputData.__retryOf per Phase 2) ──
    const retryResult: any = await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      { __retryOf: originalId },
      'user-1', false, WORKFLOW_DATA_V2, false, undefined, stub as any,
    )
    const retryId = retryResult?.executionId

    const retryAction = v2RootCaptures.find((c) => c.nodeId === 'action-1')
    expect(retryAction).toBeDefined()
    expect(retryAction?.rootExecutionId).toBe(originalRoot)
    expect(retryAction?.rootExecutionId).not.toBe(retryId)
  })

  test('v1 and v2 produce equivalent retry-lineage shape (both inherit original.root)', async () => {
    // ── v1 ──
    const engineV1 = new AdvancedExecutionEngine()
    const v1Original = await engineV1.createExecutionSession(WORKFLOW_FIXTURE.id, 'user-1', 'manual', { inputData: {} })
    await engineV1.executeWorkflowAdvanced(v1Original.id, {}, { workflow: WORKFLOW_FIXTURE })
    const v1OriginalRoot = sessionStore[v1Original.id].root_execution_id

    v1RootCaptures.length = 0

    const v1Retry = await engineV1.createExecutionSession(WORKFLOW_FIXTURE.id, 'user-1', 'manual', {
      inputData: {}, retryOf: v1Original.id,
    })
    await engineV1.executeWorkflowAdvanced(v1Retry.id, {}, { workflow: WORKFLOW_FIXTURE })
    const v1RetryRoot = v1RootCaptures.find((c) => c.nodeId === 'action-1')?.rootExecutionId

    // Reset session store for clean v2 run
    for (const k of Object.keys(sessionStore)) delete sessionStore[k]

    // ── v2 ──
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()
    const v2Original: any = await service.executeWorkflow(
      WORKFLOW_FIXTURE, {}, 'user-1', false, WORKFLOW_DATA_V2, false, undefined, stub as any,
    )
    const v2OriginalRoot = sessionStore[v2Original.executionId].root_execution_id

    v2RootCaptures.length = 0

    const v2Retry: any = await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      { __retryOf: v2Original.executionId },
      'user-1', false, WORKFLOW_DATA_V2, false, undefined, stub as any,
    )
    const v2RetryRoot = v2RootCaptures.find((c) => c.nodeId === 'action-1')?.rootExecutionId

    // ── Assert both engines produce the same lineage shape ──
    expect(v1RetryRoot).toBe(v1OriginalRoot)
    expect(v2RetryRoot).toBe(v2OriginalRoot)
    // Both engines: retry's rootExecutionId === original's root_execution_id,
    // not the retry's own session id. This is the parity invariant for Q4.
  })
})
