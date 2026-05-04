/**
 * Workflow Error Notification Orchestrator
 *
 * Single entry point for fanning out workflow failure notifications across
 * email, Slack, Discord, SMS, and the in-app notifications table.
 *
 * Flow:
 *   1. Atomically claim the notification slot via
 *      `error_notifications_sent_at IS NULL`. Skip if already sent — protects
 *      against the engine-crash + execute-route-catch double-fire.
 *   2. Look up `error_classification` from the session row to humanize
 *      every channel uniformly.
 *   3. Build a single `WorkflowFailurePayload` and fan it out.
 *
 * Pre-execution errors (no executionId — auth / billing / parse failures
 * before workflowExecutionService runs) skip the dedup check and still
 * notify, since no session row exists.
 */

import { logger } from '@/lib/utils/logger'
import { createSupabaseServiceClient } from '@/utils/supabase/server'
import { sendWorkflowErrorEmail } from './email'
import { sendWorkflowErrorSlack } from './slack'
import { sendWorkflowErrorDiscord } from './discord'
import {
  buildWorkflowFailurePayload,
  type WorkflowFailurePayload,
} from './workflowFailurePayload'
import type { PersistedErrorClassification } from '@/lib/workflows/errors/classifyExecutionFailure'

interface WorkflowSettings {
  error_notifications_enabled?: boolean
  error_notification_email?: boolean
  error_notification_slack?: boolean
  error_notification_discord?: boolean
  error_notification_sms?: boolean
  error_notification_in_app?: boolean
  error_notification_channels?: {
    email?: string
    slack_channel?: string
    discord_channel?: string
    sms_phone?: string
  }
}

interface Workflow {
  id: string
  name: string | null
  user_id: string | null
  settings?: WorkflowSettings | null
}

interface ErrorDetails {
  message: string
  stack?: string
  executionId?: string
}

interface NotificationResults {
  email: boolean
  sms: boolean
  slack: boolean
  discord: boolean
  in_app: boolean
}

const EMPTY_RESULTS: NotificationResults = {
  email: false,
  sms: false,
  slack: false,
  discord: false,
  in_app: false,
}

/**
 * Atomically claim the notification slot. Returns true if THIS caller won
 * the race and should send; false if another caller already sent.
 *
 * For executions without a session row (pre-execution errors with no
 * executionId), returns true — there's no row to dedup against.
 */
async function claimNotificationSlot(
  supabase: any,
  executionId: string | undefined
): Promise<boolean> {
  if (!executionId) return true

  try {
    const { data, error } = await supabase
      .from('workflow_execution_sessions')
      .update({ error_notifications_sent_at: new Date().toISOString() })
      .eq('id', executionId)
      .is('error_notifications_sent_at', null)
      .select('id')
      .maybeSingle()

    if (error) {
      logger.warn('[ErrorHandler] Notification slot claim query failed; sending anyway', {
        executionId,
        error: error.message,
      })
      return true
    }
    return Boolean(data)
  } catch (err: any) {
    logger.warn('[ErrorHandler] Notification slot claim threw; sending anyway', {
      executionId,
      error: err?.message,
    })
    return true
  }
}

/**
 * Look up the persisted classification for an execution. Returns null
 * when there's no row, the column is empty, or the lookup fails.
 */
async function fetchClassification(
  supabase: any,
  executionId: string | undefined
): Promise<PersistedErrorClassification | null> {
  if (!executionId) return null
  try {
    const { data } = await supabase
      .from('workflow_execution_sessions')
      .select('error_classification')
      .eq('id', executionId)
      .maybeSingle()
    return (data?.error_classification as PersistedErrorClassification) || null
  } catch {
    return null
  }
}

/**
 * Insert an in-app notification row deep-linking to the History modal for
 * the failed execution. Best-effort — logs and moves on if it fails.
 */
async function createInAppNotification(
  supabase: any,
  workflow: Workflow,
  payload: WorkflowFailurePayload
): Promise<boolean> {
  try {
    const actionUrl = payload.cta?.url ||
      (payload.executionId
        ? `/workflows/builder/${payload.workflowId}?historyExecution=${payload.executionId}`
        : `/workflows/builder/${payload.workflowId}`)

    const { error } = await supabase.from('notifications').insert({
      user_id: workflow.user_id,
      type: 'workflow_failed',
      title: payload.title,
      message: payload.description,
      action_url: actionUrl,
      action_label: payload.cta?.label || 'View execution',
      metadata: {
        workflow_id: payload.workflowId,
        execution_id: payload.executionId,
        category: payload.severity,
        failed_step_name: payload.failedStepName,
      },
      is_read: false,
      created_at: new Date().toISOString(),
    })
    if (error) {
      logger.error('[ErrorHandler] Failed to create in-app notification:', error)
      return false
    }
    return true
  } catch (err: any) {
    logger.error('[ErrorHandler] In-app notification insert threw:', err?.message)
    return false
  }
}

