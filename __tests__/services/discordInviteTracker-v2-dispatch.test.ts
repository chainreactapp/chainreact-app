/**
 * Contract: PR-V2-WEBHOOK-DISCORD-INVITE — Discord member-join workflows
 * route through the unified webhook dispatcher (executeWebhookWorkflow)
 * instead of instantiating AdvancedExecutionEngine directly.
 *
 * Source: lib/services/discordInviteTracker.ts (dispatchMemberJoinWorkflow)
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 3 —
 * direct AdvancedExecutionEngine callers).
 *
 * What this file proves:
 *   - dispatchMemberJoinWorkflow calls executeWebhookWorkflow with the
 *     correct workflowId / userId / provider / triggerType / triggerData /
 *     metadata / dedupeKey.
 *   - AdvancedExecutionEngine is no longer instantiated by this code path.
 *   - dedupeKey falls back through joinedAt → triggerData.timestamp →
 *     'unknown' so audit Q4's no-dedup gap is closed for every shape of
 *     member-join event.
 *   - Execution failures (rejected dispatcher, success: false result) are
 *     logged and do NOT throw — preserving the outer loop's invariant of
 *     processing all matched workflows even when one fails.
 */

const mockExecuteWebhookWorkflow = jest.fn()
jest.mock('@/lib/webhooks/execute', () => ({
  executeWebhookWorkflow: (...args: any[]) => mockExecuteWebhookWorkflow(...args),
}))

const mockAdvancedEngineCtor = jest.fn().mockImplementation(() => ({
  createExecutionSession: jest.fn(),
  executeWorkflowAdvanced: jest.fn(),
}))
jest.mock('@/lib/execution/advancedExecutionEngine', () => ({
  AdvancedExecutionEngine: mockAdvancedEngineCtor,
}))

const mockLoggerInfo = jest.fn()
const mockLoggerError = jest.fn()
jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: (...args: any[]) => mockLoggerInfo(...args),
    error: (...args: any[]) => mockLoggerError(...args),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}))

// discord.js Client constructor pulls in heavy WS/network code, and the
// module-load tail (`export const discordInviteTracker = ...getInstance()`)
// instantiates a Client at import time. Stub the package so module-load
// does not actually open sockets or register listeners.
jest.mock('discord.js', () => ({
  Client: class {
    on() {}
    once() {}
    async login() {}
    async destroy() {}
    user = null
    guilds = { cache: new Map() }
  },
  GuildMember: class {},
  Invite: class {},
  Collection: class {},
}))

// `createSupabaseServiceClient` is invoked inside other methods of
// DiscordInviteTracker but not by `dispatchMemberJoinWorkflow`. Stub
// defensively in case future test additions exercise the singleton.
jest.mock('@/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}))

import { dispatchMemberJoinWorkflow } from '@/lib/services/discordInviteTracker'

const baseWorkflow = { id: 'wf-1', user_id: 'owner-1' }

function buildMember(overrides: any = {}) {
  return {
    id: 'member-123',
    user: {
      tag: 'alice#0001',
      username: 'alice',
      discriminator: '0001',
      avatar: null,
    },
    guild: { id: 'guild-456', name: 'guild' },
    joinedAt: new Date('2026-05-04T12:00:00Z'),
    ...overrides,
  } as any
}

const baseTriggerData = {
  memberId: 'member-123',
  guildId: 'guild-456',
  joinedAt: '2026-05-04T12:00:00.000Z',
  timestamp: '2026-05-04T12:00:01.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ─── Dispatch contract ──────────────────────────────────────────────────

describe('PR-V2-WEBHOOK-DISCORD-INVITE — dispatch contract', () => {
  test('routes through executeWebhookWorkflow with full param set', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, sessionId: 'sess-1' })

    await dispatchMemberJoinWorkflow(baseWorkflow, buildMember(), baseTriggerData, 'INVITE-CODE')

    expect(mockExecuteWebhookWorkflow).toHaveBeenCalledTimes(1)
    expect(mockExecuteWebhookWorkflow).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      userId: 'owner-1',
      provider: 'discord',
      triggerType: 'discord_trigger_member_join',
      triggerData: baseTriggerData,
      metadata: {
        changeType: 'member_join',
        guildId: 'guild-456',
        memberId: 'member-123',
      },
      dedupeKey: 'guild-456:member-123:2026-05-04T12:00:00.000Z',
    })
  })

  test('AdvancedExecutionEngine is NOT instantiated', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })

    await dispatchMemberJoinWorkflow(baseWorkflow, buildMember(), baseTriggerData, null)

    expect(mockAdvancedEngineCtor).not.toHaveBeenCalled()
  })
})

