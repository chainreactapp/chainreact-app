import { createAdminClient } from "@/lib/supabase/admin"
import { PostgrestError } from "@supabase/supabase-js"
import { CONNECTED_STATUSES_LIST } from "./connectionStatus"

import { logger } from '@/lib/utils/logger'

interface TokenHealth {
  provider: string
  userId: string
  status: "healthy" | "expiring" | "expired" | "failed"
  expiresAt?: string
  expiresIn?: number
  consecutiveFailures: number
  lastRefresh?: string
  lastFailure?: string
}

/**
 * Monitor token health across all integrations
 */
export async function getTokenHealthReport(): Promise<{
  healthy: TokenHealth[]
  expiring: TokenHealth[]
  expired: TokenHealth[]
  failed: TokenHealth[]
  summary: {
    total: number
    healthy: number
    expiring: number
    expired: number
    failed: number
  }
}> {
  const supabase = createAdminClient()
  if (!supabase) {
    throw new Error("Failed to create Supabase client")
  }

  const { data: integrations, error } = await supabase.from("integrations").select("*").in("status", CONNECTED_STATUSES_LIST)

  if (error) {
    throw new Error(`Failed to fetch integrations: ${error.message}`)
  }

  const now = Math.floor(Date.now() / 1000)
  const report = {
    healthy: [] as TokenHealth[],
    expiring: [] as TokenHealth[],
    expired: [] as TokenHealth[],
    failed: [] as TokenHealth[],
    summary: {
      total: 0,
      healthy: 0,
      expiring: 0,
      expired: 0,
      failed: 0,
    },
  }

  for (const integration of integrations || []) {
    const health: TokenHealth = {
      provider: integration.provider,
      userId: integration.user_id,
      status: "healthy",
      consecutiveFailures: integration.consecutive_failures || 0,
      lastRefresh: integration.last_token_refresh,
      lastFailure: integration.last_failure_at,
    }

    // Check if integration has consecutive failures
    if (integration.consecutive_failures >= 3) {
      health.status = "failed"
      report.failed.push(health)
    } else if (integration.expires_at) {
      const expiresAt = new Date(integration.expires_at).getTime() / 1000
      const expiresIn = expiresAt - now

      health.expiresAt = integration.expires_at
      health.expiresIn = expiresIn

      if (expiresIn <= 0) {
        health.status = "expired"
        report.expired.push(health)
      } else if (expiresIn < 3600) {
        // Expires within 1 hour
        health.status = "expiring"
        report.expiring.push(health)
      } else {
        report.healthy.push(health)
      }
    } else {
      // No expiry info - assume healthy if no failures
      report.healthy.push(health)
    }
  }

  report.summary = {
    total: integrations?.length || 0,
    healthy: report.healthy.length,
    expiring: report.expiring.length,
    expired: report.expired.length,
    failed: report.failed.length,
  }

  return report
}

/**
 * Get integrations that need immediate attention
 */
export async function getIntegrationsNeedingAttention(): Promise<{
  criticallyExpired: TokenHealth[]
  multipleFailures: TokenHealth[]
  recommendations: string[]
}> {
  const report = await getTokenHealthReport()
  const now = Math.floor(Date.now() / 1000)

  const criticallyExpired = report.expired.concat(
    report.expiring.filter((h) => h.expiresIn && h.expiresIn < 300), // Less than 5 minutes
  )

  const multipleFailures = report.failed.filter((h) => h.consecutiveFailures >= 2)

  const recommendations = []

  if (criticallyExpired.length > 0) {
    recommendations.push(`${criticallyExpired.length} integrations are critically expired and need immediate refresh`)
  }

  if (multipleFailures.length > 0) {
    recommendations.push(`${multipleFailures.length} integrations have multiple failures and may need reconnection`)
  }

  if (report.expiring.length > 5) {
    recommendations.push(`${report.expiring.length} integrations are expiring soon - consider running refresh job`)
  }

  return {
    criticallyExpired,
    multipleFailures,
    recommendations,
  }
}