/**
 * Send error notifications for a failed workflow. Idempotent per execution.
 */
export async function sendWorkflowErrorNotifications(
  workflow: Workflow,
  error: ErrorDetails
): Promise<NotificationResults> {
  // No-op when notifications are disabled at the workflow level
  if (!workflow.settings?.error_notifications_enabled) {
    logger.info('Error notifications disabled for workflow:', workflow.id)
    return EMPTY_RESULTS
  }

  // Workflow rows without a user_id can't deliver user-scoped notifications
  // (in-app, slack/discord per-user integrations). Skip — but still let
  // future channel implementations that don't require a user proceed if
  // we add any.
  if (!workflow.user_id) {
    logger.warn('[ErrorHandler] Workflow has no user_id, skipping notifications', {
      workflowId: workflow.id,
    })
    return EMPTY_RESULTS
  }

  // Use the service client so we can claim the dedup slot regardless of
  // who triggered the failure (cron, webhook, user route).
  const supabase = await createSupabaseServiceClient()

  const claimed = await claimNotificationSlot(supabase, error.executionId)
  if (!claimed) {
    logger.info('[ErrorHandler] Notifications already sent for execution; skipping', {
      executionId: error.executionId,
      workflowId: workflow.id,
    })
    return EMPTY_RESULTS
  }

  const classification = await fetchClassification(supabase, error.executionId)
  const payload = buildWorkflowFailurePayload({
    workflowId: workflow.id,
    workflowName: workflow.name || 'Untitled Workflow',
    executionId: error.executionId || null,
    classification,
    rawErrorMessage: error.message || 'Unknown error',
  })

  const settings = workflow.settings ?? {}
  const channels = settings.error_notification_channels || {}

  const results: NotificationResults = { ...EMPTY_RESULTS }

  // Email
  if (settings.error_notification_email && channels.email) {
    try {
      results.email = await sendWorkflowErrorEmail(channels.email, payload)
    } catch (err: any) {
      logger.error('Email notification failed:', err?.message)
    }
  }

  // SMS — terse, no link, no technical details
  if (settings.error_notification_sms && channels.sms_phone) {
    try {
      const { sendSMS, formatPhoneNumber } = await import('./sms')
      const formattedPhone = formatPhoneNumber(channels.sms_phone)
      const smsTitle = payload.title.length > 40
        ? `${payload.title.slice(0, 37)}…`
        : payload.title
      const smsMessage = `ChainReact: ${smsTitle} — workflow "${payload.workflowName}".`
      results.sms = await sendSMS(formattedPhone, smsMessage)
    } catch (err: any) {
      logger.error('SMS notification failed:', err?.message)
    }
  }

  // Slack
  if (settings.error_notification_slack && channels.slack_channel) {
    try {
      results.slack = await sendWorkflowErrorSlack(
        channels.slack_channel,
        payload,
        workflow.user_id
      )
    } catch (err: any) {
      logger.error('Slack notification failed:', err?.message)
    }
  }

  // Discord
  if (settings.error_notification_discord && channels.discord_channel) {
    try {
      results.discord = await sendWorkflowErrorDiscord(
        channels.discord_channel,
        payload,
        workflow.user_id
      )
    } catch (err: any) {
      logger.error('Discord notification failed:', err?.message)
    }
  }

  // In-app notification — defaults to enabled when error_notifications_enabled
  // is true. A user can opt out via settings.error_notification_in_app === false.
  if (settings.error_notification_in_app !== false) {
    results.in_app = await createInAppNotification(supabase, workflow, payload)
  }

  logger.info('Error notification summary:', {
    workflowId: workflow.id,
    executionId: error.executionId,
    results,
  })

  return results
}

/**
 * Convenience wrapper that looks up the workflow row (with settings) by id
 * and forwards to `sendWorkflowErrorNotifications`. Used by call sites
 * that have a workflowId but not the full workflow row.
 */
export async function notifyWorkflowFailure(
  supabase: any,
  workflowId: string,
  errorDetails: ErrorDetails
): Promise<NotificationResults> {
  try {
    const { data: workflow, error } = await supabase
      .from('workflows')
      .select('*')
      .eq('id', workflowId)
      .single()
    if (error || !workflow) {
      logger.warn('[ErrorHandler] notifyWorkflowFailure: workflow not found', {
        workflowId,
        error: error?.message,
      })
      return EMPTY_RESULTS
    }
    return await sendWorkflowErrorNotifications(workflow, errorDetails)
  } catch (err: any) {
    logger.error('[ErrorHandler] notifyWorkflowFailure threw:', err?.message)
    return EMPTY_RESULTS
  }
}

/**
 * Helper function to extract error message from various error types
 */
export function extractErrorMessage(error: any): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error?.message) return error.message
  return 'Unknown error occurred'
}
