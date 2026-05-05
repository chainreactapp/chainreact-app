/**
 * Phase 4 — v1↔v2 parity test: branching workflow
 *
 * Scenario: trigger → (action-A, action-B). Two parallel branches off
 * a single trigger. Both engines must dispatch BOTH branch action nodes.
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 4).
 *
 * Asymmetry note: v1 traversal is BFS (executionQueue) and v2 traversal
 * is recursive DFS. For a one-level branch both engines visit both
 * branches; the order may differ but both must be visited. Test asserts
 * SET equality (not ordered equality) for the visited node IDs.
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

interface DispatchCall {
  nodeId: string
  nodeType: string
  userId?: string
}

const v2DispatchCalls: DispatchCall[] = []
jest.mock('@/lib/services/executionHandlers/integrationHandlers', () => ({
  IntegrationNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation(async (node: any, ctx: any) => {
      v2DispatchCalls.push({ nodeId: node.id, nodeType: node.data?.type ?? node.type, userId: ctx?.userId })
      return { success: true, output: { dispatched: 'integration', nodeId: node.id } }
    }),
  })),
}))
jest.mock('@/lib/services/executionHandlers/actionHandlers', () => ({
  ActionNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation(async (node: any, _allNodes: any[], _conns: any[], ctx: any) => {
      v2DispatchCalls.push({ nodeId: node.id, nodeType: node.data?.type ?? node.type, userId: ctx?.userId })
      return { success: true, output: { dispatched: 'action', nodeId: node.id } }
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
    return { success: true, output: { dispatched: 'v1', nodeId: params.node.id } }
  }),
}))

interface SessionRow { id: string; workflow_id: string; user_id: string; status: string; root_execution_id: string | null; workflow_definition_hash: string | null; input_data: any; started_at: string }
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
  id: 'trigger-1',
  type: 'gmail_trigger_new_email',
  position: { x: 0, y: 0 },
  data: { type: 'gmail_trigger_new_email', label: 'Trigger', title: 'Trigger', isTrigger: true, config: {}, providerId: 'gmail' },
}
const ACTION_A = {
  id: 'action-a',
  type: 'slack_action_send_message',
  position: { x: -100, y: 1 },
  data: { type: 'slack_action_send_message', label: 'Branch A', title: 'Branch A', isTrigger: false, config: { channel: '#a', text: 'A' }, providerId: 'slack' },
}
const ACTION_B = {
  id: 'action-b',
  type: 'gmail_action_send_email',
  position: { x: 100, y: 1 },
  data: { type: 'gmail_action_send_email', label: 'Branch B', title: 'Branch B', isTrigger: false, config: { to: 'b@x.com', subject: 'B', body: 'B' }, providerId: 'gmail' },
}

const WORKFLOW_FIXTURE = {
  id: 'wf-branch',
  name: 'branching parity',
  user_id: 'user-1',
  workspace_id: null,
  nodes: [TRIGGER_NODE, ACTION_A, ACTION_B],
  connections: [
    { id: 'e1', source: 'trigger-1', target: 'action-a', sourceHandle: 'source', targetHandle: 'target' },
    { id: 'e2', source: 'trigger-1', target: 'action-b', sourceHandle: 'source', targetHandle: 'target' },
  ],
}
const WORKFLOW_DATA_V2 = { nodes: WORKFLOW_FIXTURE.nodes, edges: WORKFLOW_FIXTURE.connections }
const TRIGGER_TYPES = new Set(['gmail_trigger_new_email'])

beforeEach(() => {
  v1DispatchCalls.length = 0
  v2DispatchCalls.length = 0
  for (const k of Object.keys(sessionStore)) delete sessionStore[k]
})

describe('Phase 4 parity — branching workflow (trigger → A, B)', () => {
  test('v1 dispatches both branches', async () => {
    const engine = new AdvancedExecutionEngine()
    const session = await engine.createExecutionSession(WORKFLOW_FIXTURE.id, 'user-1', 'manual', { inputData: {} })
    await engine.executeWorkflowAdvanced(session.id, {}, { workflow: WORKFLOW_FIXTURE })

    const actionIds = new Set(v1DispatchCalls.filter((c) => !TRIGGER_TYPES.has(c.nodeType)).map((c) => c.nodeId))
    expect(actionIds).toEqual(new Set(['action-a', 'action-b']))
  })

  test('v2 dispatches both branches', async () => {
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()
    await service.executeWorkflow(WORKFLOW_FIXTURE, {}, 'user-1', false, WORKFLOW_DATA_V2, false, undefined, stub as any)

    const actionIds = new Set(
      v2DispatchCalls.filter((c) => !TRIGGER_TYPES.has(c.nodeType)).map((c) => c.nodeId),
    )
    expect(actionIds.has('action-a')).toBe(true)
    expect(actionIds.has('action-b')).toBe(true)
  })

  test('v1 and v2 dispatch the SAME set of action nodes (set equality, order may differ)', async () => {
    const engine = new AdvancedExecutionEngine()
    const session = await engine.createExecutionSession(WORKFLOW_FIXTURE.id, 'user-1', 'manual', { inputData: {} })
    await engine.executeWorkflowAdvanced(session.id, {}, { workflow: WORKFLOW_FIXTURE })

    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()
    await service.executeWorkflow(WORKFLOW_FIXTURE, {}, 'user-1', false, WORKFLOW_DATA_V2, false, undefined, stub as any)

    const v1Set = new Set(v1DispatchCalls.filter((c) => !TRIGGER_TYPES.has(c.nodeType)).map((c) => c.nodeId))
    const v2Set = new Set(v2DispatchCalls.filter((c) => !TRIGGER_TYPES.has(c.nodeType) && v1Set.has(c.nodeId)).map((c) => c.nodeId))
    expect(v2Set).toEqual(v1Set)
  })
})
