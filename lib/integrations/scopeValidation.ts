import { db } from "@/lib/db"
import {
  INTEGRATION_SCOPES,
  validateScopes,
  getAllScopes,
  isKnownProvider,
} from "./integrationScopes"
import { getBaseUrl } from "@/lib/utils/getBaseUrl"
import { CONNECTED_STATUSES_LIST } from "./connectionStatus"

import { logger } from '@/lib/utils/logger'

function getOAuthRedirectUri(provider: string): string {
  const baseUrl = getBaseUrl()
  return `${baseUrl}/api/integrations/${provider}/callback`
}

export interface ScopeValidationResult {
  provider: string
  valid: boolean
  missing: string[]
  granted: string[]
  status: "valid" | "invalid" | "partial"
  lastChecked: string
}

export async function validateIntegrationScopes(
  userId: string,
  provider: string,
  grantedScopes: string[],
): Promise<ScopeValidationResult> {
  // For Discord, use the updated required scopes
  let validation: {
    valid: boolean
    missing: string[]
    granted: string[]
    status: "valid" | "invalid" | "partial"
  }
  if (provider === "discord") {
    const requiredScopes = ["identify", "guilds", "guilds.join", "messages.read"]
    const missing = requiredScopes.filter((scope) => !grantedScopes.includes(scope))
    validation = {
      valid: missing.length === 0,
      missing,
      granted: grantedScopes.filter((scope) => requiredScopes.includes(scope)),
      status: (missing.length === 0
        ? "valid"
        : missing.length === requiredScopes.length
          ? "invalid"
          : "partial"),
    }
  } else {
    validation = validateScopes(provider, grantedScopes)
  }

  // Update the integration record with validation results
  try {
    await db
      .from("integrations")
      .update({
        granted_scopes: grantedScopes,
        missing_scopes: validation.missing,
        scope_validation_status: validation.status,
        last_scope_check: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("provider", provider)
  } catch (error) {
    logger.error("Failed to update integration scope validation:", error)
  }

  return {
    provider,
    valid: validation.valid,
    missing: validation.missing,
    granted: validation.granted,
    status: validation.status,
    lastChecked: new Date().toISOString(),
  }
}

export async function validateAllUserIntegrations(userId: string): Promise<ScopeValidationResult[]> {
  const { data: integrations } = await db
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .in("status", CONNECTED_STATUSES_LIST)

  if (!integrations) return []

  const results: ScopeValidationResult[] = []

  for (const integration of integrations) {
    if (!integration.granted_scopes) continue

    const result = await validateIntegrationScopes(userId, integration.provider, integration.granted_scopes)
    results.push(result)
  }

  return results
}

export function generateReconnectionUrl(provider: string, state?: string): string {
  if (provider === "discord") {
    // Updated Discord scopes
    const requiredScopes = [
      "identify",
      "email",
      "connections",
      "guilds",
      "guilds.members.read",
      "guilds.messages.read",
      "webhook.incoming"
    ]
    const redirectUri = "https://chainreact.app/api/integrations/discord/callback"

    const discordParams = new URLSearchParams({
      client_id: "1378595955212812308",
      scope: requiredScopes.join(" "),
      redirect_uri: redirectUri,
      response_type: "code",
      prompt: "consent", // Force re-authorization
      ...(state && { state }),
    })
    return `https://discord.com/api/oauth2/authorize?${discordParams.toString()}`
  }

  if (!isKnownProvider(provider)) {
    throw new Error(`Unsupported provider: ${provider}`)
  }
  const config = INTEGRATION_SCOPES[provider]
  if (!config) {
    throw new Error(`Unsupported provider: ${provider}`)
  }

  const allScopes = getAllScopes(provider)
  const redirectUri = getOAuthRedirectUri(provider)

  switch (provider) {
    case "slack":
      const slackParams = new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        scope: allScopes.join(","),
        redirect_uri: redirectUri,
        response_type: "code",
        ...(state && { state }),
      })
      return `https://slack.com/oauth/v2/authorize?${slackParams.toString()}`

    case "google":
      const googleParams = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        scope: allScopes.join(" "),
        redirect_uri: redirectUri,
        response_type: "code",
        access_type: "offline",
        prompt: "consent",
        ...(state && { state }),
      })
      return `https://accounts.google.com/o/oauth2/v2/auth?${googleParams.toString()}`

    case "github":
      const githubParams = new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID!,
        scope: allScopes.join(" "),
        redirect_uri: redirectUri,
        ...(state && { state }),
      })
      return `https://github.com/login/oauth/authorize?${githubParams.toString()}`

    case "dropbox":
      const dropboxParams = new URLSearchParams({
        client_id: process.env.DROPBOX_CLIENT_ID!,
        scope: allScopes.join(" "),
        redirect_uri: redirectUri,
        response_type: "code",
        token_access_type: "offline",
        ...(state && { state }),
      })
      return `https://www.dropbox.com/oauth2/authorize?${dropboxParams.toString()}`

    case "box":
      const boxParams = new URLSearchParams({
        client_id: process.env.BOX_CLIENT_ID!,
        scope: allScopes.join(" "),
        redirect_uri: redirectUri,
        response_type: "code",
        ...(state && { state }),
      })
      return `https://app.box.com/api/oauth2/authorize?${boxParams.toString()}`

    case "microsoft-outlook":
      const outlookParams = new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        scope: allScopes.join(" "),
        redirect_uri: redirectUri,
        response_type: "code",
        prompt: "consent", // Force re-authorization
        ...(state && { state }),
      })
      return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${outlookParams.toString()}`

    default:
      throw new Error(`Reconnection URL generation not implemented for provider: ${provider}`)
  }
}

export async function checkIntegrationHealth(
  userId: string,
  provider: string,
): Promise<{
  connected: boolean
  scopesValid: boolean
  lastChecked: string
  issues: string[]
}> {
  try {
    const { data: integration } = await db
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", provider)
      .single()

    if (!integration) {
      return {
        connected: false,
        scopesValid: false,
        lastChecked: new Date().toISOString(),
        issues: ["Integration not found"],
      }
    }

    const issues: string[] = []

    // Check if token exists
    if (!integration.access_token) {
      issues.push("Access token missing")
    }

    // Check if token is expired
    if (integration.expires_at && integration.expires_at < Date.now() / 1000) {
      issues.push("Access token expired")
    }

    // Check scope validation
    const scopesValid = integration.scope_validation_status === "valid"
    if (!scopesValid) {
      issues.push("Missing required permissions")
    }

    return {
      connected: integration.is_active && issues.length === 0,
      scopesValid,
      lastChecked: integration.last_scope_check || integration.updated_at,
      issues,
    }
  } catch (error) {
    logger.error("Failed to check integration health:", error)
    return {
      connected: false,
      scopesValid: false,
      lastChecked: new Date().toISOString(),
      issues: ["Health check failed"],
    }
  }
}

/**
 * Validates the scopes for an integration and updates the database accordingly
 *
 * @param integrationId The ID of the integration to validate
 * @param grantedScopes Array of scopes granted by the OAuth provider
 * @returns Object containing validation results
 */
export async function validateAndUpdateIntegrationScopes(
  integrationId: string,
  grantedScopes: string[],
): Promise<{
  valid: boolean
  missing: string[]
  granted: string[]
  status: "valid" | "invalid" | "partial"
  integration: any
}> {
  const { data: integration, error } = await db
    .from("integrations")
    .select("*")
    .eq("id", integrationId)
    .single()

  if (error || !integration) {
    throw new Error(`Integration with ID ${integrationId} not found`)
  }

  const validation = validateScopes(integration.provider, grantedScopes)

  // Update integration record
  await db
    .from("integrations")
    .update({
      granted_scopes: grantedScopes,
      missing_scopes: validation.missing,
      scope_validation_status: validation.status,
      last_scope_check: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", integrationId)

  return {
    integration,
    valid: validation.valid,
    missing: validation.missing,
    granted: validation.granted,
    status: validation.status,
  }
}

/**
 * Validates all integrations for a user
 *
 * @param userId The user ID to validate integrations for
 * @returns Array of validation results
 */
export async function validateAllIntegrations(userId: string): Promise<any[]> {
  // Get all connected integrations for the user
  const { data: integrations, error } = await db
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .in("status", CONNECTED_STATUSES_LIST)

  if (error || !integrations) {
    throw new Error(`Failed to fetch integrations: ${error?.message || "Unknown error"}`)
  }

  // Validate scopes for all integrations
  const validationResults = await Promise.all(
    integrations.map(async (integration: any) => {
      const result = validateScopes(integration.provider, integration.granted_scopes || [])
      return {
        ...integration,
        scopeValidation: result,
      }
    }),
  )

  // Further checks or updates can be done here...

  return validationResults
}