async function getTokenHealthForProvider(provider: string, accessToken: string): Promise<{
  status: "healthy" | "expired" | "invalid" | "error"
  error?: string
  expiresIn?: number
}> {
  try {
    switch (provider) {
      case "google":
      case "gmail":
      case "google-calendar":
      case "google-drive":
      case "google-sheets":
      case "google-docs":
        return await checkGoogleTokenHealth(accessToken)
      
      case "discord":
        return await checkDiscordTokenHealth(accessToken)
      
      case "slack":
        return await checkSlackTokenHealth(accessToken)
      
      case "github":
        return await checkGitHubTokenHealth(accessToken)
      
      case "notion":
        return await checkNotionTokenHealth(accessToken)
      
      default:
        return { status: "healthy" } // Assume healthy for unknown providers
    }
  } catch (error) {
    logger.error(`Error checking token health for ${provider}:`, error)
    return { status: "error", error: error instanceof Error ? error.message : "Unknown error" }
  }
}

async function checkGoogleTokenHealth(accessToken: string) {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v1/tokeninfo", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      if (response.status === 401) {
        return { status: "expired" as const }
      }
      return { status: "invalid" as const }
    }

    const data = await response.json()
    const expiresIn = data.expires_in || 0

    return {
      status: "healthy" as const,
      expiresIn,
    }
  } catch (error) {
    return { status: "error" as const, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

async function checkDiscordTokenHealth(accessToken: string) {
  try {
    const response = await fetch("https://discord.com/api/v10/users/@me", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      if (response.status === 401) {
        return { status: "expired" as const }
      }
      return { status: "invalid" as const }
    }

    return { status: "healthy" as const }
  } catch (error) {
    return { status: "error" as const, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

async function checkSlackTokenHealth(accessToken: string) {
  try {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}` 
      },
    })

    if (!response.ok) {
      return { status: "invalid" as const }
    }

    const data = await response.json()
    if (!data.ok) {
      if (data.error === "token_expired" || data.error === "invalid_auth") {
        return { status: "expired" as const }
      }
      return { status: "invalid" as const }
    }

    return { status: "healthy" as const }
  } catch (error) {
    return { status: "error" as const, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

async function checkGitHubTokenHealth(accessToken: string) {
  try {
    const response = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: { 
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "ChainReact-App"
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        return { status: "expired" as const }
      }
      return { status: "invalid" as const }
    }

    return { status: "healthy" as const }
  } catch (error) {
    return { status: "error" as const, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

async function checkNotionTokenHealth(accessToken: string) {
  try {
    const response = await fetch("https://api.notion.com/v1/users/me", {
      method: "GET",
      headers: { 
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": "2022-06-28"
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        return { status: "expired" as const }
      }
      return { status: "invalid" as const }
    }

    return { status: "healthy" as const }
  } catch (error) {
    return { status: "error" as const, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function checkTokenHealth(integrationIds?: string[]) {
  logger.info("Starting token health check...")
  const supabase = createAdminClient()

  let query = supabase.from("integrations").select("id, provider, user_id, refresh_token, access_token, status, consecutive_failures")

  if (integrationIds && integrationIds.length > 0) {
    query = query.in("id", integrationIds)
  }

  const { data: integrations, error } = await query

  if (error) {
    logger.error("Error fetching integrations:", error)
    return { healthy: 0, unhealthy: 0, results: [] }
  }

  const results = await Promise.all(
    (integrations || []).map(async (integration) => {
      if (!integration.access_token || integration.status !== "connected") {
        return {
          id: integration.id,
          provider: integration.provider,
          userId: integration.user_id,
          status: "invalid" as const,
          error: "No access token or not connected",
        }
      }

      const health = await getTokenHealthForProvider(integration.provider, integration.access_token)
      
      // Update integration status in database if unhealthy
      if (health.status !== "healthy") {
        await supabase
          .from("integrations")
          .update({
            status: health.status === "expired" ? "expired" : "failed",
            last_failure_at: new Date().toISOString(),
            consecutive_failures: (integration.consecutive_failures || 0) + 1,
          })
          .eq("id", integration.id)
      } else {
        // Reset failure count if healthy
        if (integration.consecutive_failures > 0) {
          await supabase
            .from("integrations")
            .update({
              consecutive_failures: 0,
              last_failure_at: null,
            })
            .eq("id", integration.id)
        }
      }

      return {
        id: integration.id,
        provider: integration.provider,
        userId: integration.user_id,
        status: health.status,
        error: health.error,
        expiresIn: health.expiresIn,
      }
    }),
  )

  const healthy = results.filter((r) => r.status === "healthy").length
  const unhealthy = results.length - healthy

  logger.info(`Token health check complete: ${healthy} healthy, ${unhealthy} unhealthy`)

  return { healthy, unhealthy, results }
}
