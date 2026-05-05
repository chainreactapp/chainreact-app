/**
 * Proactive Health Check Cron
 *
 * Validates integration health before failures become user-visible.
 * Uses provider-specific validation endpoints (Google tokeninfo, Slack auth.test, etc.)
 * and feeds results into the shared health transition engine.
 *
 * Schedule: Every 15 minutes (Vercel Cron)
 *
 * First-observation rule:
 * - If health_check_status is NULL (never observed), establish baseline silently — no notification.
 * - The transition engine handles this automatically via the 'proactive_health_check' source.
 */

import { type NextRequest } from 'next/server'
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { getAdminSupabaseClient } from '@/lib/supabase/admin'
import { requireCronAuth } from '@/lib/utils/cron-auth'
import { checkTokenHealth } from '@/lib/integrations/tokenMonitor'
import { classifyOAuthError } from '@/lib/integrations/errorClassificationService'
import {
  computeTransitionAndNotify,
  buildHealthySignal,
  buildFailureSignal,
  type Integration as HealthIntegration,
} from '@/lib/integrations/healthTransitionEngine'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Provider-specific health check intervals (in hours)
const HEALTH_CHECK_INTERVALS: Record<string, number> = {
  google: 6,
  gmail: 6,
  'google-calendar': 6,
  'google-drive': 6,
  'google-sheets': 6,
  'google-docs': 6,
  microsoft: 6,
  outlook: 6,
  onedrive: 6,
  'microsoft-teams': 6,
  excel: 6,
  onenote: 6,
  slack: 4,
  discord: 4,
  github: 4,
  notion: 4,
}

const DEFAULT_INTERVAL_HOURS = 12

function getIntervalHours(provider: string): number {
  return HEALTH_CHECK_INTERVALS[provider] ?? DEFAULT_INTERVAL_HOURS
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

    const now = new Date()

    // Find integrations due for health check:
    // - Connected integrations with next_health_check_at <= NOW
    // - OR integrations that have never been checked (next_health_check_at IS NULL)
    const { data: integrations, error: fetchError } = await supabase
      .from('integrations')
      .select('id, provider, user_id, access_token, status, health_check_status, last_notification_milestone, requires_user_action, user_action_type, user_action_deadline')
      .in('status', CONNECTED_STATUSES_LIST)
      .not('access_token', 'is', null)
      .or(`next_health_check_at.is.null,next_health_check_at.lte.${now.toISOString()}`)
      .limit(50)

    if (fetchError) {
      logger.error('[ProactiveHealthCheck] Error fetching integrations:', fetchError)
      return errorResponse('Failed to fetch integrations', 500)
    }

    if (!integrations || integrations.length === 0) {
      return jsonResponse({
        success: true,
        message: 'No integrations due for health check',
        duration: `${Date.now() - startTime}ms`,
      })
    }

    logger.info(`[ProactiveHealthCheck] Checking ${integrations.length} integrations`)

    let healthy = 0
    let unhealthy = 0
    let errors = 0

    for (const integration of integrations) {
      try {
        // Use existing tokenMonitor provider-specific validation
        const healthResult = await checkTokenHealthForSingle(integration)

        // Calculate next check time
        const intervalHours = getIntervalHours(integration.provider)
        const nextCheckAt = new Date(now.getTime() + intervalHours * 60 * 60 * 1000)

        // Update health check timestamps
        await supabase
          .from('integrations')
          .update({
            last_health_check_at: now.toISOString(),
            next_health_check_at: nextCheckAt.toISOString(),
          })
          .eq('id', integration.id)

        // Build health integration for transition engine
        const healthIntegration: HealthIntegration = {
          id: integration.id,
          user_id: integration.user_id,
          provider: integration.provider,
          health_check_status: integration.health_check_status ?? null,
          last_notification_milestone: integration.last_notification_milestone ?? null,
          requires_user_action: integration.requires_user_action ?? false,
          user_action_type: integration.user_action_type ?? null,
          user_action_deadline: integration.user_action_deadline ?? null,
        }

        if (healthResult.status === 'healthy') {
          healthy++
          await computeTransitionAndNotify(
            supabase,
            healthIntegration,
            buildHealthySignal('proactive_health_check')
          )
        } else {
          unhealthy++
          // Classify the health check failure
          const statusCode = healthResult.status === 'expired' ? 401
            : healthResult.status === 'invalid' ? 403
            : 500

          const classifiedError = classifyOAuthError(
            integration.provider,
            statusCode,
            { error: healthResult.error || healthResult.status, message: healthResult.error }
          )

          await computeTransitionAndNotify(
            supabase,
            healthIntegration,
            buildFailureSignal(classifiedError, 'proactive_health_check')
          )
        }
      } catch (err) {
        errors++
        logger.error(`[ProactiveHealthCheck] Error checking ${integration.provider}:`, err)
      }
    }

    const duration = Date.now() - startTime

    logger.info(`[ProactiveHealthCheck] Complete: ${healthy} healthy, ${unhealthy} unhealthy, ${errors} errors in ${duration}ms`)

    return jsonResponse({
      success: true,
      stats: { checked: integrations.length, healthy, unhealthy, errors },
      duration: `${duration}ms`,
    })
  } catch (error: any) {
    logger.error('[ProactiveHealthCheck] Critical error:', error)
    return errorResponse('Failed to run health check', 500)
  }
}

/**
 * Check token health for a single integration using provider-specific endpoints.
 * Lightweight wrapper that avoids the bulk DB update logic in tokenMonitor.checkTokenHealth().
 */
async function checkTokenHealthForSingle(integration: {
  id: string
  provider: string
  access_token: string
}): Promise<{ status: 'healthy' | 'expired' | 'invalid' | 'error'; error?: string }> {
  try {
    const provider = integration.provider

    switch (provider) {
      case 'google':
      case 'gmail':
      case 'google-calendar':
      case 'google-drive':
      case 'google-sheets':
      case 'google-docs': {
        const response = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo', {
          headers: { Authorization: `Bearer ${integration.access_token}` },
        })
        if (!response.ok) return { status: response.status === 401 ? 'expired' : 'invalid' }
        return { status: 'healthy' }
      }

      case 'slack': {
        const response = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${integration.access_token}`,
          },
        })
        if (!response.ok) return { status: 'invalid' }
        const data = await response.json()
        if (!data.ok) {
          if (data.error === 'token_expired' || data.error === 'invalid_auth') {
            return { status: 'expired' }
          }
          return { status: 'invalid', error: data.error }
        }
        return { status: 'healthy' }
      }

      case 'discord': {
        const response = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bearer ${integration.access_token}` },
        })
        if (!response.ok) return { status: response.status === 401 ? 'expired' : 'invalid' }
        return { status: 'healthy' }
      }

      case 'github': {
        const response = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${integration.access_token}`,
            'User-Agent': 'ChainReact-App',
          },
        })
        if (!response.ok) return { status: response.status === 401 ? 'expired' : 'invalid' }
        return { status: 'healthy' }
      }

      case 'notion': {
        const response = await fetch('https://api.notion.com/v1/users/me', {
          headers: {
            Authorization: `Bearer ${integration.access_token}`,
            'Notion-Version': '2022-06-28',
          },
        })
        if (!response.ok) return { status: response.status === 401 ? 'expired' : 'invalid' }
        return { status: 'healthy' }
      }

      default:
        // Unknown providers — assume healthy (can't validate without known endpoint)
        return { status: 'healthy' }
    }
  } catch (error) {
    return { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
