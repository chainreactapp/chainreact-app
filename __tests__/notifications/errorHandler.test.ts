/**
 * Unit tests for lib/notifications/errorHandler.ts.
 *
 * The orchestrator owns the highest-risk piece of the failure-notification
 * pipeline: it must (1) dedupe so a workflow that crashes mid-flight doesn't
 * fire two emails, (2) honor the workflow's per-channel opt-ins, and
 * (3) drop notifications cleanly when prerequisites are missing.
 *
 * Channel implementations themselves are mocked — we verify they were called
 * with the humanized payload, not what they actually render.
 */

jest.mock("@/lib/utils/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}))

const mockSendEmail = jest.fn()
jest.mock("@/lib/notifications/email", () => ({
  sendWorkflowErrorEmail: (...args: any[]) => mockSendEmail(...args),
}))

const mockSendSlack = jest.fn()
jest.mock("@/lib/notifications/slack", () => ({
  sendWorkflowErrorSlack: (...args: any[]) => mockSendSlack(...args),
}))

const mockSendDiscord = jest.fn()
jest.mock("@/lib/notifications/discord", () => ({
  sendWorkflowErrorDiscord: (...args: any[]) => mockSendDiscord(...args),
}))

const mockSendSMS = jest.fn()
const mockFormatPhoneNumber = jest.fn((p: string) => p)
jest.mock("@/lib/notifications/sms", () => ({
  sendSMS: (...args: any[]) => mockSendSMS(...args),
  formatPhoneNumber: (p: string) => mockFormatPhoneNumber(p),
}))

let mockSupabase: any
jest.mock("@/utils/supabase/server", () => ({
  createSupabaseServiceClient: jest.fn(async () => mockSupabase),
}))

import { sendWorkflowErrorNotifications } from "@/lib/notifications/errorHandler"

/**
 * Build a Supabase client mock with three behaviors we control per-test:
 *   - notification dedup claim (UPDATE ... IS NULL ... .select.maybeSingle)
 *   - error_classification lookup (SELECT ... .maybeSingle)
 *   - notifications insert (INSERT ... no chain return)
 */
function makeSupabase(opts: {
  claimResult?: { data: any; error?: any }
  classification?: any
  notificationInsertError?: any
} = {}) {
  const claimResult = opts.claimResult ?? { data: { id: "exec_1" }, error: null }
  const classificationData = opts.classification ?? null
  const notifInsertError = opts.notificationInsertError ?? null

  const insertSpy = jest.fn().mockResolvedValue({ error: notifInsertError })

  const fromSpy = jest.fn().mockImplementation((table: string) => {
    if (table === "workflow_execution_sessions") {
      // The orchestrator calls this twice:
      //   1. UPDATE...is(null).select().maybeSingle()  — dedup claim
      //   2. SELECT('error_classification').eq().maybeSingle() — lookup
      // We distinguish by which method gets called first.
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue(claimResult),
              }),
            }),
          }),
        }),
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest
              .fn()
              .mockResolvedValue({
                data: classificationData
                  ? { error_classification: classificationData }
                  : null,
                error: null,
              }),
          }),
        }),
      }
    }
    if (table === "notifications") {
      return { insert: insertSpy }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return {
    from: fromSpy,
    _spies: { insert: insertSpy, from: fromSpy },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSendEmail.mockResolvedValue(true)
  mockSendSlack.mockResolvedValue(true)
  mockSendDiscord.mockResolvedValue(true)
  mockSendSMS.mockResolvedValue(true)
})

const baseWorkflow = {
  id: "wf_1",
  name: "Daily ingest",
  user_id: "user_1",
  settings: {
    error_notifications_enabled: true,
    error_notification_email: false,
    error_notification_slack: false,
    error_notification_discord: false,
    error_notification_sms: false,
    error_notification_in_app: false,
    error_notification_channels: {},
  },
}

