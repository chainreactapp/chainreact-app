/**
 * Phase 4 — v1↔v2 parity test: linear single-action workflow
 *
 * Scenario: trigger → action. Both engines should dispatch exactly one
 * action handler call with equivalent (nodeId, nodeType, userId).
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 4 —
 * parity tests).
 *
 * Comparison level (audit decision):
 *   - v1 dispatch is `executeAction({ node, input, userId, workflowId, ...})`
 *     from lib/workflows/executeNode.ts. Called once per ACTION node;
 *     trigger handling is separate.
 *   - v2 dispatch is the per-handler-class `execute` method on
 *     IntegrationNodeHandlers / ActionNodeHandlers. NodeExecutionService
 *     traverses the graph and calls these per node.
 *   - Both eventually call the same handler modules. Parity test asserts
 *     the action-layer call shape, not the SDK boundary — equivalent
 *     dispatch implies equivalent handler behavior.
 *
 * Accepted asymmetries (per plan §Resolved decisions):
 *   - v1 doesn't write execution_steps; v2 does. Asymmetric, accepted.
 *   - v1 doesn't compute error_classification; v2 does. Asymmetric.
 *   - v1's dispatch trace contains action-only calls (triggers go through
 *     a separate executeNode path that hits the action registry only via
 *     `is_trigger=true` checks downstream); v2's IntegrationNodeHandlers
 *     dispatch is called for triggers too via the registry-fallback path.
 *     We filter both traces to non-trigger node types before comparing.
 *   - Config equality is NOT asserted: v2 strictly pre-resolves
 *     `{{...}}` references before dispatch (Q2 contract); v1 resolves
 *     inside `executeAction`. So v2's dispatched config may have resolved
 *     literals while v1's still has templates. Tests compare structural
 *     equivalence (which nodes ran, in what order), not resolved values.
 */

jest.mock('server-only', () => ({}))

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

jest.mock('@/lib/logging/backendLogger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logSuccess: jest.fn(),
  logWarning: jest.fn(),
}))

// ─── v2 dependencies ────────────────────────────────────────────────────

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

const mockRunBillingGate = jest.fn().mockResolvedValue({
  kind: 'ok',
  deductionResult: { tasksDeducted: 1, newBalance: 99, breakdown: {}, applied: true, resultType: 'deducted' },
})
jest.mock('@/lib/billing/executionBillingGate', () => ({
  runBillingGate: (...args: any[]) => mockRunBillingGate(...args),
}))

// ─── Capture v2 dispatch — at the handler-class boundary ────────────────
//
// NodeExecutionService traverses the graph; we mock the per-node dispatch
// targets it calls (IntegrationNodeHandlers.execute / ActionNodeHandlers.execute)
// so the traversal logic is exercised end-to-end while we record what each
// node would have asked the dispatcher to do.

interface DispatchCall {
  nodeId: string
  nodeType: string
  userId?: string
  config: any
}

const v2DispatchCalls: DispatchCall[] = []

jest.mock('@/lib/services/executionHandlers/integrationHandlers', () => ({
  IntegrationNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation(async (node: any, ctx: any) => {
      v2DispatchCalls.push({
        nodeId: node.id,
        nodeType: node.data?.type ?? node.type,
        userId: ctx?.userId,
        config: node.data?.config ?? {},
      })
      return { success: true, output: { dispatched: 'integration', nodeId: node.id } }
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
        config: node.data?.config ?? {},
      })
      return { success: true, output: { dispatched: 'action', nodeId: node.id } }
    }),
  })),
}))

// ─── Capture v1 dispatch ────────────────────────────────────────────────

const v1DispatchCalls: DispatchCall[] = []
jest.mock('@/lib/workflows/executeNode', () => ({
  executeAction: jest.fn().mockImplementation(async (params: any) => {
    v1DispatchCalls.push({
      nodeId: params.node.id,
      nodeType: params.node.data?.type ?? params.node.type,
      userId: params.userId,
      config: params.node.data?.config ?? {},
    })
    return { success: true, output: { dispatched: 'v1', nodeId: params.node.id } }
  }),
}))

// ─── Shared in-memory session store, used by v1's createAdminClient + v2's injected client ──

interface SessionRow {
  id: string
  workflow_id: string
  user_id: string
  status: string
  root_execution_id: string | null
  workflow_definition_hash: string | null
  input_data: any
  execution_context?: any
  session_type?: string
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
      upsert: (payload: any) => {
        pendingInsert = payload
        return builder
      },
      eq: (column: string, value: any) => {
        pendingFilter = { ...pendingFilter, [column]: value }
        if (pendingUpdate && table === 'workflow_execution_sessions') {
          const id = pendingFilter.id
          if (id && sessionStore[id]) {
            sessionStore[id] = { ...sessionStore[id], ...pendingUpdate }
          }
          pendingUpdate = null
        }
        return builder
      },
      in: () => builder,
      order: () => builder,
      gte: () => builder,
      limit: () => builder,
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
          if (pendingFilter.id) {
            return { data: sessionStore[pendingFilter.id] ?? null, error: null }
          }
        }
        return { data: null, error: null }
      },
    }
    builder.then = (resolve: any) => resolve({ data: [], error: null })
    return builder
  }

  return { from: (table: string) => builderFor(table) }
}

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeStubSupabase(),
}))

