import { NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import type { NextRequest } from "next/server"
import { getAdminSupabaseClient } from "@/lib/supabase/admin"
import { refreshTokenForProvider } from "@/lib/integrations/tokenRefreshService"
import { classifyOAuthError } from "@/lib/integrations/errorClassificationService"
import {
  computeTransitionAndNotify,
  buildHealthySignal,
  buildFailureSignal,
  type Integration as HealthIntegration,
} from "@/lib/integrations/healthTransitionEngine"

import { logger } from '@/lib/utils/logger'

export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Token Refresh Cron Job
 * 
 * This function runs every 20 minutes to refresh expired or soon-to-expire access tokens.
 * It queries the integrations table for tokens that need refreshing and updates them accordingly.
 */
export async function GET(request: NextRequest) {
  const jobId = `token-refresh-${Date.now()}`
  const startTime = Date.now()

  try {
    // Verify this is a legitimate cron job request
    const cronHeader = request.headers.get("x-vercel-cron")
    const authHeader = request.headers.get("authorization")
    const url = new URL(request.url)
    const querySecret = url.searchParams.get("secret") || url.searchParams.get("cron_secret")
    const expectedSecret = process.env.CRON_SECRET

    if (!expectedSecret) {
      return errorResponse("CRON_SECRET not configured" , 500)
    }

    // Allow either Vercel cron header OR secret authentication
    const providedSecret = authHeader?.replace("Bearer ", "") || querySecret
    const isVercelCron = cronHeader === "1"

    if (!isVercelCron && (!providedSecret || providedSecret !== expectedSecret)) {
      return errorResponse("Unauthorized" , 401)
    }

    logger.info(`🔄 Token refresh job started (Job ID: ${jobId})`)

    // Log development environment warning
    if (process.env.NODE_ENV === 'development') {
      logger.info(`⚠️  Running in DEVELOPMENT environment`)
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const provider = searchParams.get("provider") || undefined
    const limit = parseInt(searchParams.get("limit") || "100", 10)
    const batchSize = parseInt(searchParams.get("batchSize") || "10", 10) // Process in batches of 10 by default
    const offset = parseInt(searchParams.get("offset") || "0", 10) // Support pagination
    const verbose = searchParams.get("verbose") === "true" // Enable verbose logging

    const supabase = getAdminSupabaseClient()
    if (!supabase) {
      return errorResponse("Failed to create database client" , 500)
    }

    // Calculate the threshold for token expiration (10 minutes from now)
    // This gives us time for multiple retry attempts before actual expiration
    const now = new Date()
    const expiryThreshold = new Date(now.getTime() + 10 * 60 * 1000) // 10 minutes

    // Build the query to get integrations with refresh tokens that need refreshing
    // Exclude integrations that already need reauthorization to avoid repeated error logs
    logger.info(`📊 Query parameters:`, {
      provider: provider || 'all',
      limit,
      batchSize,
      offset,
      verbose,
      now: now.toISOString(),
      expiryThreshold: expiryThreshold.toISOString()
    })

    let query = supabase
      .from("integrations")
      .select("*")
      .not("refresh_token", "is", null)
      .neq("status", "needs_reauthorization")
      .or(`expires_at.lt.${now.toISOString()},expires_at.lt.${expiryThreshold.toISOString()}`)

    // Filter by provider if specified
    if (provider) {
      query = query.eq("provider", provider)
      logger.info(`🔍 Filtering by provider: ${provider}`)
    }

    // Add pagination
    query = query.range(offset, offset + limit - 1)
    logger.info(`📄 Pagination: offset=${offset}, limit=${limit}`)

    // Order by expiration time to prioritize tokens that expire soonest
    query = query.order("expires_at", { ascending: true, nullsFirst: false })

    // Execute the query
    let integrations: any[] = []
    try {
      if (verbose) logger.info(`Executing database query to find integrations needing refresh...`)

      const { data, error: fetchError } = await query

      if (fetchError) {
        logger.error(`❌ Error fetching integrations:`, fetchError)
        throw new Error(`Error fetching integrations: ${fetchError.message}`)
      }

      integrations = data || []
      logger.info(`✅ Found ${integrations.length} integrations that need token refresh`)

      if (integrations.length > 0) {
        logger.info(`📋 Integration details:`)
        integrations.forEach((int, idx) => {
          logger.info(`  ${idx + 1}. ${int.provider} (ID: ${int.id.substring(0, 8)}...)`, {
            expires_at: int.expires_at,
            has_refresh_token: !!int.refresh_token,
            status: int.status,
            consecutive_failures: int.consecutive_failures || 0
          })
        })
      }
    } catch (queryError: any) {
      logger.error(`❌ Database query error:`, queryError)
      throw new Error(`Database query error: ${queryError.message}`)
    }

    if (!integrations || integrations.length === 0) {
      const endTime = Date.now()
      const durationMs = endTime - startTime

      return jsonResponse({
        success: true,
        message: "Token refresh job completed - no integrations to process",
        jobId,
        duration: `${durationMs}ms`,
        timestamp: new Date().toISOString(),
      })
    }

    // Process integrations
    logger.info(`🔧 Processing ${integrations.length} integrations...`)

    let successful = 0
    let failed = 0
    const results = []
    const failureReasons: Record<string, number> = {}

    // Process integrations in batches to avoid overwhelming the system
    const batches = []
    for (let i = 0; i < integrations.length; i += batchSize) {
      batches.push(integrations.slice(i, i + batchSize))
    }

    logger.info(`📦 Processing in ${batches.length} batches of up to ${batchSize} integrations each`)

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]
      logger.info(`📦 Processing batch ${batchIndex + 1} of ${batches.length} (${batch.length} integrations)`)
      
      // Process each integration in the batch
      for (const integration of batch) {
        try {
          if (verbose) {
            logger.info(
              `Processing ${integration.provider} for user ${integration.user_id}`
            )
          }

          // Always update the last_refresh_attempt timestamp
          await supabase
            .from("integrations")
            .update({ last_refresh_attempt: now.toISOString() })
            .eq("id", integration.id)

          // Skip if no refresh token
          if (!integration.refresh_token) {
            if (verbose) logger.info(`Skipping ${integration.provider} - no refresh token`)

            // Check if the token is expired and update status if needed
            // IMPORTANT: Add 10-minute grace period to avoid premature marking
            // Only mark as expired if token has been expired for >10 minutes
            if (integration.expires_at) {
              const expiresAt = new Date(integration.expires_at)
              const gracePeriodMinutes = 10
              const gracePeriodMs = gracePeriodMinutes * 60 * 1000
              const expiredWithGrace = now.getTime() > (expiresAt.getTime() + gracePeriodMs)

              if (expiredWithGrace) {
                if (verbose) logger.info(`${integration.provider} has been expired for >${gracePeriodMinutes} minutes without refresh token - marking as needs_reauthorization`)

                await supabase
                  .from("integrations")
                  .update({
                    status: "needs_reauthorization",
                    disconnect_reason: "Access token expired and no refresh token available"
                  })
                  .eq("id", integration.id)
              } else if (verbose) {
                const minutesUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (60 * 1000))
                logger.info(`${integration.provider} expires in ${minutesUntilExpiry} minutes or expired <${gracePeriodMinutes} min ago - not marking yet`)
              }
            }

            continue
          }

          // Refresh the token
          const refreshResult = await refreshTokenForProvider(
            integration.provider,
            integration.refresh_token,
            integration,
            { verbose }
          )

          if (refreshResult.success) {
            successful++

            // Update the token in the database
            const updateData: Record<string, any> = {
              access_token: refreshResult.accessToken,
              updated_at: now.toISOString(),
              last_refresh_success: now.toISOString(),
              consecutive_failures: 0,
              consecutive_transient_failures: 0,
              disconnect_reason: null,
              status: "connected",
            }

            if (refreshResult.refreshToken) {
              updateData.refresh_token = refreshResult.refreshToken
            }

            if (refreshResult.accessTokenExpiresIn) {
              updateData.expires_at = new Date(now.getTime() + refreshResult.accessTokenExpiresIn * 1000).toISOString()
            }

            const { error: updateError } = await supabase
              .from("integrations")
              .update(updateData)
              .eq("id", integration.id)

            if (updateError) {
              logger.error(`Error updating integration after successful refresh:`, updateError)
            } else if (verbose) {
              logger.info(`Successfully refreshed ${integration.provider}`)
            }

            // Feed healthy signal to transition engine
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
            await computeTransitionAndNotify(
              supabase,
              healthIntegration,
              buildHealthySignal('token_refresh')
            )

            results.push({
              id: integration.id,
              provider: integration.provider,
              success: true,
            })
          } else {
            failed++

            // Track failure reasons
            const reason = refreshResult.error || "Unknown error"
            failureReasons[reason] = (failureReasons[reason] || 0) + 1

            // Get current failure counts
            const { data } = await supabase
              .from("integrations")
              .select("consecutive_failures, consecutive_transient_failures")
              .eq("id", integration.id)
              .single()

            // Separate transient vs permanent failures
            const isTransient = refreshResult.isTransientFailure || false
            const currentAuthFailures = data?.consecutive_failures || 0
            const currentTransientFailures = data?.consecutive_transient_failures || 0

            let newAuthFailures = currentAuthFailures
            let newTransientFailures = currentTransientFailures

            if (isTransient) {
              // Transient failure (rate limit, network error, 5xx)
              newTransientFailures = currentTransientFailures + 1
              if (verbose) {
                logger.info(`${integration.provider}: Transient failure #${newTransientFailures} (rate limit/network)`)
              }
            } else {
              // Permanent auth failure
              newAuthFailures = currentAuthFailures + 1
              if (verbose) {
                logger.info(`${integration.provider}: Auth failure #${newAuthFailures} (permanent)`)
              }
            }

            // Determine if we should mark as needs_reauthorization
            const shouldMarkDisconnected =
              refreshResult.invalidRefreshToken ||
              refreshResult.needsReauthorization ||
              newAuthFailures >= 3

            // Update the integration with error details
            const updateData: Record<string, any> = {
              consecutive_failures: newAuthFailures,
              consecutive_transient_failures: newTransientFailures,
              disconnect_reason: refreshResult.error || "Unknown error during token refresh",
              last_failure_at: now.toISOString(),
            }

            if (shouldMarkDisconnected) {
              updateData.status = "needs_reauthorization"
            }

            const { error: updateError } = await supabase
              .from("integrations")
              .update(updateData)
              .eq("id", integration.id)

            if (updateError) {
              logger.error(`Error updating integration after failed refresh:`, updateError)
            } else if (verbose) {
              logger.info(`Failed to refresh ${integration.provider}: ${refreshResult.error}`)
            }

            // Feed failure signal to transition engine (single decision-maker)
            try {
              const classifiedError = classifyOAuthError(
                integration.provider,
                refreshResult.statusCode || 0,
                { error: refreshResult.error, message: refreshResult.error }
              )

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

              const transitionResult = await computeTransitionAndNotify(
                supabase,
                healthIntegration,
                buildFailureSignal(classifiedError, 'token_refresh')
              )

              if (transitionResult.notified) {
                logger.info(`[TokenRefresh] Notification sent for ${integration.provider}: ${transitionResult.milestone}`)
              }
            } catch (notificationError: any) {
              logger.error(`Failed to process health transition for ${integration.provider}:`, notificationError)
            }

            results.push({
              id: integration.id,
              provider: integration.provider,
              success: false,
              error: refreshResult.error,
            })
          }
        } catch (error: any) {
          failed++
          logger.error(`Error processing ${integration.provider}:`, error)

          // Track failure reasons
          const reason = `Unexpected error: ${error.message}`
          failureReasons[reason] = (failureReasons[reason] || 0) + 1

          // Update integration with error details
          const { error: updateError } = await supabase
            .from("integrations")
            .update({
              consecutive_failures: (integration.consecutive_failures || 0) + 1,
              disconnect_reason: `Unexpected error: ${error.message}`,
              last_failure_at: now.toISOString(),
              // Only update status if we've hit too many consecutive failures
              ...(integration.consecutive_failures >= 2 ? { status: "needs_reauthorization" } : {})
            })
            .eq("id", integration.id)

          if (updateError) {
            logger.error(`❌ Error updating integration after exception:`, updateError)
          }

          results.push({
            id: integration.id,
            provider: integration.provider,
            success: false,
            error: error.message,
          })
        }
      }
      
      // Add a small delay between batches to avoid overwhelming external APIs
      if (batchIndex < batches.length - 1) {
        if (verbose) logger.info(`Pausing briefly between batches...`)
        await new Promise(resolve => setTimeout(resolve, 1000)) // 1 second delay between batches
      }
    }

    const endTime = Date.now()
    const durationMs = endTime - startTime
    const duration = durationMs / 1000

    // Create provider statistics
    const providerStats: Record<string, { success: number; failed: number }> = {}
    results.forEach(result => {
      if (!providerStats[result.provider]) {
        providerStats[result.provider] = { success: 0, failed: 0 }
      }
      if (result.success) {
        providerStats[result.provider].success++
      } else {
        providerStats[result.provider].failed++
      }
    })

    // Log comprehensive summary
    logger.info(`📊 Token refresh job completed in ${duration.toFixed(2)}s`)
    logger.info(`   ✅ Successful: ${successful}`)
    logger.info(`   ❌ Failed: ${failed}`)
    logger.info(`   📝 Total processed: ${integrations.length}`)

    // Log provider breakdown
    if (Object.keys(providerStats).length > 0) {
      logger.info(`   📈 Provider breakdown:`)
      Object.entries(providerStats)
        .sort(([, a], [, b]) => (b.success + b.failed) - (a.success + a.failed))
        .forEach(([provider, stats]) => {
          const total = stats.success + stats.failed
          const successRate = total > 0 ? ((stats.success / total) * 100).toFixed(0) : '0'
          logger.info(`      ${provider}: ${stats.success}/${total} (${successRate}% success)`)
        })
    }

    // Log failure reasons if any
    if (failed > 0) {
      logger.info(`   🔍 Failure reasons:`)
      Object.entries(failureReasons)
        .sort(([, a], [, b]) => b - a)
        .forEach(([reason, count]) => {
          logger.info(`      ${count}x ${reason}`)
        })
    }
    
    // Fix any integrations that have successful refreshes but incorrect statuses
    try {
      const { data: statusFixResult } = await supabase.rpc('fix_integration_statuses', {
        threshold_minutes: 60 // Consider refreshes in the last hour
      })
      
      const fixedCount = statusFixResult?.count || 0;
      if (fixedCount > 0) {
        logger.info(`Fixed statuses for ${fixedCount} integrations with recent successful refreshes`)
      }
    } catch (error) {
      logger.error(`Could not run status fix procedure:`, error)
    }

    return jsonResponse({
      success: true,
      message: `Token refresh finished in ${duration.toFixed(2)}s. ${successful} succeeded, ${failed} failed.`,
      jobId,
      duration_seconds: duration,
      stats: {
        processed: integrations.length,
        successful,
        failed,
      },
      results: results.slice(0, 10), // Limit results in response
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    logger.error(`Critical error in token refresh job:`, error)

    const endTime = Date.now()
    const durationMs = endTime - startTime

    return jsonResponse(
      {
        success: false,
        error: "Failed to complete token refresh job",
        details: error.message,
        duration: `${durationMs}ms`,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
} 