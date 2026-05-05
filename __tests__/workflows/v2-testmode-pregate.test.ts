/**
 * Contract: PR-V2C-AUDIT — engine-level pre-call gate for testMode safety.
 *
 * Source files exercised:
 *   - lib/services/nodeExecutionService.ts
 *       (executeNode short-circuits external-action dispatch when
 *        context.testMode is true and actionMode !== EXECUTE_ALL)
 *
 * Audit: learning/docs/v2-testmode-audit-findings.md
 *
 * What this file proves (per the audit task brief):
 *
 *   For each of the 7 representative explicit dispatch cases:
 *     - Slack `slack_action_send_message`
 *     - Google Sheets `google_sheets_action_append`
 *     - Discord `discord_action_send_message`
 *     - Airtable `airtable_action_create_record`
 *     - Notion `notion_action_create_page` and `notion_action_manage_database`
 *     - Gmail `gmail_action_send_email`
 *     - Google Calendar `google_calendar_action_create_event`
 *
 *   When the engine receives the node with testMode=true and the default
 *   INTERCEPT_WRITES action mode (or no actionMode at all):
 *     1. The integration / action handler dispatcher is NOT invoked.
 *     2. The returned shape carries the `__testModePreCallGate` marker so
 *        downstream consumers can identify the result as a gate mock.
 *
 *   Plus property tests covering the gate's escape hatches:
 *     - Read-only operations (`isExternalAction` excludes them) still go
 *       through to the dispatcher.
 *     - `EXECUTE_ALL` mode bypasses the gate (the user intentionally
 *       wants real provider calls for live testing).
 *     - Local logic nodes (filter, conditional, variable_set) bypass the
 *       gate (not external; no provider call to block).
 *
 * Pattern: dispatchers are mocked at the constructor level so the test
 * exercises ONLY engine-layer logic without pulling in the full handler /
 * provider import graph.
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
    recordStep: jest.fn().mockResolvedValue(undefined),
    completeStep: jest.fn().mockResolvedValue(undefined),
    pauseStep: jest.fn().mockResolvedValue(undefined),
  },
}))

const mockActionExecute = jest.fn()
const mockIntegrationExecute = jest.fn()
const mockTriggerExecute = jest.fn()

jest.mock('@/lib/services/executionHandlers/actionHandlers', () => ({
  ActionNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: mockActionExecute,
  })),
}))

jest.mock('@/lib/services/executionHandlers/integrationHandlers', () => ({
  IntegrationNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: mockIntegrationExecute,
  })),
}))

jest.mock('@/lib/services/executionHandlers/triggerHandlers', () => ({
  TriggerNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: mockTriggerExecute,
  })),
}))

jest.mock('@/lib/workflows/nodes', () => ({
  ALL_NODE_COMPONENTS: [],
}))

import { NodeExecutionService } from '@/lib/services/nodeExecutionService'
import { createDataFlowManager } from '@/lib/workflows/dataFlowContext'
import { ActionTestMode, TriggerTestMode } from '@/lib/services/testMode/types'
import type { ExecutionContext } from '@/lib/services/workflowExecutionService'

function buildContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const dfm = createDataFlowManager('exec-test', 'wf-test', 'user-test')
  return {
    userId: 'user-test',
    workflowId: 'wf-test',
    testMode: true,
    testModeConfig: {
      triggerMode: TriggerTestMode.USE_MOCK_DATA,
      actionMode: ActionTestMode.INTERCEPT_WRITES,
    },
    data: {},
    variables: {},
    results: {},
    dataFlowManager: dfm,
    ...overrides,
  } as ExecutionContext
}

function nodeOf(type: string, id = 'n1') {
  return {
    id,
    data: {
      type,
      config: {},
    },
  }
}

beforeEach(() => {
  mockActionExecute.mockReset().mockResolvedValue({ success: true, output: { ran: 'action' } })
  mockIntegrationExecute.mockReset().mockResolvedValue({ success: true, output: { ran: 'integration' } })
  mockTriggerExecute.mockReset().mockResolvedValue({ success: true, output: { ran: 'trigger' } })
})

// ─── 7 representative cases — each must NOT call its dispatcher ─────────

describe('Engine pre-call gate — 7 representative cases (audit task list)', () => {
  test('Slack send_message: integrationHandlers NOT invoked, gate marker returned', async () => {
    const service = new NodeExecutionService()
    const node = nodeOf('slack_action_send_message')
    const ctx = buildContext()

    const result = await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).not.toHaveBeenCalled()
    expect(result.output.__testModePreCallGate).toBe(true)
  })

  test('Google Sheets append: integrationHandlers NOT invoked', async () => {
    const service = new NodeExecutionService()
    const node = nodeOf('google_sheets_action_append')
    const ctx = buildContext()

    const result = await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).not.toHaveBeenCalled()
    expect(result.output.__testModePreCallGate).toBe(true)
  })

  test('Discord send: integrationHandlers NOT invoked', async () => {
    const service = new NodeExecutionService()
    const node = nodeOf('discord_action_send_message')
    const ctx = buildContext()

    const result = await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).not.toHaveBeenCalled()
    expect(result.output.__testModePreCallGate).toBe(true)
  })

  test('Airtable create_record: integrationHandlers NOT invoked', async () => {
    const service = new NodeExecutionService()
    const node = nodeOf('airtable_action_create_record')
    const ctx = buildContext()

    const result = await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).not.toHaveBeenCalled()
    expect(result.output.__testModePreCallGate).toBe(true)
  })

  test('Notion create_page: integrationHandlers NOT invoked', async () => {
    const service = new NodeExecutionService()
    const node = nodeOf('notion_action_create_page')
    const ctx = buildContext()

    const result = await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).not.toHaveBeenCalled()
    expect(result.output.__testModePreCallGate).toBe(true)
  })

  test('Notion manage_database: integrationHandlers NOT invoked', async () => {
    const service = new NodeExecutionService()
    const node = nodeOf('notion_action_manage_database')
    const ctx = buildContext()

    const result = await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).not.toHaveBeenCalled()
    expect(result.output.__testModePreCallGate).toBe(true)
  })

  test('Gmail send_email: integrationHandlers NOT invoked', async () => {
    const service = new NodeExecutionService()
    const node = nodeOf('gmail_action_send_email')
    const ctx = buildContext()

    const result = await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).not.toHaveBeenCalled()
    expect(result.output.__testModePreCallGate).toBe(true)
  })

  test('Google Calendar create_event: integrationHandlers NOT invoked', async () => {
    const service = new NodeExecutionService()
    const node = nodeOf('google_calendar_action_create_event')
    const ctx = buildContext()

    const result = await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).not.toHaveBeenCalled()
    expect(result.output.__testModePreCallGate).toBe(true)
  })
})

// ─── Gate semantics — escape hatches and read-only behavior ─────────────

describe('Engine pre-call gate — semantics', () => {
  test('Read-only operation (search) IS dispatched (gate excludes reads)', async () => {
    const service = new NodeExecutionService()
    const node = nodeOf('gmail_action_search_email')
    const ctx = buildContext()

    await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).toHaveBeenCalledTimes(1)
  })

  test('EXECUTE_ALL bypasses the gate (live-testing mode)', async () => {
    const service = new NodeExecutionService()
    const node = nodeOf('stripe_action_create_payment_intent')
    const ctx = buildContext({
      testModeConfig: {
        triggerMode: TriggerTestMode.USE_MOCK_DATA,
        actionMode: ActionTestMode.EXECUTE_ALL,
      } as any,
    })

    await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).toHaveBeenCalledTimes(1)
  })

  test('Resume path with no testModeConfig still gates external actions', async () => {
    // Resume paths (HITL, /api/workflows/events) sometimes don't reconstruct
    // testModeConfig. The gate must still fire if testMode is true.
    const service = new NodeExecutionService()
    const node = nodeOf('stripe_action_create_payment_intent')
    const ctx = buildContext({ testModeConfig: undefined })

    const result = await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).not.toHaveBeenCalled()
    expect(result.output.__testModePreCallGate).toBe(true)
  })

  test('Live mode (testMode: false) does NOT gate', async () => {
    const service = new NodeExecutionService()
    const node = nodeOf('slack_action_send_message')
    const ctx = buildContext({ testMode: false, testModeConfig: undefined })

    await service.executeNode(node, [node], [], ctx)

    expect(mockIntegrationExecute).toHaveBeenCalledTimes(1)
  })

  test('Local action node (filter) does NOT gate (no provider call to block)', async () => {
    const service = new NodeExecutionService()
    const node = {
      id: 'filter-1',
      data: { type: 'filter', config: { condition: 'true' } },
    }
    const ctx = buildContext()

    await service.executeNode(node, [node], [], ctx)

    // Filter is not external; gate skips it; actionHandlers.execute runs.
    expect(mockActionExecute).toHaveBeenCalledTimes(1)
    expect(mockIntegrationExecute).not.toHaveBeenCalled()
  })

  test('INTERCEPT_WRITES post-hoc wrapping still applies on gate result', async () => {
    // The gate produces a mock; the existing post-hoc wrapping at lines
    // 89-107 of nodeExecutionService.ts then decorates it with
    // `{ intercepted: { wouldHaveSent: ... } }`. UI shape compatible.
    const service = new NodeExecutionService()
    const node = nodeOf('slack_action_send_message')
    const ctx = buildContext()

    const result = await service.executeNode(node, [node], [], ctx)

    expect(result.intercepted).toBeDefined()
    expect(result.intercepted.type).toBe('slack_action_send_message')
    expect(result.intercepted.wouldHaveSent.output.__testModePreCallGate).toBe(true)
  })
})
