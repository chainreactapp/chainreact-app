/**
 * Contract: Phase 2 of v2 canonical execution engine consolidation —
 * lineage threading. Mirrors PR-R1a on the v2 side so retries through v2
 * dedupe via Q4 (`lib/workflows/actions/core/sessionSideEffects.ts`).
 *
 * Source files exercised:
 *   - lib/services/workflowExecutionService.ts
 *       (executeWorkflow writes lineage columns + populates
 *        ExecutionContext.rootExecutionId)
 *   - lib/services/executionHandlers/integrationHandlers.ts
 *   - lib/services/integrations/gmailIntegrationService.ts
 *   - lib/services/integrations/googleIntegrationService.ts
 *       (all 7 v2 meta-construction sites read context.rootExecutionId)
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 2).
 *
 * What this file proves:
 *
 *   Engine-layer wiring (single integration test through executeWorkflow):
 *     - Fresh v2 run: session row inserted with `id` + `root_execution_id`
 *       both equal to the client-side UUID. `workflow_definition_hash`
 *       is non-null (computed from workflow nodes/edges).
 *     - Retry v2 run (`__retryOf` packed into inputData): session row
 *       inserts with `root_execution_id` inherited from the original
 *       session's lineage root, NOT equal to the new session id.
 *     - `__retryOf` is stripped from `input_data` before persistence
 *       (engine metadata must not leak to handlers).
 *     - `executionContext.rootExecutionId` reflects the resolved root
 *       when handed to `nodeExecutionService.executeNode`.
 *
 *   Meta-construction sites (one test per dispatch site):
 *     - Each site reads context.rootExecutionId into meta.rootExecutionId
 *       so the value flows to handler-level Q4 buildIdempotencyKey.
 *     - Falls back to context.executionId when context.rootExecutionId is
 *       undefined (legacy contexts that build manually without lineage).
 *
 * The pure-function Q4 dedup proof (same root id → same idempotency key
 * → cached replay) lives in __tests__/workflows/sessionSideEffects.test.ts
 * "buildIdempotencyKey — PR-R1a retry lineage". This file proves the v2
 * engine threads the field correctly into that pure-function input.
 */