// ─── Dedupe-key fallback chain ──────────────────────────────────────────

describe('PR-V2-WEBHOOK-DISCORD-INVITE — dedupeKey fallback chain', () => {
  test('uses member.joinedAt.toISOString() when present', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })

    await dispatchMemberJoinWorkflow(baseWorkflow, buildMember(), baseTriggerData, null)

    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].dedupeKey).toBe(
      'guild-456:member-123:2026-05-04T12:00:00.000Z',
    )
  })

  test('falls back to triggerData.timestamp when joinedAt is null', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })

    await dispatchMemberJoinWorkflow(
      baseWorkflow,
      buildMember({ joinedAt: null }),
      { ...baseTriggerData, timestamp: '2026-05-04T12:00:01.000Z' },
      null,
    )

    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].dedupeKey).toBe(
      'guild-456:member-123:2026-05-04T12:00:01.000Z',
    )
  })

  test('falls back to "unknown" when both joinedAt and triggerData.timestamp are missing', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true })

    await dispatchMemberJoinWorkflow(
      baseWorkflow,
      buildMember({ joinedAt: null }),
      { memberId: 'member-123', guildId: 'guild-456' }, // no timestamp
      null,
    )

    expect(mockExecuteWebhookWorkflow.mock.calls[0][0].dedupeKey).toBe(
      'guild-456:member-123:unknown',
    )
  })
})

// ─── Error handling preserves loop invariant ───────────────────────────

describe('PR-V2-WEBHOOK-DISCORD-INVITE — error handling', () => {
  test('result.success: true → logs info, no error', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, sessionId: 'sess-1' })

    await dispatchMemberJoinWorkflow(baseWorkflow, buildMember(), baseTriggerData, 'CODE')

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      '[Discord] Workflow triggered successfully for member join',
      expect.objectContaining({
        workflowId: 'wf-1',
        memberId: 'member-123',
        inviteCode: 'CODE',
        sessionId: 'sess-1',
      }),
    )
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  test('result.success: false → logs error, does not throw (loop continues)', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({
      success: false,
      error: 'billing rejected',
    })

    await expect(
      dispatchMemberJoinWorkflow(baseWorkflow, buildMember(), baseTriggerData, null),
    ).resolves.toBeUndefined()

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Failed to execute workflow wf-1 for member join',
      expect.objectContaining({ error: 'billing rejected' }),
    )
    expect(mockLoggerInfo).not.toHaveBeenCalled()
  })

  test('executeWebhookWorkflow throws → caught, logged, does not propagate', async () => {
    mockExecuteWebhookWorkflow.mockRejectedValueOnce(new Error('dispatcher exploded'))

    await expect(
      dispatchMemberJoinWorkflow(baseWorkflow, buildMember(), baseTriggerData, null),
    ).resolves.toBeUndefined()

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Failed to execute workflow wf-1 for member join',
      expect.any(Error),
    )
  })

  test('result.duplicate: true → logs success with duplicate flag', async () => {
    mockExecuteWebhookWorkflow.mockResolvedValueOnce({ success: true, duplicate: true })

    await dispatchMemberJoinWorkflow(baseWorkflow, buildMember(), baseTriggerData, null)

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      '[Discord] Workflow triggered successfully for member join',
      expect.objectContaining({ duplicate: true }),
    )
  })
})
