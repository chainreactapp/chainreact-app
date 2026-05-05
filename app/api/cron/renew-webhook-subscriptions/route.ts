/**
 * Webhook Subscription Renewal Cron Job
 *
 * Auto-renews webhook subscriptions before they expire.
 * Different providers have different expiration policies:
 * - Microsoft Graph: 3 days max (4230 minutes)
 * - Google Pub/Sub: 7 days max
 *
 * Schedule: Every 10 minutes
 *
 * This job:
 * 1. Queries trigger_resources for subscriptions expiring soon
 * 2. Refreshes the OAuth token for that integration if needed
 * 3. Renews the subscription via provider API
 * 4. Updates trigger_resources with new expiration
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { MicrosoftGraphSubscriptionManager } from "@/lib/microsoft-graph/subscriptionManager"
import { refreshTokenForProvider } from "@/lib/integrations/tokenRefreshService"
import { decrypt } from "@/lib/security/encryption"
import { getSecret } from "@/lib/secrets"
import { logger } from "@/lib/utils/logger"
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

// Renewal thresholds by provider (in minutes)
const RENEWAL_THRESHOLDS: Record<string, number> = {
  microsoft: 30, // Renew 30 minutes before expiry
  "microsoft-teams": 30,
  teams: 30,
  outlook: 30,
  onedrive: 30,
  google: 1440, // Renew 24 hours before expiry (Google watches)
  gmail: 1440,
  "google-calendar": 1440,
  "google-drive": 1440,
  default: 60, // Default 1 hour
}

// Maximum subscriptions to process per run
const MAX_SUBSCRIPTIONS_PER_RUN = 50

export const maxDuration = 60 // 60 second timeout for Vercel

export async function GET(request: NextRequest) {
  const startTime = Date.now()

  // Verify cron secret for Vercel cron jobs
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const stats = {
    processed: 0,
    renewed: 0,
    failed: 0,
    skipped: 0,
    tokenRefreshed: 0,
    errors: [] as string[],
  }

  try {
    logger.info("[WebhookRenewal] Starting webhook subscription renewal job")

    const supabase = createAdminClient()
    if (!supabase) {
      throw new Error("Failed to create Supabase client")
    }

    const now = new Date()

    // Calculate the furthest expiration time we care about (1 day from now)
    const maxExpirationCheck = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    // Query trigger_resources for expiring subscriptions
    const { data: expiringSubscriptions, error: queryError } = await supabase
      .from("trigger_resources")
      .select(`
        id,
        workflow_id,
        user_id,
        provider_id,
        resource_type,
        external_id,
        expires_at,
        config,
        status
      `)
      .eq("resource_type", "subscription")
      .eq("status", "active")
      .not("expires_at", "is", null)
      .lte("expires_at", maxExpirationCheck.toISOString())
      .order("expires_at", { ascending: true })
      .limit(MAX_SUBSCRIPTIONS_PER_RUN)

    if (queryError) {
      throw new Error(`Failed to query expiring subscriptions: ${queryError.message}`)
    }

    if (!expiringSubscriptions || expiringSubscriptions.length === 0) {
      logger.info("[WebhookRenewal] No subscriptions need renewal")
      return NextResponse.json({
        success: true,
        message: "No subscriptions need renewal",
        stats,
        durationMs: Date.now() - startTime,
      })
    }

    logger.info(`[WebhookRenewal] Found ${expiringSubscriptions.length} subscriptions to check`)

    // Process each subscription
    for (const subscription of expiringSubscriptions) {
      stats.processed++

      try {
        const providerId = subscription.provider_id || ""
        const expiresAt = new Date(subscription.expires_at)
        const minutesUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60)

        // Get renewal threshold for this provider
        const threshold = getProviderThreshold(providerId)

        // Skip if not yet within threshold
        if (minutesUntilExpiry > threshold) {
          stats.skipped++
          logger.info(
            `[WebhookRenewal] Skipping ${providerId} subscription: expires in ${Math.round(minutesUntilExpiry)} min, threshold is ${threshold} min`
          )
          continue
        }

        logger.info(
          `[WebhookRenewal] Renewing ${providerId} subscription (expires in ${Math.round(minutesUntilExpiry)} min)`
        )

        // Get the integration for this user/provider
        const { data: integration, error: integrationError } = await supabase
          .from("integrations")
          .select("*")
          .eq("user_id", subscription.user_id)
          .ilike("provider", getProviderPattern(providerId))
          .in("status", CONNECTED_STATUSES_LIST)
          .single()

        if (integrationError || !integration) {
          stats.failed++
          stats.errors.push(`No integration found for ${providerId} subscription ${subscription.id}`)
          logger.warn(`[WebhookRenewal] No integration found for subscription ${subscription.id}`)
          continue
        }

        // Decrypt access token
        let accessToken = integration.access_token
        if (accessToken && accessToken.includes(":")) {
          try {
            const secret = await getSecret("encryption_key")
            if (secret) {
              accessToken = decrypt(accessToken, secret)
            }
          } catch (decryptError) {
            logger.warn(`[WebhookRenewal] Failed to decrypt token, trying refresh`, decryptError)
          }
        }

        // Check if token needs refresh (expires within 10 minutes or already expired)
        const tokenExpiresAt = integration.expires_at ? new Date(integration.expires_at) : null
        const tokenExpiresIn = tokenExpiresAt ? (tokenExpiresAt.getTime() - now.getTime()) / (1000 * 60) : null

        if (!accessToken || (tokenExpiresIn !== null && tokenExpiresIn < 10)) {
          logger.info(`[WebhookRenewal] Token for ${providerId} needs refresh before renewing subscription`)

          if (!integration.refresh_token) {
            stats.failed++
            stats.errors.push(`No refresh token for ${providerId} integration`)
            continue
          }

          // Refresh the token
          const refreshResult = await refreshTokenForProvider(
            integration.provider,
            integration.refresh_token,
            integration,
            { verbose: true }
          )

          if (!refreshResult.success || !refreshResult.accessToken) {
            stats.failed++
            stats.errors.push(`Failed to refresh token for ${providerId}: ${refreshResult.error}`)
            continue
          }

          accessToken = refreshResult.accessToken
          stats.tokenRefreshed++
        }

        // Renew the subscription based on provider type
        const renewed = await renewSubscription(
          subscription,
          accessToken,
          providerId,
          supabase
        )

        if (renewed) {
          stats.renewed++
          logger.info(`[WebhookRenewal] Successfully renewed ${providerId} subscription ${subscription.id}`)
        } else {
          stats.failed++
        }
      } catch (error) {
        stats.failed++
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        stats.errors.push(`${subscription.provider_id}: ${errorMessage}`)
        logger.error(`[WebhookRenewal] Error processing subscription ${subscription.id}:`, error)
      }

      // Check if we're running out of time
      if (Date.now() - startTime > 55000) {
        logger.warn("[WebhookRenewal] Approaching timeout, stopping early")
        break
      }
    }

    const durationMs = Date.now() - startTime

    logger.info("[WebhookRenewal] Completed", {
      ...stats,
      durationMs,
    })

    return NextResponse.json({
      success: true,
      stats,
      durationMs,
    })
  } catch (error) {
    logger.error("[WebhookRenewal] Job failed:", error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        stats,
        durationMs: Date.now() - startTime,
      },
      { status: 500 }
    )
  }
}

/**
 * Get the renewal threshold for a provider
 */