describe("sendWorkflowErrorNotifications — short-circuit guards", () => {
  it("returns empty results when error_notifications_enabled is false", async () => {
    mockSupabase = makeSupabase()
    const workflow = {
      ...baseWorkflow,
      settings: { ...baseWorkflow.settings, error_notifications_enabled: false },
    }
    const results = await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    expect(results).toEqual({
      email: false,
      sms: false,
      slack: false,
      discord: false,
      in_app: false,
    })
    // No DB activity at all — guard fires before client is created
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it("returns empty results when workflow.user_id is missing", async () => {
    mockSupabase = makeSupabase()
    const workflow = {
      ...baseWorkflow,
      user_id: null,
    }
    const results = await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    expect(results).toEqual({
      email: false,
      sms: false,
      slack: false,
      discord: false,
      in_app: false,
    })
  })
})

describe("sendWorkflowErrorNotifications — dedup", () => {
  it("skips the entire fan-out when claim returns null (already sent)", async () => {
    mockSupabase = makeSupabase({ claimResult: { data: null, error: null } })
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        error_notification_email: true,
        error_notification_in_app: true,
        error_notification_channels: { email: "u@example.com" },
      },
    }
    const results = await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    expect(results).toEqual({
      email: false,
      sms: false,
      slack: false,
      discord: false,
      in_app: false,
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockSupabase._spies.insert).not.toHaveBeenCalled()
  })

  it("proceeds with fan-out when claim returns a row (won the race)", async () => {
    mockSupabase = makeSupabase({
      claimResult: { data: { id: "exec_1" }, error: null },
    })
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        error_notification_email: true,
        error_notification_channels: { email: "u@example.com" },
      },
    }
    const results = await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    expect(results.email).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it("skips the dedup claim entirely for pre-execution errors (no executionId)", async () => {
    mockSupabase = makeSupabase()
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        error_notification_email: true,
        error_notification_channels: { email: "u@example.com" },
      },
    }
    const results = await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
    })
    expect(results.email).toBe(true)
    // No executionId means no claim/lookup → only the in-app insert touches DB,
    // and even that is gated by error_notification_in_app, which is off here.
    expect(mockSupabase._spies.insert).not.toHaveBeenCalled()
  })

  it("sends notifications anyway if the dedup claim query errors", async () => {
    // Failing closed (skipping notifications) on a transient DB issue would
    // miss critical alerts. Better to risk a duplicate email.
    mockSupabase = makeSupabase({
      claimResult: { data: null, error: { message: "RLS denied" } },
    })
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        error_notification_email: true,
        error_notification_channels: { email: "u@example.com" },
      },
    }
    const results = await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    expect(results.email).toBe(true)
  })
})

describe("sendWorkflowErrorNotifications — channel fan-out", () => {
  it("only fires channels with both opt-in flag AND target set", async () => {
    mockSupabase = makeSupabase()
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        error_notification_email: true,
        error_notification_slack: true,
        error_notification_discord: true,
        error_notification_sms: false, // explicitly off
        error_notification_channels: {
          email: "u@example.com",
          slack_channel: "C123",
          discord_channel: "D456",
          sms_phone: "+15551234567", // present but flag off
        },
      },
    }
    await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendSlack).toHaveBeenCalledTimes(1)
    expect(mockSendDiscord).toHaveBeenCalledTimes(1)
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it("skips a channel when its target is missing even with the flag on", async () => {
    mockSupabase = makeSupabase()
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        error_notification_email: true,
        error_notification_channels: {}, // no email address
      },
    }
    await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("threads the humanized title through to all channels", async () => {
    mockSupabase = makeSupabase({
      classification: {
        category: "auth",
        title: "Reconnect Gmail",
        description: "Your Gmail connection expired or was revoked.",
        hint: "Reconnect from /integrations.",
        action: "reconnect",
        provider: "gmail",
        severity: "error",
        nodeId: null,
        nodeName: null,
        firstFailedNodeId: null,
        failedNodeCount: 1,
        code: "AUTH_RECONNECT_REQUIRED",
        path: null,
      },
    })
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        error_notification_email: true,
        error_notification_slack: true,
        error_notification_channels: { email: "u@example.com", slack_channel: "C1" },
      },
    }
    await sendWorkflowErrorNotifications(workflow as any, {
      message: "401 Unauthorized",
      executionId: "exec_1",
    })

    // Email gets payload as second arg
    const [, emailPayload] = mockSendEmail.mock.calls[0]
    expect(emailPayload.title).toBe("Reconnect Gmail")
    expect(emailPayload.cta?.url).toContain("/integrations")
    expect(emailPayload.technicalDetails).toBe("401 Unauthorized")

    // Slack gets payload as second arg, userId as third
    const [, slackPayload, slackUserId] = mockSendSlack.mock.calls[0]
    expect(slackPayload.title).toBe("Reconnect Gmail")
    expect(slackUserId).toBe("user_1")
  })
})