// ─── Imports ────────────────────────────────────────────────────────────

import { AdvancedExecutionEngine } from '@/lib/execution/advancedExecutionEngine'
import { WorkflowExecutionService } from '@/lib/services/workflowExecutionService'

// ─── Workflow fixture ───────────────────────────────────────────────────

const TRIGGER_NODE = {
  id: 'trigger-1',
  type: 'gmail_trigger_new_email',
  position: { x: 0, y: 0 },
  data: {
    type: 'gmail_trigger_new_email',
    label: 'New email',
    title: 'New email',
    isTrigger: true,
    config: { from: 'alice@example.com' },
    providerId: 'gmail',
  },
}

const ACTION_NODE = {
  id: 'action-1',
  type: 'slack_action_send_message',
  position: { x: 0, y: 1 },
  data: {
    type: 'slack_action_send_message',
    label: 'Send Slack message',
    title: 'Send Slack message',
    isTrigger: false,
    config: { channel: '#general', text: 'Hello world' },
    providerId: 'slack',
  },
}

const WORKFLOW_FIXTURE = {
  id: 'wf-parity-1',
  name: 'parity test workflow',
  user_id: 'user-1',
  workspace_id: null,
  nodes: [TRIGGER_NODE, ACTION_NODE],
  connections: [{ id: 'e1', source: 'trigger-1', target: 'action-1', sourceHandle: 'source', targetHandle: 'target' }],
}

const WORKFLOW_DATA_V2 = {
  nodes: WORKFLOW_FIXTURE.nodes,
  edges: WORKFLOW_FIXTURE.connections,
}

const INPUT_DATA = { trigger: { from: 'alice@example.com', subject: 'Hello' } }

const TRIGGER_TYPES = new Set(['gmail_trigger_new_email'])

beforeEach(() => {
  v1DispatchCalls.length = 0
  v2DispatchCalls.length = 0
  for (const k of Object.keys(sessionStore)) delete sessionStore[k]
  mockRunBillingGate.mockClear()
})

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Phase 4 parity — linear single-action workflow', () => {
  test('v1 dispatches the action node with expected shape', async () => {
    const engine = new AdvancedExecutionEngine()
    const session = await engine.createExecutionSession(
      WORKFLOW_FIXTURE.id,
      'user-1',
      'manual',
      { inputData: INPUT_DATA },
    )
    await engine.executeWorkflowAdvanced(session.id, INPUT_DATA, { workflow: WORKFLOW_FIXTURE })

    const actionCalls = v1DispatchCalls.filter((c) => !TRIGGER_TYPES.has(c.nodeType))
    expect(actionCalls).toHaveLength(1)
    expect(actionCalls[0]).toMatchObject({
      nodeId: 'action-1',
      nodeType: 'slack_action_send_message',
      userId: 'user-1',
    })
  })

  test('v2 dispatches the action node with expected shape', async () => {
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      INPUT_DATA,
      'user-1',
      false,
      WORKFLOW_DATA_V2,
      false,
      undefined,
      stub as any,
    )

    const actionCalls = v2DispatchCalls.filter((c) => !TRIGGER_TYPES.has(c.nodeType))
    const slackCall = actionCalls.find((c) => c.nodeId === 'action-1')
    expect(slackCall).toBeDefined()
    expect(slackCall).toMatchObject({
      nodeId: 'action-1',
      nodeType: 'slack_action_send_message',
      userId: 'user-1',
    })
  })

  test('v1 and v2 dispatch the SAME action node with the SAME (nodeId, nodeType, userId)', async () => {
    // ── v1 ──
    const engine = new AdvancedExecutionEngine()
    const session = await engine.createExecutionSession(
      WORKFLOW_FIXTURE.id,
      'user-1',
      'manual',
      { inputData: INPUT_DATA },
    )
    await engine.executeWorkflowAdvanced(session.id, INPUT_DATA, { workflow: WORKFLOW_FIXTURE })

    // ── v2 ──
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()
    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      INPUT_DATA,
      'user-1',
      false,
      WORKFLOW_DATA_V2,
      false,
      undefined,
      stub as any,
    )

    const v1Action = v1DispatchCalls.filter((c) => !TRIGGER_TYPES.has(c.nodeType))[0]
    const v2Action = v2DispatchCalls.filter((c) => c.nodeId === 'action-1')[0]

    expect(v1Action).toBeDefined()
    expect(v2Action).toBeDefined()
    expect(v1Action.nodeId).toBe(v2Action.nodeId)
    expect(v1Action.nodeType).toBe(v2Action.nodeType)
    expect(v1Action.userId).toBe(v2Action.userId)
  })
})