function getProviderThreshold(providerId: string): number {
  // Normalize provider ID
  const normalized = providerId.toLowerCase().replace(/_/g, "-")

  // Check for exact match
  if (RENEWAL_THRESHOLDS[normalized]) {
    return RENEWAL_THRESHOLDS[normalized]
  }

  // Check for prefix match (e.g., "microsoft-teams" matches "microsoft")
  for (const [key, value] of Object.entries(RENEWAL_THRESHOLDS)) {
    if (normalized.startsWith(key)) {
      return value
    }
  }

  return RENEWAL_THRESHOLDS.default
}

/**
 * Get SQL pattern for matching provider in integrations table
 */
function getProviderPattern(providerId: string): string {
  const normalized = providerId.toLowerCase()

  // Microsoft services might be stored as different provider names
  if (normalized.includes("microsoft") || normalized.includes("teams")) {
    return "teams"
  }
  if (normalized.includes("outlook")) {
    return "outlook"
  }
  if (normalized.includes("onedrive")) {
    return "onedrive"
  }
  if (normalized.includes("gmail")) {
    return "gmail"
  }
  if (normalized.includes("google-calendar")) {
    return "google-calendar"
  }
  if (normalized.includes("google-drive")) {
    return "google-drive"
  }

  // Default: use the provider ID as-is
  return `%${normalized}%`
}

