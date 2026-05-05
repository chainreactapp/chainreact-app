/**
 * Webhook Processor Pipeline Tests
 *
 * Tests the full processWebhookEvent() pipeline: deduplication, workflow matching,
 * execution via AdvancedExecutionEngine, and audit trail logging.
 *
 * Run: npx jest __tests__/webhooks/processor.test.ts --verbose
 */

import { makeWebhookEvent } from './helpers'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockCreateSession = jest.fn().mockResolvedValue({ id: 'session-1' })
const mockExecuteWorkflow = jest.fn().mockResolvedValue({ success: true })

jest.mock('@/lib/execution/advancedExecutionEngine', () => ({
  AdvancedExecutionEngine: jest.fn().mockImplementation(() => ({
    createExecutionSession: mockCreateSession,
    executeWorkflowAdvanced: mockExecuteWorkflow,
  })),
}))

// PR-V2-WEBHOOKS — stub the admin client so the dispatcher's
// workflow/opt-in lookups don't crash. These tests pin v1 behavior;
// opt-in defaults false → dispatch elects v1. v2 path is never
// reached, so `WorkflowExecutionService` is never lazy-imported.
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(() => ({
    from: () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
      }
      return builder
    },
  })),
}))

const mockLogWebhookEvent = jest.fn()
jest.mock('@/lib/webhooks/event-logger', () => ({
  logWebhookEvent: (...args: any[]) => mockLogWebhookEvent(...args),
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

// Track all Supabase query calls
const mockMaybeSingle = jest.fn()
const mockSingleIntegration = jest.fn()
let mockWorkflows: any[] = []
let mockWorkflowNodes: Record<string, any[]> = {}

jest.mock('@/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockImplementation(async () => {
    return {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'webhook_events') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: mockMaybeSingle,
                }),
                contains: jest.fn().mockReturnValue({
                  maybeSingle: mockMaybeSingle,
                }),
              }),
            }),
            insert: jest.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        if (table === 'workflows') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: mockWorkflows,
                error: null,
              }),
            }),
          }
        }
        if (table === 'workflow_nodes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockImplementation((field: string, value: string) => ({
                order: jest.fn().mockResolvedValue({
                  data: mockWorkflowNodes[value] || [],
                  error: null,
                }),
              })),
            }),
          }
        }
        if (table === 'integrations') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  single: mockSingleIntegration,
                }),
              }),
            }),
          }
        }
        // Default
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
          insert: jest.fn().mockResolvedValue({ data: null, error: null }),
          order: jest.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }
  }),
}))

import {
  processWebhookEvent,
  processSlackEvent,
  processDiscordEvent,
  processGitHubEvent,
  processNotionEvent,
} from '@/lib/webhooks/processor'

beforeEach(() => {
  jest.clearAllMocks()
  mockWorkflows = []
  mockWorkflowNodes = {}
  // Default: no duplicate found
  mockMaybeSingle.mockResolvedValue({ data: null, error: null })
  mockSingleIntegration.mockResolvedValue({ data: null, error: null })
})

// ─── Deduplication ──────────────────────────────────────────────────────────

describe('Deduplication', () => {
  test('duplicate event returns early with duplicate flag', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: 'existing-1' }, error: null })

    const event = makeWebhookEvent({ id: 'dup-id-1' })
    const result = await processWebhookEvent(event)

    expect(result.duplicate).toBe(true)
    expect(result.workflowsTriggered).toBe(0)
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  test('non-duplicate event proceeds to processing', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockWorkflows = []

    const event = makeWebhookEvent({ id: 'new-id-1' })
    const result = await processWebhookEvent(event)

    expect(result.duplicate).toBeUndefined()
    expect(result.success).toBe(true)
  })

  test('deduplication DB error continues processing gracefully', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: new Error('DB down') })
    mockWorkflows = []

    const event = makeWebhookEvent({ id: 'err-id-1' })
    const result = await processWebhookEvent(event)

    // Should not fail, should continue to process
    expect(result.success).toBe(true)
  })

  test('event with no deduplication key skips dedupe check', async () => {
    mockWorkflows = []

    const event = makeWebhookEvent({
      id: '',
      eventData: {}, // no id, no message.id
    })
    const result = await processWebhookEvent(event)

    expect(result.success).toBe(true)
    expect(mockMaybeSingle).not.toHaveBeenCalled()
  })
})

// ─── Workflow Matching ──────────────────────────────────────────────────────

