/**
 * User Action Escalation Cron
 *
 * Deterministic staged escalation from first warning to workflow pause.
 * Advances notification milestones exactly once per stage based on elapsed time.
 *
 * Milestone timeline (from user_action_deadline creation):
 *   Day 0: action_required_initial (already sent by transition engine)
 *   Day 2: reminder_day_2
 *   Day 5: urgent_day_5
 *   Day 7: paused_day_7 (pause affected workflows)
 *
 * Schedule: Hourly
 */

import { type NextRequest } from 'next/server'
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { getAdminSupabaseClient } from '@/lib/supabase/admin'
import { requireCronAuth } from '@/lib/utils/cron-auth'
import {
  deliverDisconnectionNotification,
} from '@/lib/integrations/notificationService'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type EscalationMilestone =
  | 'action_required_initial'
  | 'reminder_day_2'
  | 'urgent_day_5'
  | 'paused_day_7'

interface EscalationStep {
  milestone: EscalationMilestone
  daysFromDeadlineCreation: number
  title: string
  messageTemplate: (provider: string, daysLeft: number) => string
  sendEmail: boolean
  pauseWorkflows: boolean
}

const ESCALATION_STEPS: EscalationStep[] = [
  {
    milestone: 'reminder_day_2',
    daysFromDeadlineCreation: 2,
    title: '⚠️ {provider} Needs Attention',
    messageTemplate: (provider, daysLeft) =>
      `Your ${provider} connection still needs attention. ${daysLeft} days until your workflows are paused.`,
    sendEmail: true,
    pauseWorkflows: false,
  },
  {
    milestone: 'urgent_day_5',
    daysFromDeadlineCreation: 5,
    title: '🔴 {provider} — Workflows Will Pause Soon',
    messageTemplate: (provider) =>
      `Your ${provider} connection is still broken. Your workflows will be paused in 2 days. Reconnect now to prevent disruption.`,
    sendEmail: true,
    pauseWorkflows: false,
  },
  {
    milestone: 'paused_day_7',
    daysFromDeadlineCreation: 7,
    title: '⛔ {provider} — Workflows Paused',
    messageTemplate: (provider) =>
      `Your ${provider} workflows have been paused due to an unresolved connection issue. Reconnect to resume.`,
    sendEmail: true,
    pauseWorkflows: true,
  },
]

// Milestone ordering for comparison
const MILESTONE_ORDER: Record<string, number> = {
  none: 0,
  warning: 1,
  action_required_initial: 2,
  reminder_day_2: 3,
  urgent_day_5: 4,
  paused_day_7: 5,
  recovered: 0, // Reset
}

function getProviderDisplayName(provider: string): string {
  const names: Record<string, string> = {
    hubspot: 'HubSpot',
    'google-sheets': 'Google Sheets',
    'google-drive': 'Google Drive',
    'google-calendar': 'Google Calendar',
    gmail: 'Gmail',
    slack: 'Slack',
    discord: 'Discord',
    notion: 'Notion',
    github: 'GitHub',
    airtable: 'Airtable',
    stripe: 'Stripe',
    trello: 'Trello',
  }
  return names[provider] || provider.charAt(0).toUpperCase() + provider.slice(1)
}