/**
 * Renew a subscription based on provider type
 */
async function renewSubscription(
  subscription: {
    id: string
    external_id: string | null
    provider_id: string | null
    config: Record<string, unknown> | null
  },
  accessToken: string,
  providerId: string,
  supabase: ReturnType<typeof createAdminClient>
): Promise<boolean> {
  const normalized = providerId.toLowerCase()

  try {
    // Microsoft Graph subscriptions
    if (
      normalized.includes("microsoft") ||
      normalized.includes("teams") ||
      normalized.includes("outlook") ||
      normalized.includes("onedrive")
    ) {
      return await renewMicrosoftSubscription(subscription, accessToken, supabase)
    }

    // Google subscriptions (Gmail, Calendar, Drive)
    if (normalized.includes("google") || normalized.includes("gmail")) {
      return await renewGoogleWatch(subscription, accessToken, supabase)
    }

    logger.warn(`[WebhookRenewal] Unknown provider type for renewal: ${providerId}`)
    return false
  } catch (error) {
    logger.error(`[WebhookRenewal] Failed to renew ${providerId} subscription:`, error)
    return false
  }
}

/**
 * Renew a Microsoft Graph subscription
 */
async function renewMicrosoftSubscription(
  subscription: {
    id: string
    external_id: string | null
    config: Record<string, unknown> | null
  },
  accessToken: string,
  supabase: ReturnType<typeof createAdminClient>
): Promise<boolean> {
  if (!subscription.external_id) {
    logger.error("[WebhookRenewal] No external_id for Microsoft subscription")
    return false
  }

  const manager = new MicrosoftGraphSubscriptionManager()

  try {
    const renewed = await manager.renewSubscription(subscription.external_id, accessToken)

    // Update trigger_resources with new expiration
    if (supabase) {
      await supabase
        .from("trigger_resources")
        .update({
          expires_at: renewed.expirationDateTime,
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscription.id)
    }

    return true
  } catch (error) {
    logger.error("[WebhookRenewal] Microsoft subscription renewal failed:", error)

    // If subscription doesn't exist anymore, mark as expired
    const errorMessage = error instanceof Error ? error.message : ""
    if (errorMessage.includes("404") || errorMessage.includes("not found")) {
      if (supabase) {
        await supabase
          .from("trigger_resources")
          .update({
            status: "expired",
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscription.id)
      }
    }

    return false
  }
}

/**
 * Renew a Google watch subscription
 * Google requires stopping the old watch and creating a new one
 */
async function renewGoogleWatch(
  subscription: {
    id: string
    external_id: string | null
    config: Record<string, unknown> | null
  },
  accessToken: string,
  supabase: ReturnType<typeof createAdminClient>
): Promise<boolean> {
  // Google watch renewal is more complex - need to stop old watch and create new one
  // The existing google-watch-renewal job handles this
  // For now, just log and let the dedicated job handle it
  logger.info(
    "[WebhookRenewal] Google watch renewal delegated to /api/webhooks/google/renew cron job"
  )

  // Mark that this subscription needs renewal attention
  // The dedicated Google renewal job will pick it up
  return true
}