describe('Workflow matching', () => {
  function setupWorkflowWithTrigger(
    workflowId: string,
    provider: string,
    eventType: string,
    triggerConfig: Record<string, any> = {},
    workflowStatus = 'active'
  ) {
    mockWorkflows.push({
      id: workflowId,
      name: `Workflow ${workflowId}`,
      user_id: 'user-1',
      status: workflowStatus,
    })
    mockWorkflowNodes[workflowId] = [
      {
        id: `node-${workflowId}`,
        node_type: eventType,
        label: 'Trigger',
        config: { triggerConfig },
        is_trigger: true,
        provider_id: provider,
        position_x: 0,
        position_y: 0,
        display_order: 0,
      },
    ]
  }

  test('active workflow with matching trigger is executed', async () => {
    setupWorkflowWithTrigger('wf-1', 'slack', 'slack_trigger_new_message')

    const event = makeWebhookEvent({
      provider: 'slack',
      eventType: 'slack_trigger_new_message',
      eventData: { text: 'hello' },
    })
    const result = await processWebhookEvent(event)

    expect(result.workflowsTriggered).toBe(1)
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
    expect(mockExecuteWorkflow).toHaveBeenCalledTimes(1)
  })

  test('draft workflow with matching trigger is executed', async () => {
    setupWorkflowWithTrigger('wf-draft', 'slack', 'slack_trigger_new_message', {}, 'draft')

    const event = makeWebhookEvent({
      provider: 'slack',
      eventType: 'slack_trigger_new_message',
    })
    const result = await processWebhookEvent(event)

    expect(result.workflowsTriggered).toBe(1)
  })

  test('workflow with wrong provider is skipped', async () => {
    setupWorkflowWithTrigger('wf-wrong', 'discord', 'discord_trigger_new_message')

    const event = makeWebhookEvent({
      provider: 'slack',
      eventType: 'slack_trigger_new_message',
    })
    const result = await processWebhookEvent(event)

    expect(result.workflowsTriggered).toBe(0)
  })

  test('workflow with wrong event type is skipped', async () => {
    setupWorkflowWithTrigger('wf-wrong-evt', 'slack', 'slack_trigger_reaction_added')

    const event = makeWebhookEvent({
      provider: 'slack',
      eventType: 'slack_trigger_new_message',
    })
    const result = await processWebhookEvent(event)

    expect(result.workflowsTriggered).toBe(0)
  })

  test('multiple workflows match same event -> all executed', async () => {
    setupWorkflowWithTrigger('wf-a', 'slack', 'slack_trigger_new_message')
    setupWorkflowWithTrigger('wf-b', 'slack', 'slack_trigger_new_message')

    const event = makeWebhookEvent({
      provider: 'slack',
      eventType: 'slack_trigger_new_message',
    })
    const result = await processWebhookEvent(event)

    expect(result.workflowsTriggered).toBe(2)
    expect(mockCreateSession).toHaveBeenCalledTimes(2)
  })

  test('Notion event mapping: page.created matches notion_trigger_database_item_created', async () => {
    setupWorkflowWithTrigger('wf-notion', 'notion', 'notion_trigger_database_item_created')

    const event = makeWebhookEvent({
      provider: 'notion',
      eventType: 'page.created',
    })
    const result = await processWebhookEvent(event)

    expect(result.workflowsTriggered).toBe(1)
  })

  test('Notion event mapping: data_source.row_created also matches', async () => {
    setupWorkflowWithTrigger('wf-notion2', 'notion', 'notion_trigger_database_item_created')

    const event = makeWebhookEvent({
      provider: 'notion',
      eventType: 'data_source.row_created',
    })
    const result = await processWebhookEvent(event)

    expect(result.workflowsTriggered).toBe(1)
  })

  test('Slack message prefix matching: message_channels matches new_message trigger', async () => {
    setupWorkflowWithTrigger('wf-slack-msg', 'slack', 'slack_trigger_new_message')

    const event = makeWebhookEvent({
      provider: 'slack',
      eventType: 'slack_trigger_message_channels',
    })
    const result = await processWebhookEvent(event)

    expect(result.workflowsTriggered).toBe(1)
  })
})

// ─── Execution ──────────────────────────────────────────────────────────────