describe("sendWorkflowErrorNotifications — SMS terseness", () => {
  it("sends a short message without URL", async () => {
    mockSupabase = makeSupabase({
      classification: {
        category: "auth",
        title: "Reconnect Gmail",
        description: "Your Gmail connection expired.",
        hint: "Reconnect from /integrations.",
        action: "reconnect",
        provider: "gmail",
        severity: "error",
        nodeId: null,
        nodeName: null,
        firstFailedNodeId: null,
        failedNodeCount: 1,
        code: null,
        path: null,
      },
    })
    const workflow = {
      ...baseWorkflow,
      name: "Daily ingest",
      settings: {
        ...baseWorkflow.settings,
        error_notification_sms: true,
        error_notification_channels: { sms_phone: "+15551234567" },
      },
    }
    await sendWorkflowErrorNotifications(workflow as any, {
      message: "401 Unauthorized",
      executionId: "exec_1",
    })
    expect(mockSendSMS).toHaveBeenCalledTimes(1)
    const [, body] = mockSendSMS.mock.calls[0]
    expect(body).toContain("Reconnect Gmail")
    expect(body).toContain("Daily ingest")
    expect(body).not.toMatch(/https?:\/\//)
  })

  it("truncates very long titles", async () => {
    const longTitle = "A".repeat(80)
    mockSupabase = makeSupabase({
      classification: {
        category: "internal",
        title: longTitle,
        description: "x",
        hint: null,
        action: null,
        provider: null,
        severity: "error",
        nodeId: null,
        nodeName: null,
        firstFailedNodeId: null,
        failedNodeCount: 1,
        code: null,
        path: null,
      },
    })
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        error_notification_sms: true,
        error_notification_channels: { sms_phone: "+15551234567" },
      },
    }
    await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    const [, body] = mockSendSMS.mock.calls[0]
    // Should be truncated with an ellipsis
    expect(body).toMatch(/A{37}…/)
  })
})

describe("sendWorkflowErrorNotifications — in-app notifications", () => {
  it("inserts an in-app row by default when error_notifications_enabled", async () => {
    mockSupabase = makeSupabase()
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        // in_app NOT explicitly set — should default to inserting
        error_notification_in_app: undefined,
      },
    }
    const results = await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    expect(results.in_app).toBe(true)
    expect(mockSupabase._spies.insert).toHaveBeenCalledTimes(1)
    const [insertedRow] = mockSupabase._spies.insert.mock.calls[0]
    expect(insertedRow.user_id).toBe("user_1")
    expect(insertedRow.type).toBe("workflow_failed")
    expect(insertedRow.title).toBeTruthy()
    expect(insertedRow.message).toBeTruthy()
    expect(insertedRow.action_url).toContain("workflows/builder/wf_1")
    expect(insertedRow.metadata.workflow_id).toBe("wf_1")
    expect(insertedRow.metadata.execution_id).toBe("exec_1")
  })

  it("skips in-app when error_notification_in_app is explicitly false", async () => {
    mockSupabase = makeSupabase()
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        error_notification_in_app: false,
      },
    }
    const results = await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    expect(results.in_app).toBe(false)
    expect(mockSupabase._spies.insert).not.toHaveBeenCalled()
  })

  it("returns false for in_app when the insert errors but doesn't throw", async () => {
    mockSupabase = makeSupabase({
      notificationInsertError: { message: "RLS denied" },
    })
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        error_notification_in_app: true,
      },
    }
    const results = await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    expect(results.in_app).toBe(false)
  })

  it("uses the classified CTA url when available", async () => {
    mockSupabase = makeSupabase({
      classification: {
        category: "auth",
        title: "Reconnect Gmail",
        description: "x",
        hint: null,
        action: "reconnect",
        provider: "gmail",
        severity: "error",
        nodeId: null,
        nodeName: null,
        firstFailedNodeId: null,
        failedNodeCount: 1,
        code: null,
        path: null,
      },
    })
    const workflow = {
      ...baseWorkflow,
      settings: {
        ...baseWorkflow.settings,
        error_notification_in_app: true,
      },
    }
    await sendWorkflowErrorNotifications(workflow as any, {
      message: "boom",
      executionId: "exec_1",
    })
    const [insertedRow] = mockSupabase._spies.insert.mock.calls[0]
    expect(insertedRow.action_url).toContain("/integrations")
    expect(insertedRow.action_label).toBe("Reconnect Gmail")
  })
})