jest.mock('server-only', () => ({}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
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

// Capture the executionContext that NodeExecutionService.executeNode
// receives so we can assert on lineage fields.
const capturedContexts: any[] = []
const mockNodeExecute = jest.fn().mockImplementation(async (_node, _nodes, _conns, ctx) => {
  capturedContexts.push(ctx)
  return { success: true, output: { ran: 'mocked' } }
})

jest.mock('@/lib/services/nodeExecutionService', () => ({
  NodeExecutionService: jest.fn().mockImplementation(() => ({
    executeNode: mockNodeExecute,
  })),
}))

// ─── Dispatch-target mocks ──────────────────────────────────────────────
//
// These cover the 7 v2 meta-construction sites. Each handler is a top-
// level jest.fn so the dispatcher's dynamic `await import(...)` returns
// the stable mocked module across tests. mockClear() in beforeEach
// resets call history; tests configure return values inline if needed.

const sendOutlookEmail = jest.fn().mockResolvedValue({ success: true, output: { messageId: 'm-1' } })
const createOutlookCalendarEvent = jest.fn().mockResolvedValue({ success: true, output: { eventId: 'oc-1' } })
jest.mock('@/lib/workflows/actions/microsoft-outlook', () => ({
  sendOutlookEmail: (...args: any[]) => sendOutlookEmail(...args),
  createOutlookCalendarEvent: (...args: any[]) => createOutlookCalendarEvent(...args),
}))

const createAirtableRecord = jest.fn().mockResolvedValue({ success: true, output: { id: 'rec-1' } })
jest.mock('@/lib/workflows/actions/airtable/createRecord', () => ({
  createAirtableRecord: (...args: any[]) => createAirtableRecord(...args),
}))

const sendGmailEmail = jest.fn().mockResolvedValue({ success: true, output: { messageId: 'g-1' } })
jest.mock('@/lib/workflows/actions/gmail/sendEmail', () => ({
  sendGmailEmail: (...args: any[]) => sendGmailEmail(...args),
}))

const createGoogleSheetsRow = jest.fn().mockResolvedValue({ success: true, output: { rowId: 'r-1' } })
const readGoogleSheetsData = jest.fn()
const updateGoogleSheetsRow = jest.fn()
const deleteGoogleSheetsRow = jest.fn()
const executeGoogleSheetsUnifiedAction = jest.fn()
const createGoogleSpreadsheet = jest.fn()
jest.mock('@/lib/workflows/actions/googleSheets', () => ({
  createGoogleSheetsRow: (...args: any[]) => createGoogleSheetsRow(...args),
  readGoogleSheetsData: (...args: any[]) => readGoogleSheetsData(...args),
  updateGoogleSheetsRow: (...args: any[]) => updateGoogleSheetsRow(...args),
  deleteGoogleSheetsRow: (...args: any[]) => deleteGoogleSheetsRow(...args),
  executeGoogleSheetsUnifiedAction: (...args: any[]) => executeGoogleSheetsUnifiedAction(...args),
  createGoogleSpreadsheet: (...args: any[]) => createGoogleSpreadsheet(...args),
}))

const createGoogleCalendarEvent = jest.fn().mockResolvedValue({ success: true, output: { eventId: 'e-1' } })
jest.mock('@/lib/workflows/actions/google-calendar/createEvent', () => ({
  createGoogleCalendarEvent: (...args: any[]) => createGoogleCalendarEvent(...args),
}))

const uploadGoogleDriveFile = jest.fn().mockResolvedValue({ success: true, output: { fileId: 'f-1' } })
jest.mock('@/lib/workflows/actions/googleDrive/uploadFile', () => ({
  uploadGoogleDriveFile: (...args: any[]) => uploadGoogleDriveFile(...args),
}))

import { WorkflowExecutionService, type ExecutionContext } from '@/lib/services/workflowExecutionService'
import { IntegrationNodeHandlers } from '@/lib/services/executionHandlers/integrationHandlers'
import { GmailIntegrationService } from '@/lib/services/integrations/gmailIntegrationService'
import { GoogleIntegrationService } from '@/lib/services/integrations/googleIntegrationService'

// ─── Stub supabase ──────────────────────────────────────────────────────
//
// The engine touches:
//   - workflow_execution_sessions: insert (capture payload), select root
//     (for retry lookup), update (status transitions)
//   - workflow_variables: select
//
// We only care about lineage; everything else returns empty/success.

interface InsertCapture {
  payload: any
  returnedRow: any
}

function makeStubSupabase(opts: {
  /** Maps `id` → `root_execution_id` (or `null`). Used by the retry-lookup `.maybeSingle()`. */
  rootByOriginalId?: Record<string, string | null>
  /** Insert capture array. */
  inserts?: InsertCapture[]
} = {}) {
  const inserts = opts.inserts ?? []
  const rootByOriginalId = opts.rootByOriginalId ?? {}

  const builderFor = (table: string) => {
    let pendingFilter: Record<string, any> = {}
    let pendingSelect: string | null = null
    let pendingInsert: any = null
    const builder: any = {
      select: (cols?: string) => {
        pendingSelect = cols ?? '*'
        return builder
      },
      insert: (payload: any) => {
        pendingInsert = payload
        return builder
      },
      update: (_payload: any) => builder,
      eq: (column: string, value: any) => {
        pendingFilter = { ...pendingFilter, [column]: value }
        return builder
      },
      order: () => builder,
      maybeSingle: async () => {
        if (table === 'workflow_execution_sessions' && pendingSelect === 'root_execution_id') {
          const id = pendingFilter.id
          const root = rootByOriginalId[id]
          if (root === undefined) return { data: null, error: null }
          return { data: { root_execution_id: root }, error: null }
        }
        return { data: null, error: null }
      },
      single: async () => {
        if (table === 'workflow_execution_sessions' && pendingInsert) {
          // Simulate the row returned by Postgres after insert: echo
          // every column we wrote, including the engine-supplied `id`.
          const returnedRow = { ...pendingInsert }
          inserts.push({ payload: pendingInsert, returnedRow })
          return { data: returnedRow, error: null }
        }
        return { data: null, error: null }
      },
    }
    // `Promise.all([nodesResult, edgesResult])` on the workflow_nodes /
    // workflow_edges tables — make the builder thenable returning empty.
    builder.then = (resolve: any) => resolve({ data: [], error: null })
    return builder
  }

  return {
    from: (table: string) => builderFor(table),
    inserts,
  }
}

// ─── Minimal workflow fixture ───────────────────────────────────────────
//
// Single trigger-only node so the executor reaches NodeExecutionService
// once and returns. We're testing engine wiring, not graph traversal.

const TRIGGER_NODE = {
  id: 'trigger-1',
  type: 'gmail_trigger_new_email',
  position: { x: 0, y: 0 },
  data: {
    type: 'gmail_trigger_new_email',
    isTrigger: true,
    config: {},
  },
}

const WORKFLOW_FIXTURE = {
  id: 'wf-test',
  workspace_id: null,
  name: 'lineage test workflow',
}

const WORKFLOW_DATA = {
  nodes: [TRIGGER_NODE],
  edges: [],
}

beforeEach(() => {
  capturedContexts.length = 0
  mockNodeExecute.mockClear()
  sendOutlookEmail.mockClear()
  createOutlookCalendarEvent.mockClear()
  createAirtableRecord.mockClear()
  sendGmailEmail.mockClear()
  createGoogleSheetsRow.mockClear()
  readGoogleSheetsData.mockClear()
  updateGoogleSheetsRow.mockClear()
  deleteGoogleSheetsRow.mockClear()
  executeGoogleSheetsUnifiedAction.mockClear()
  createGoogleSpreadsheet.mockClear()
  createGoogleCalendarEvent.mockClear()
  uploadGoogleDriveFile.mockClear()
})

// ═══════════════════════════════════════════════════════════════════════
// Engine-layer wiring through executeWorkflow
// ═══════════════════════════════════════════════════════════════════════

describe('Phase 2 — v2 lineage threading at session creation', () => {
  test('fresh run: session row inserts with root_execution_id === sessionId', async () => {
    const stub = makeStubSupabase()
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      { event: 'sample' },
      'user-1',
      false, // testMode
      WORKFLOW_DATA,
      false, // skipTriggers
      undefined,
      stub as any,
    )

    expect(stub.inserts).toHaveLength(1)
    const insert = stub.inserts[0].payload
    // Client-supplied UUID overrides the DB default `gen_random_uuid()`.
    expect(insert.id).toBeDefined()
    expect(typeof insert.id).toBe('string')
    expect(insert.id).toMatch(/^[0-9a-f-]{36}$/)
    // Fresh run lineage invariant: root === id.
    expect(insert.root_execution_id).toBe(insert.id)
    // Workflow definition hash is non-null when workflow data is present.
    expect(insert.workflow_definition_hash).toBeTruthy()
    expect(typeof insert.workflow_definition_hash).toBe('string')
  })

  test('retry run: __retryOf in inputData inherits root from original session', async () => {
    const ORIGINAL_ID = 'original-session-1'
    const ORIGINAL_ROOT = 'lineage-root-X'
    const stub = makeStubSupabase({
      rootByOriginalId: { [ORIGINAL_ID]: ORIGINAL_ROOT },
    })
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      { event: 'sample', __retryOf: ORIGINAL_ID },
      'user-1',
      false,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    const insert = stub.inserts[0].payload
    // Retry inherits from original.root_execution_id, NOT the new session id.
    expect(insert.root_execution_id).toBe(ORIGINAL_ROOT)
    expect(insert.id).not.toBe(ORIGINAL_ROOT)
  })

  test('retry of a pre-Phase-2 session (root NULL): falls back to retryOf as root', async () => {
    const ORIGINAL_ID = 'pre-phase2-session'
    const stub = makeStubSupabase({
      rootByOriginalId: { [ORIGINAL_ID]: null },
    })
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      { __retryOf: ORIGINAL_ID },
      'user-1',
      false,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    expect(stub.inserts[0].payload.root_execution_id).toBe(ORIGINAL_ID)
  })

  test('__retryOf is stripped from input_data before persistence', async () => {
    const stub = makeStubSupabase({
      rootByOriginalId: { 'original-x': 'root-x' },
    })
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      { event: 'sample', __retryOf: 'original-x', other: 'preserved' },
      'user-1',
      false,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    const persistedInput = stub.inserts[0].payload.input_data
    expect(persistedInput).not.toHaveProperty('__retryOf')
    // Real input fields survive the strip.
    expect(persistedInput.event).toBe('sample')
    expect(persistedInput.other).toBe('preserved')
  })

  test('executionContext handed to nodeExecutionService carries rootExecutionId', async () => {
    const stub = makeStubSupabase({
      rootByOriginalId: { 'original-y': 'root-y' },
    })
    const service = new WorkflowExecutionService()

    await service.executeWorkflow(
      WORKFLOW_FIXTURE,
      { __retryOf: 'original-y' },
      'user-1',
      false,
      WORKFLOW_DATA,
      false,
      undefined,
      stub as any,
    )

    expect(capturedContexts).toHaveLength(1)
    const ctx = capturedContexts[0] as ExecutionContext
    expect(ctx.rootExecutionId).toBe('root-y')
    // executionId is the new session id, distinct from the lineage root.
    expect(ctx.executionId).toBe(stub.inserts[0].payload.id)
    expect(ctx.executionId).not.toBe('root-y')
  })

  test('fresh run: executionContext.rootExecutionId equals executionId', async () => {
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

    const ctx = capturedContexts[0] as ExecutionContext
    expect(ctx.rootExecutionId).toBe(ctx.executionId)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Meta-construction sites — all 7 v2 sites
// ═══════════════════════════════════════════════════════════════════════
//
// Each test calls the dispatcher with a context that has rootExecutionId
// set, then asserts the mocked handler received `meta.rootExecutionId`.

function buildContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    userId: 'user-1',
    workflowId: 'wf-1',
    testMode: false,
    data: {},
    variables: {},
    results: {},
    dataFlowManager: {},
    executionId: 'session-new',
    rootExecutionId: 'lineage-root-A',
    workspaceId: undefined,
    ...overrides,
  } as ExecutionContext
}

describe('Phase 2 — meta-construction sites read context.rootExecutionId', () => {
  test('integrationHandlers.ts: microsoft-outlook_action_send_email meta carries rootExecutionId', async () => {
    const handler = new IntegrationNodeHandlers()
    const node = {
      id: 'outlook-send-1',
      data: { type: 'microsoft-outlook_action_send_email', config: {} },
    }

    await handler.execute(node, buildContext())

    expect(sendOutlookEmail).toHaveBeenCalledTimes(1)
    const meta = sendOutlookEmail.mock.calls[0][3]
    expect(meta.rootExecutionId).toBe('lineage-root-A')
    expect(meta.executionSessionId).toBe('session-new')
  })

  test('integrationHandlers.ts: airtable_action_create_record meta carries rootExecutionId', async () => {
    const handler = new IntegrationNodeHandlers()
    const node = {
      id: 'airtable-1',
      data: { type: 'airtable_action_create_record', config: {} },
    }

    await handler.execute(node, buildContext())

    expect(createAirtableRecord).toHaveBeenCalledTimes(1)
    const meta = createAirtableRecord.mock.calls[0][3]
    expect(meta.rootExecutionId).toBe('lineage-root-A')
  })

  test('gmailIntegrationService: gmail_action_send_email meta carries rootExecutionId', async () => {
    const service = new GmailIntegrationService()
    const node = {
      id: 'gmail-1',
      data: {
        type: 'gmail_action_send_email',
        config: { to: 'a@b.c', subject: 's', body: 'b' },
      },
    }

    await service.execute(node, buildContext())

    expect(sendGmailEmail).toHaveBeenCalledTimes(1)
    // gmail uses the params-object call style: { config, userId, input, meta }
    const params = sendGmailEmail.mock.calls[0][0]
    expect(params.meta.rootExecutionId).toBe('lineage-root-A')
  })

  test('googleIntegrationService: google_sheets_action_append meta carries rootExecutionId', async () => {
    const service = new GoogleIntegrationService()
    const node = {
      id: 'sheets-1',
      data: { type: 'google_sheets_action_append', config: {} },
    }

    await service.execute(node, buildContext())

    expect(createGoogleSheetsRow).toHaveBeenCalledTimes(1)
    const meta = createGoogleSheetsRow.mock.calls[0][3]
    expect(meta.rootExecutionId).toBe('lineage-root-A')
  })

  test('googleIntegrationService: google_calendar_action_create_event meta carries rootExecutionId', async () => {
    const service = new GoogleIntegrationService()
    const node = {
      id: 'cal-1',
      data: { type: 'google_calendar_action_create_event', config: {} },
    }

    await service.execute(node, buildContext())

    expect(createGoogleCalendarEvent).toHaveBeenCalledTimes(1)
    const meta = createGoogleCalendarEvent.mock.calls[0][3]
    expect(meta.rootExecutionId).toBe('lineage-root-A')
  })

  test('googleIntegrationService: google_drive_create_file meta carries rootExecutionId', async () => {
    const service = new GoogleIntegrationService()
    const node = {
      id: 'drive-1',
      data: { type: 'google_drive_create_file', config: {} },
    }

    await service.execute(node, buildContext())

    expect(uploadGoogleDriveFile).toHaveBeenCalledTimes(1)
    const meta = uploadGoogleDriveFile.mock.calls[0][3]
    expect(meta.rootExecutionId).toBe('lineage-root-A')
  })

  test('googleIntegrationService: google_drive_upload_file meta carries rootExecutionId', async () => {
    const service = new GoogleIntegrationService()
    const node = {
      id: 'drive-2',
      data: { type: 'google_drive_upload_file', config: {} },
    }

    await service.execute(node, buildContext())

    expect(uploadGoogleDriveFile).toHaveBeenCalledTimes(1)
    const meta = uploadGoogleDriveFile.mock.calls[0][3]
    expect(meta.rootExecutionId).toBe('lineage-root-A')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Fallback semantics — legacy contexts without rootExecutionId
// ═══════════════════════════════════════════════════════════════════════

describe('Phase 2 — meta falls back to executionId for legacy contexts', () => {
  test('integrationHandlers.ts (outlook): undefined rootExecutionId falls back to executionId', async () => {
    const handler = new IntegrationNodeHandlers()
    const node = {
      id: 'outlook-2',
      data: { type: 'microsoft-outlook_action_send_email', config: {} },
    }

    // Legacy context — built manually without lineage (e.g., direct
    // unit-test harness).
    await handler.execute(node, buildContext({ rootExecutionId: undefined, executionId: 'session-only' }))

    expect(sendOutlookEmail).toHaveBeenCalledTimes(1)
    const meta = sendOutlookEmail.mock.calls[0][3]
    expect(meta.rootExecutionId).toBe('session-only')
  })

  test('gmailIntegrationService: undefined rootExecutionId falls back to executionId', async () => {
    const service = new GmailIntegrationService()
    const node = {
      id: 'gmail-2',
      data: {
        type: 'gmail_action_send_email',
        config: { to: 'a@b.c', subject: 's', body: 'b' },
      },
    }

    await service.execute(node, buildContext({ rootExecutionId: undefined, executionId: 'session-only-gmail' }))

    expect(sendGmailEmail).toHaveBeenCalledTimes(1)
    const params = sendGmailEmail.mock.calls[0][0]
    expect(params.meta.rootExecutionId).toBe('session-only-gmail')
  })
})