describe('Execution', () => {
  function setupWorkflow(workflowId: string) {
    mockWorkflows.push({
      id: workflowId,
      name: `Workflow ${workflowId}`,
      user_id: 'user-1',
      status: 'active',
    })
    mockWorkflowNodes[workflowId] = [
      {
        id: `node-${workflowId}`,
        node_type: 'slack_trigger_new_message',
        label: 'Trigger',
        config: {},
        is_trigger: true,
        provider_id: 'slack',
        position_x: 0,
        position_y: 0,
        display_order: 0,
      },
    ]
  }

  test('session created with webhook context', async () => {
    setupWorkflow('wf-exec')

    const event = makeWebhookEvent({
      provider: 'slack',
      eventType: 'slack_trigger_new_message',
      eventData: { text: 'trigger data' },
    })
    await processWebhookEvent(event)

    expect(mockCreateSession).toHaveBeenCalledWith(
      'wf-exec',
      'user-1',
      'webhook',
      expect.objectContaining({
        inputData: event.eventData,
        triggerData: event.eventData,
      })
    )
  })

  test('executeWorkflowAdvanced receives eventData and parallel config', async () => {
    setupWorkflow('wf-exec2')

    const event = makeWebhookEvent({
      provider: 'slack',
      eventType: 'slack_trigger_new_message',
      eventData: { text: 'payload' },
    })
    await processWebhookEvent(event)

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      'session-1',
      { text: 'payload' },
      { enableParallel: true, maxConcurrency: 5 }
    )
  })

  test('per-workflow error isolation: one failure does not block others', async () => {
    // Setup two workflows
    for (const id of ['wf-ok', 'wf-fail']) {
      mockWorkflows.push({
        id,
        name: `Workflow ${id}`,
        user_id: 'user-1',
        status: 'active',
      })
      mockWorkflowNodes[id] = [
        {
          id: `node-${id}`,
          node_type: 'slack_trigger_new_message',
          label: 'Trigger',
          config: {},
          is_trigger: true,
          provider_id: 'slack',
          position_x: 0,
          position_y: 0,
          display_order: 0,
        },
      ]
    }

    // Make the second workflow's execution throw
    let callCount = 0
    mockExecuteWorkflow.mockImplementation(() => {
      callCount++
      if (callCount === 2) throw new Error('Execution failed')
      return Promise.resolve({ success: true })
    })

    const event = makeWebhookEvent({
      provider: 'slack',
      eventType: 'slack_trigger_new_message',
    })
    const result = await processWebhookEvent(event)

    // Both workflows should have been attempted
    expect(result.workflowsTriggered).toBe(2)
  })

  test('result includes processingTime', async () => {
    setupWorkflow('wf-time')

    const event = makeWebhookEvent({
      provider: 'slack',
      eventType: 'slack_trigger_new_message',
    })
    const result = await processWebhookEvent(event)

    expect(result.processingTime).toBeDefined()
    expect(typeof result.processingTime).toBe('number')
  })
})

// ─── Audit Trail ────────────────────────────────────────────────────────────

describe('Audit trail', () => {
  test('logWebhookEvent called on success with correct fields', async () => {
    mockWorkflows = []

    const event = makeWebhookEvent()
    await processWebhookEvent(event)

    expect(mockLogWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: event.provider,
        requestId: event.requestId,
        status: 'success',
      })
    )
  })

  test('logWebhookEvent called on error with error message', async () => {
    // Force an error by making workflows query throw
    const { createSupabaseServiceClient } = require('@/utils/supabase/server')

    // First call succeeds (dedupe), second call throws (findMatchingWorkflows)
    let callCount = 0
    createSupabaseServiceClient.mockImplementation(async () => {
      callCount++
      if (callCount <= 2) {
        // Dedupe + store calls
        return {
          from: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
            insert: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      // findMatchingWorkflows call
      throw new Error('DB connection failed')
    })

    const event = makeWebhookEvent()

    await expect(processWebhookEvent(event)).rejects.toThrow()

    expect(mockLogWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
      })
    )
  })
})

// ─── Provider-specific processors ───────────────────────────────────────────

describe('Provider-specific processors delegate to processWebhookEvent', () => {
  beforeEach(() => {
    mockWorkflows = []
    // Restore the default mock (may have been overridden by error test)
    const { createSupabaseServiceClient } = require('@/utils/supabase/server')
    createSupabaseServiceClient.mockImplementation(async () => ({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'webhook_events') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
            insert: jest.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        if (table === 'workflows') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
          insert: jest.fn().mockResolvedValue({ data: null, error: null }),
          order: jest.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }))
  })

  test('processSlackEvent delegates to processWebhookEvent', async () => {
    const event = makeWebhookEvent({ provider: 'slack' })
    const result = await processSlackEvent(event)
    expect(result.success).toBe(true)
  })

  test('processDiscordEvent delegates to processWebhookEvent', async () => {
    const event = makeWebhookEvent({ provider: 'discord' })
    const result = await processDiscordEvent(event)
    expect(result.success).toBe(true)
  })

  test('processGitHubEvent delegates to processWebhookEvent', async () => {
    const event = makeWebhookEvent({ provider: 'github' })
    const result = await processGitHubEvent(event)
    expect(result.success).toBe(true)
  })

  test('processNotionEvent delegates to processWebhookEvent', async () => {
    const event = makeWebhookEvent({ provider: 'notion' })
    const result = await processNotionEvent(event)
    expect(result.success).toBe(true)
  })
})