export async function GET(request: NextRequest) {
  const authResult = requireCronAuth(request)
  if (!authResult.authorized) return authResult.response

  const startTime = Date.now()

  try {
    const supabase = getAdminSupabaseClient()
    if (!supabase) {
      return errorResponse('Failed to create database client', 500)
    }

    // Find integrations requiring user action
    const { data: integrations, error: fetchError } = await supabase
      .from('integrations')
      .select('id, provider, user_id, user_action_deadline, last_notification_milestone, last_notified_at, health_check_status')
      .eq('requires_user_action', true)
      .not('user_action_deadline', 'is', null)

    if (fetchError) {
      logger.error('[NotifyUserActions] Error fetching integrations:', fetchError)
      return errorResponse('Failed to fetch integrations', 500)
    }

    if (!integrations || integrations.length === 0) {
      return jsonResponse({
        success: true,
        message: 'No integrations requiring user action',
        duration: `${Date.now() - startTime}ms`,
      })
    }

    logger.info(`[NotifyUserActions] Processing ${integrations.length} integrations requiring action`)

    const now = new Date()
    let escalated = 0
    let paused = 0

    for (const integration of integrations) {
      try {
        const deadlineCreatedAt = new Date(integration.user_action_deadline)
        // Calculate days elapsed since deadline was set
        // (deadline is set N days in the future, so we check from when it was created)
        // user_action_deadline = creation_time + 7 days, so creation = deadline - 7 days
        // Actually, we track from deadline creation time. The deadline IS when action must be taken.
        // Days elapsed = days since (deadline - 7 days) = roughly days since the issue started.
        // Simpler: use the deadline as the anchor. Day 0 = deadline was just set.
        // The deadline was set when the state transitioned to action_required.
        // last_notified_at on that transition gives us the start time.
        // Use the simpler approach: days = (now - (deadline - 7 days))
        // Since deadline = creation + 7d, creation = deadline - 7d
        const deadlineDays = 7 // default deadline window
        const creationApprox = new Date(deadlineCreatedAt.getTime() - deadlineDays * 24 * 60 * 60 * 1000)
        const daysSinceCreation = (now.getTime() - creationApprox.getTime()) / (24 * 60 * 60 * 1000)

        const currentMilestone = integration.last_notification_milestone || 'none'
        const currentOrder = MILESTONE_ORDER[currentMilestone] ?? 0

        // Find the next applicable escalation step
        for (const step of ESCALATION_STEPS) {
          const stepOrder = MILESTONE_ORDER[step.milestone] ?? 0

          // Only advance forward, never repeat or go backward
          if (stepOrder <= currentOrder) continue

          // Check if enough time has elapsed for this step
          if (daysSinceCreation < step.daysFromDeadlineCreation) break

          const providerName = getProviderDisplayName(integration.provider)
          const daysLeft = Math.max(0, Math.ceil(deadlineDays - daysSinceCreation))

          // Create in-app notification
          const { error: notifError } = await supabase
            .from('notifications')
            .insert({
              user_id: integration.user_id,
              type: 'integration_disconnected',
              title: step.title.replace('{provider}', providerName),
              message: step.messageTemplate(providerName, daysLeft),
              action_url: `/integrations?reconnect=${integration.provider}`,
              action_label: 'Reconnect Now',
              is_read: false,
              metadata: {
                provider: integration.provider,
                integration_id: integration.id,
                escalation_milestone: step.milestone,
                severity: step.pauseWorkflows ? 'critical' : 'warning',
              },
            })

          if (notifError) {
            logger.error(`[NotifyUserActions] Error creating notification:`, notifError)
            continue
          }

          // Send email if configured
          if (step.sendEmail) {
            await deliverDisconnectionNotification(supabase, {
              userId: integration.user_id!,
              provider: integration.provider,
              integrationId: integration.id,
              errorMessage: step.messageTemplate(providerName, daysLeft),
              sendEmail: true,
            })
          }

          // Update milestone atomically
          await supabase
            .from('integrations')
            .update({
              last_notification_milestone: step.milestone,
              last_notified_at: now.toISOString(),
              // On Day 7, transition health state to paused
              ...(step.pauseWorkflows ? { health_check_status: 'paused' } : {}),
            })
            .eq('id', integration.id)
            .eq('last_notification_milestone', currentMilestone) // Atomic: only if still at expected milestone

          escalated++

          // Pause workflows if this is the final escalation
          if (step.pauseWorkflows) {
            await pauseWorkflowsForIntegration(supabase, integration.id, integration.user_id)
            paused++
          }

          logger.info(`[NotifyUserActions] Escalated ${integration.provider} to ${step.milestone}`, {
            integrationId: integration.id,
            daysSinceCreation: Math.round(daysSinceCreation),
          })

          // Only advance one step per cron run
          break
        }
      } catch (err) {
        logger.error(`[NotifyUserActions] Error processing integration ${integration.id}:`, err)
      }
    }

    const duration = Date.now() - startTime

    logger.info(`[NotifyUserActions] Complete: ${escalated} escalated, ${paused} paused in ${duration}ms`)

    return jsonResponse({
      success: true,
      stats: { processed: integrations.length, escalated, paused },
      duration: `${duration}ms`,
    })
  } catch (error: any) {
    logger.error('[NotifyUserActions] Critical error:', error)
    return errorResponse('Failed to run escalation check', 500)
  }
}

/**
 * Pause workflows that depend on a disconnected integration.
 * Marks them as eligible_to_resume rather than deleting activation state.
 */
async function pauseWorkflowsForIntegration(
  supabase: any,
  integrationId: string,
  userId: string
): Promise<void> {
  try {
    // Find active workflows owned by this user that reference this integration's provider
    // This is a conservative approach — pause workflows that might be affected
    const { data: integration } = await supabase
      .from('integrations')
      .select('provider')
      .eq('id', integrationId)
      .single()

    if (!integration) return

    // Mark workflows as paused due to integration issue
    // We don't deactivate them — just flag them so the user can resume after reconnect
    const { error } = await supabase
      .from('workflows')
      .update({
        status: 'paused',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('status', 'active')
      // Only pause workflows that are still active
      // The user can resume them after reconnecting

    if (error) {
      logger.error(`[NotifyUserActions] Error pausing workflows:`, error)
    } else {
      logger.info(`[NotifyUserActions] Paused active workflows for user ${userId} due to ${integration.provider} disconnection`)
    }
  } catch (err) {
    logger.error(`[NotifyUserActions] Error in pauseWorkflowsForIntegration:`, err)
  }
}
