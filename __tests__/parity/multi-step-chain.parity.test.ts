/**
 * Phase 4 — v1↔v2 parity test: multi-step linear chain
 *
 * Scenario: trigger → action1 → action2. Tests that both engines visit
 * action nodes in the same topological order.
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 4).
 *
 * Asymmetry note: v1 traverses BFS-style (executionQueue) and v2
 * traverses DFS-style (recursive executeNode). For a linear chain both
 * produce identical visit orders. Branching scenarios test divergence
 * behavior separately.
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
jest.mock('@/utils/supabase/server', () => ({
  createSupabaseRouteHandlerClient: jest.fn(),
}))
jest.mock('@/lib/billing/executionBillingGate', () => ({
  runBillingGate: jest.fn().mockResolvedValue({
    kind: 'ok',
    deductionResult: { tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true, resultType: 'deducted' },
  }),
}))

interface DispatchCall {
  nodeId: string
  nodeType: string
  userId?: string
}

const v2DispatchCalls: DispatchCall[] = []
jest.mock('@/lib/services/executionHandlers/integrationHandlers', () => ({
  IntegrationNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation(async (node: any, ctx: any) => {
      v2DispatchCalls.push({
        nodeId: node.id,
        nodeType: node.data?.type ?? node.type,
        userId: ctx?.userId,
      })
      return { success: true, output: { dispatched: 'integration', [`${node.id}_field`]: 'resolved-value' } }
    }),
  })),
}))
jest.mock('@/lib/services/executionHandlers/actionHandlers', () => ({
  ActionNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation(async (node: any, _allNodes: any[], _conns: any[], ctx: any) => {
      v2DispatchCalls.push({
        nodeId: node.id,
        nodeType: node.data?.type ?? node.type,
        userId: ctx?.userId,
      })
      return { success: true, output: { dispatched: 'action', [`${node.id}_field`]: 'resolved-value' } }
    }),
  })),
}))

const v1DispatchCalls: DispatchCall[] = []
jest.mock('@/lib/workflows/executeNode', () => ({
  executeAction: jest.fn().mockImplementation(async (params: any) => {
    v1DispatchCalls.push({
      nodeId: params.node.id,
      nodeType: params.node.data?.type ?? params.node.type,
      userId: params.userId,
    })
    return { success: true, output: { dispatched: 'v1', [`${params.node.id}_field`]: 'resolved-value' } }
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
          if (pendingSelect === 'root_execution_id') {
            return { data: { root_execution_id: row.root_execution_id }, error: null }
          }
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
  id: 'trigger-1',
  type: 'gmail_trigger_new_email',
  position: { x: 0, y: 0 },
  data: {
    type: 'gmail_trigger_new_email',
    label: 'New email', title: 'New email',
    isTrigger: true,
    config: {},
    providerId: 'gmail',
  },
}

const ACTION_1 = {
  id: 'action-1',
  type: 'slack_action_send_message',
  position: { x: 0, y: 1 },
  data: {
    type: 'slack_action_send_message',
    label: 'Send Slack', title: 'Send Slack',
    isTrigger: false,
    config: { channel: '#general', text: 'Hello' },
    providerId: 'slack',
  },
}

const ACTION_2 = {
  id: 'action-2',
  type: 'gmail_action_send_email',
  position: { x: 0, y: 2 },
  data: {
    type: 'gmail_action_send_email',
    label: 'Send email', title: 'Send email',
    isTrigger: false,
    config: { to: 'someone@example.com', subject: 'Reply', body: 'See log' },
    providerId: 'gmail',
  },
}

const WORKFLOW_FIXTURE = {
  id: 'wf-multi-step',
  name: 'multi step parity',
  user_id: 'user-1',
  workspace_id: null,
  nodes: [TRIGGER_NODE, ACTION_1, ACTION_2],
  connections: [
    { id: 'e1', source: 'trigger-1', target: 'action-1', sourceHandle: 'source', targetHandle: 'target' },
    { id: 'e2', source: 'action-1', target: 'action-2', sourceHandle: 'source', targetHandle: 'target' },
  ],
}

const WORKFLOW_DATA_V2 = {
  nodes: WORKFLOW_FIXTURE.nodes,
  edges: WORKFLOW_FIXTURE.connections,
}

const TRIGGER_TYPES = new Set(['gmail_trigger_new_email'])

beforeEach(() => {
  v1DispatchCalls.length = 0
  v2DispatchCalls.length = 0
  for (const k of Object.keys(sessionStore)) delete sessionStore[k]
})

describe('Phase 4 parity — multi-step chain (trigger → action1 → action2)', () => {
  test('v1 dispatches action-1 then action-2 in order', async () => {
    const engine = new AdvancedExecutionEngine()
    const session = await engine.createExecutionSession(WORKFLOW_FIXTURE.id, 'user-1', 'manual', { inputData: {} })
    await engine.executeWorkflowAdvanced(session.id, {}, { workflow: WORKFLOW_FIXTURE })

    const actions = v1DispatchCalls.filter((c) => !TRIGGER_TYPES.has(c.nodeType))
    expect(actions.map((c) => c.nodeId)).toEqual(['action-1', 'action-2'])
  })

  test('v2 dispatches action-1 then action-2 in order', async () => {
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE, {}, 'user-1', false, WORKFLOW_DATA_V2, false, undefined, stub as any,
    )

    const actions = v2DispatchCalls.filter((c) => !TRIGGER_TYPES.has(c.nodeType))
    const ids = actions.map((c) => c.nodeId)
    expect(ids).toContain('action-1')
    expect(ids).toContain('action-2')
    // action-1 must precede action-2 in dispatch order (data dependency)
    expect(ids.indexOf('action-1')).toBeLessThan(ids.indexOf('action-2'))
  })

  test('v1 and v2 visit the same action nodes in the same order', async () => {
    // ── v1 ──
    const engine = new AdvancedExecutionEngine()
    const session = await engine.createExecutionSession(WORKFLOW_FIXTURE.id, 'user-1', 'manual', { inputData: {} })
    await engine.executeWorkflowAdvanced(session.id, {}, { workflow: WORKFLOW_FIXTURE })

    // ── v2 ──
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()
    await service.executeWorkflow(
      WORKFLOW_FIXTURE, {}, 'user-1', false, WORKFLOW_DATA_V2, false, undefined, stub as any,
    )

    const v1Order = v1DispatchCalls
      .filter((c) => !TRIGGER_TYPES.has(c.nodeType))
      .map((c) => c.nodeId)
    const v2ActionOnly = v2DispatchCalls
      .filter((c) => !TRIGGER_TYPES.has(c.nodeType))
      .map((c) => c.nodeId)
    // Filter v2 to action nodes that match v1's set (in case v2 dispatches
    // additional intermediate nodes — should be none for this fixture)
    const v2Order = v2ActionOnly.filter((id) => v1Order.includes(id))

    expect(v2Order).toEqual(v1Order)
  })
})
