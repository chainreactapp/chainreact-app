/**
 * Token Refresh Service
 *
 * This module provides functions to refresh OAuth tokens across different providers
 * using a centralized, configuration-driven approach.
 */

import type { Integration } from "@/types/integration"
import { getOAuthConfig, getOAuthClientCredentials } from "./oauthConfig"
import fetch from "node-fetch"
import { getBaseUrl } from "@/lib/utils/getBaseUrl"
import { decrypt, encrypt } from "@/lib/security/encryption"
import { getSecret } from "@/lib/secrets"
import { classifyOAuthError, type ClassifiedError } from "./errorClassificationService"
import { createAdminClient } from "@/lib/supabase/admin"

import { logger } from '@/lib/utils/logger'

// Standard response for token refresh operations
export interface RefreshResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  accessTokenExpiresIn?: number // Seconds until access token expiration
  refreshTokenExpiresIn?: number // Seconds until refresh token expiration
  error?: string
  statusCode?: number
  providerResponse?: any
  invalidRefreshToken?: boolean
  needsReauthorization?: boolean
  scope?: string
  isTransientFailure?: boolean // True for rate limits, network errors, 5xx errors
  classifiedError?: ClassifiedError // Enhanced error classification
}


/**
 * Determines if a token should be refreshed based on expiration times and other factors
 */
export function shouldRefreshToken(
  integration: Integration,
  options: { accessTokenExpiryThreshold?: number; refreshTokenExpiryThreshold?: number },
): { shouldRefresh: boolean; reason: string } {
  const now = new Date()
  const accessThreshold = options.accessTokenExpiryThreshold || 30 // Default 30 minutes
  const refreshThreshold = options.refreshTokenExpiryThreshold || 60 // Default 60 minutes

  // Check access token expiration
  if (integration.expires_at) {
    const expiresAt = new Date(integration.expires_at)
    const minutesUntilExpiration = (expiresAt.getTime() - now.getTime()) / (1000 * 60)

    if (minutesUntilExpiration <= accessThreshold) {
      return {
        shouldRefresh: true,
        reason: `Access token expires in ${Math.max(0, Math.round(minutesUntilExpiration))} minutes`,
      }
    }
  } else {
    // No expiration is set, we should refresh to be safe
    return { shouldRefresh: true, reason: "No access token expiration set" }
  }

  // Check refresh token expiration if applicable
  if (integration.refresh_token_expires_at) {
    const refreshExpiresAt = new Date(integration.refresh_token_expires_at)
    const minutesUntilRefreshExpiration = (refreshExpiresAt.getTime() - now.getTime()) / (1000 * 60)

    if (minutesUntilRefreshExpiration <= refreshThreshold) {
      return {
        shouldRefresh: true,
        reason: `Refresh token expires in ${Math.max(0, Math.round(minutesUntilRefreshExpiration))} minutes`,
      }
    }
  }

  // No refresh needed
  return { shouldRefresh: false, reason: "Tokens are still valid" }
}

/**
 * Refresh a token for a specific provider
 */
export async function refreshTokenForProvider(
  provider: string,
  refreshToken: string,
  integration: Integration,
  options: { verbose?: boolean } = {}
): Promise<RefreshResult> {
  const verbose = options.verbose ?? false;

  logger.info(`🔄 Starting token refresh for ${provider} (ID: ${integration.id?.substring(0, 8)}...)`, {
    has_refresh_token: !!refreshToken,
    refresh_token_length: refreshToken?.length,
    integration_status: integration.status,
    expires_at: integration.expires_at,
    consecutive_failures: integration.consecutive_failures || 0
  })

  try {
    // Decrypt the refresh token if it appears to be encrypted
    let decryptedRefreshToken = refreshToken
    if (refreshToken.includes(":")) {
      try {
        const secret = await getSecret("encryption_key")
        if (!secret) {
          logger.error(`❌ ${provider}: Encryption secret is not configured`)
          throw new Error("Encryption secret is not configured")
        }

        logger.info(`🔐 ${provider}: Decrypting refresh token (length: ${refreshToken.length})`)
        decryptedRefreshToken = decrypt(refreshToken, secret)
        logger.info(`✅ ${provider}: Token decrypted successfully (new length: ${decryptedRefreshToken.length})`)
      } catch (error: any) {
        logger.error(`Decryption error:`, error)
        
        // Check for specific decryption errors
        if (error.code === 'ERR_CRYPTO_INVALID_IV') {
          return {
            success: false,
            error: `Failed to decrypt refresh token: Invalid initialization vector. The token may be corrupted or encrypted with a different key.`,
            needsReauthorization: true
          }
        } else if (error.message.includes('Invalid initialization vector')) {
          return {
            success: false,
            error: `Failed to decrypt refresh token: Invalid initialization vector. The token may be corrupted or encrypted with a different key.`,
            needsReauthorization: true
          }
        } 
          return {
            success: false,
            error: `Failed to decrypt refresh token: ${error.message}`,
            needsReauthorization: true
          }
        
      }
    } else {
      logger.info(`ℹ️  ${provider}: Refresh token does not appear to be encrypted`)
    }

    const config = getOAuthConfig(provider)

    if (!config) {
      logger.error(`❌ ${provider}: No OAuth config found for this provider`)
      return { success: false, error: `No OAuth config found for provider: ${provider}` }
    }

    logger.info(`✅ ${provider}: Found OAuth config`, {
      tokenEndpoint: config.tokenEndpoint,
      authMethod: config.authMethod,
      hasScope: !!config.scope,
      refreshRequiresClientAuth: config.refreshRequiresClientAuth,
      sendScopeWithRefresh: config.sendScopeWithRefresh,
      sendRedirectUriWithRefresh: config.sendRedirectUriWithRefresh
    })

    // Special handling for Microsoft services to ensure they use the correct client credentials
    let clientId: string | undefined
    let clientSecret: string | undefined
    
    if (provider === "teams") {
      clientId = process.env.TEAMS_CLIENT_ID
      clientSecret = process.env.TEAMS_CLIENT_SECRET
      if (!clientId || !clientSecret) {
        return { 
          success: false, 
          error: `Teams client credentials not configured. Please set TEAMS_CLIENT_ID and TEAMS_CLIENT_SECRET.` 
        }
      }
    } else if (provider === "onedrive") {
      clientId = process.env.ONEDRIVE_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID
      clientSecret = process.env.ONEDRIVE_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET
    } else if (provider === "microsoft-outlook") {
      clientId = process.env.OUTLOOK_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID
      clientSecret = process.env.OUTLOOK_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET
    } else if (provider === "microsoft-onenote") {
      clientId = process.env.ONENOTE_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID
      clientSecret = process.env.ONENOTE_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET
    } else if (provider === "microsoft-excel") {
      clientId = process.env.EXCEL_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID
      clientSecret = process.env.EXCEL_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET
    } else {
      // Use the standard OAuth config for other providers
      const credentials = getOAuthClientCredentials(config)
      clientId = credentials.clientId
      clientSecret = credentials.clientSecret
    }

    if (!clientId || !clientSecret) {
      logger.error(`❌ ${provider}: Missing client credentials`, {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        provider
      })
      return { success: false, error: `Missing client credentials for provider: ${provider}` }
    }

    logger.info(`✅ ${provider}: Got client credentials`, {
      clientIdLength: clientId.length,
      clientSecretLength: clientSecret.length
    })

    // Create a fresh URLSearchParams object to avoid "body used already" errors
    const bodyParams: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: decryptedRefreshToken,
    }

    if (config.refreshRequiresClientAuth) {
      if (config.authMethod === "body") {
        bodyParams.client_id = clientId
        bodyParams.client_secret = clientSecret
        if (verbose) logger.info(`Added client auth to body for ${provider}`)
      }
    } else {
      // Some providers like Kit only need client_id, not client_secret for refresh
      if (provider.toLowerCase() === "kit") {
        bodyParams.client_id = clientId
        // Remove any client_secret if it was added
        delete bodyParams.client_secret
        if (verbose) logger.info(`Special handling for Kit: added only client_id to body`)
      }
    }

    // Add scope if configured AND the provider supports it during refresh
    // Some providers like Discord don't accept scope in refresh requests
    if (config.scope && config.sendScopeWithRefresh !== false) {
      // Teams uses config.scope directly (same as other Microsoft services)
      if (provider === "teams") {
        const scopeString = config.scope || ""
        bodyParams.scope = scopeString
        if (verbose) logger.info(`Added Teams scope from config: ${scopeString}`)
      } else {
        const scopeString = Array.isArray(config.scope) ? config.scope.join(" ") : config.scope
        bodyParams.scope = scopeString
        if (verbose) logger.info(`Added scope to body for ${provider}: ${scopeString}`)
      }
    } else if (config.scope && config.sendScopeWithRefresh === false) {
      if (verbose) logger.info(`Skipping scope for ${provider} as sendScopeWithRefresh is false`)
    }

    // Add redirect_uri if required
    if (config.sendRedirectUriWithRefresh) {
      const baseUrl = getBaseUrl()
      const redirectUri = `${baseUrl}${config.redirectUriPath}`
      bodyParams.redirect_uri = redirectUri
      if (verbose) logger.info(`Added redirect_uri to body for ${provider}: ${redirectUri}`)
    }

    // Special handling for Airtable
    if (provider === "airtable" && config.redirectUriPath) {
      const baseUrl = getBaseUrl()
      const redirectUri = `${baseUrl}${config.redirectUriPath}`
      bodyParams.redirect_uri = redirectUri
      if (verbose) logger.info(`Added redirect_uri to body for Airtable: ${redirectUri}`)
    }

    // Special handling for Dropbox
    if (provider === "dropbox") {
      if (verbose) logger.info(`Skipping redirect_uri for Dropbox as it's not supported during refresh`)
      delete bodyParams.redirect_uri
    }

    // Prepare the request headers
    const headers = new Headers()
    if (config.authMethod === "basic") {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
      headers.set("Authorization", `Basic ${basicAuth}`)
      if (verbose) logger.info(`Added Basic auth header for ${provider}`)
    } else if (config.authMethod === "header") {
      headers.set("Client-ID", clientId)
      headers.set("Authorization", `Bearer ${clientSecret}`)
      if (verbose) logger.info(`Added header auth for ${provider}`)
    }
    headers.set("Content-Type", "application/x-www-form-urlencoded")

    // Convert bodyParams to string
    const bodyString = new URLSearchParams(bodyParams).toString()

    // Log the request details
    logger.info(`📤 ${provider}: Sending refresh request to ${config.tokenEndpoint}`, {
      method: 'POST',
      bodyParams: Object.keys(bodyParams),
      headerKeys: Array.from(headers.keys()),
      bodyLength: bodyString.length
    })

    // Make the request
    const startTime = Date.now()
    const response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers,
      body: bodyString,
    })
    const duration = Date.now() - startTime

    logger.info(`📥 ${provider}: Received response (${duration}ms)`, {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      ok: response.ok
    })

    // Try to parse the response as JSON, but handle non-JSON responses gracefully
    let responseData: any
    try {
      responseData = await response.json()
    } catch (parseError: any) {
      const responseText = await response.text()
      
      // Check if the response is HTML (common with Kit and some other providers)
      if (responseText.trim().startsWith("<!doctype html>") || responseText.trim().startsWith("<html")) {
        logger.error(`❌ Failed to parse JSON response from ${provider}: ${responseText.substring(0, 200)}...`)
        return {
          success: false,
          error: `Provider returned HTML instead of JSON. The refresh token may be invalid or the provider's API may have changed.`,
          statusCode: response.status,
          needsReauthorization: true,
          isTransientFailure: false // HTML response usually means permanent auth issue
        }
      }
      
      logger.error(`❌ Failed to parse JSON response from ${provider}:`, parseError)
      return {
        success: false,
        error: `Failed to parse response: ${parseError.message}`,
        statusCode: response.status,
        isTransientFailure: response.status >= 500 // Likely a server issue if unparseable
      }
    }

    if (!response.ok) {
      // Normalize responseData.error - some providers (e.g., Stripe) return error as an object
      // like { type: "invalid_grant", message: "..." } instead of a plain string
      const rawError = responseData.error
      const errorType = typeof rawError === 'object' && rawError !== null
        ? (rawError.type || rawError.code || rawError.error || '')
        : (rawError || '')
      const errorMessageFromObject = typeof rawError === 'object' && rawError !== null
        ? (rawError.message || rawError.error_description || JSON.stringify(rawError))
        : rawError
      const errorMessageRaw = responseData.error_description || errorMessageFromObject || `HTTP ${response.status} - ${response.statusText}`
      // Ensure errorMessage is always a string to prevent [object Object] in error messages
      const errorMessage = typeof errorMessageRaw === 'string' ? errorMessageRaw : JSON.stringify(errorMessageRaw)
      logger.error(
        `❌ ${provider}: Token refresh failed (ID: ${integration.id?.substring(0, 8)}...)`, {
          status: response.status,
          error: errorMessage,
          errorType: errorType,
          errorDescription: responseData.error_description,
          responseKeys: Object.keys(responseData)
        }
      )
      if (verbose) {
        logger.debug(`Token refresh error response keys:`, Object.keys(responseData))
      }

      // Check for specific error codes that indicate an invalid refresh token
      const isInvalidGrant = errorType === "invalid_grant"
      const isInvalidOrExpiredToken = isInvalidGrant || response.status === 401

      // Provider-specific error handling
      let finalErrorMessage = errorMessage
      let needsReauth = isInvalidOrExpiredToken

      // Special handling for Gmail and Google services
      if (provider === "gmail" || provider.startsWith("google")) {
        if (verbose) logger.info(`Google error type: ${errorType}`)
        if (errorType === "invalid_grant") {
          finalErrorMessage = `Google refresh token has been revoked or expired. This can happen if you changed your password, revoked access, or haven't used this integration in over 6 months. Please reconnect your ${provider} account in Settings → Integrations.`
          needsReauth = true
        }
      }

      // Special handling for Discord errors
      else if (provider === "discord") {
        if (verbose) logger.info(`Discord error type: ${errorType}`)
        if (errorType === "invalid_scope") {
          finalErrorMessage = "Discord authentication scopes have changed. Please reconnect your Discord account in Settings → Integrations."
          needsReauth = true
        } else if (errorType === "invalid_grant") {
          finalErrorMessage = "Discord refresh token expired or invalid. Please reconnect your Discord account in Settings → Integrations."
          needsReauth = true
        }
      }

      // Special handling for Airtable errors
      else if (provider === "airtable") {
        if (verbose) logger.info(`Airtable error type: ${errorType}`)
        if (errorType === "invalid_grant") {
          finalErrorMessage = "Airtable refresh token expired or invalid. User must re-authorize."
          needsReauth = true
        }
      }

      // Special handling for Microsoft-related providers (Teams, OneDrive, Excel, etc.)
      else if (provider === "teams" || provider === "onedrive" || provider === "microsoft-excel" || provider.startsWith("microsoft")) {
        if (verbose) logger.info(`Microsoft error type: ${errorType}`)
        if (errorType === "invalid_grant") {
          finalErrorMessage = `${provider} refresh token expired or invalid. User must re-authorize.`
          needsReauth = true
        }
      }

      // Special handling for TikTok
      else if (provider === "tiktok") {
        if (verbose) logger.info(`TikTok error type: ${errorType}`)

        // Common TikTok error patterns
        if (errorType === "invalid_client") {
          finalErrorMessage = "TikTok client credentials are invalid or expired."
        } else if (errorType === "invalid_request") {
          finalErrorMessage = "TikTok refresh token request was invalid."
        } else if (errorType === "invalid_response" || errorType === "invalid_response_format") {
          finalErrorMessage = responseData.error_description || "TikTok returned an invalid response."
          needsReauth = true; // HTML responses usually indicate an expired token
        } else if (response.status === 401) {
          finalErrorMessage = "TikTok authorization failed. The refresh token may be expired."
          needsReauth = true;
        }
      }

      // Special handling for Kit
      else if (provider === "kit") {
        if (verbose) logger.info(`Kit error type: ${errorType}`)

        if (errorType === "invalid_response" || errorType === "invalid_response_format") {
          finalErrorMessage = responseData.error_description || "Kit returned an invalid response."
          needsReauth = true; // HTML responses usually indicate an expired token
        } else if (response.status === 401) {
          finalErrorMessage = "Kit authorization failed. The refresh token may be expired."
          needsReauth = true;
        }
      }

      // Special handling for PayPal
      else if (provider === "paypal") {
        if (verbose) logger.info(`PayPal error type: ${errorType}`)

        if (errorType === "invalid_client") {
          finalErrorMessage = "PayPal client credentials are invalid. Please check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET."
        } else if (errorType === "invalid_grant") {
          finalErrorMessage = "PayPal refresh token expired or invalid. User must re-authorize."
          needsReauth = true
        } else if (response.status === 401) {
          finalErrorMessage = "PayPal authentication failed. Client credentials may be invalid or expired."
        }
      }

      // Use enhanced error classification
      const classifiedError = classifyOAuthError(provider, response.status, responseData)

      return {
        success: false,
        error: finalErrorMessage,
        statusCode: response.status,
        providerResponse: responseData,
        invalidRefreshToken: needsReauth,
        needsReauthorization: needsReauth || classifiedError.requiresUserAction,
        isTransientFailure: classifiedError.isRecoverable,
        classifiedError,
      }
    }

    const newAccessToken = responseData.access_token
    const newRefreshToken = responseData.refresh_token
    const expiresIn = responseData.expires_in
    const refreshExpiresIn = responseData.refresh_expires_in
    const newScope = responseData.scope

    logger.info(`✅ ${provider}: Token refresh successful`, {
      hasNewAccessToken: !!newAccessToken,
      hasNewRefreshToken: !!newRefreshToken,
      accessTokenLength: newAccessToken?.length,
      expiresIn: expiresIn ? `${expiresIn}s` : 'not provided',
      refreshExpiresIn: refreshExpiresIn ? `${refreshExpiresIn}s` : 'not provided',
      scope: newScope ? newScope.substring(0, 50) + (newScope.length > 50 ? '...' : '') : 'not provided'
    })

    return {
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      accessTokenExpiresIn: expiresIn,
      refreshTokenExpiresIn: refreshExpiresIn,
      scope: newScope,
      providerResponse: responseData,
    }
  } catch (error: any) {
    logger.error("Error during token refresh:", error)
    return {
      success: false,
      error: `Unexpected error during token refresh: ${error.message || "Unknown error"}`,
      statusCode: 500,
      needsReauthorization: false,
    }
  }
}

// ---------------------------------------------------------------------------
// PR-C3a — high-level refresh wrapper for runtime callers (refreshAndRetry).
// ---------------------------------------------------------------------------
//
// `refreshTokenForProvider` requires the caller to load the integration row,
// decrypt the refresh token, and persist the new tokens. That's the right
// shape for cron jobs, but runtime action handlers shouldn't have to do all
// of that on every 401 retry. `refresh(provider, userId)` is the thin
// wrapper that:
//   1. Loads the integration row from the `integrations` table.
//   2. Calls `refreshTokenForProvider` with the encrypted refresh token.
//   3. On success, persists the new encrypted access token + expiry (and
//      rotated refresh token if the provider returned one), then returns a
//      `RefreshResult` whose `accessToken` field holds the **decrypted**
//      access token ready for `refreshAndRetry` to retry the original call.
//   4. On any failure (no row, no refresh token, provider error, persistence
//      error) returns `{ success: false, ... }` — never throws an
//      "expected" auth failure. Per Q1, only unexpected/system errors should
//      surface as throws; refreshAndRetry's caller relies on the structured
//      shape to drive its standardized auth-failure response.
//
// Persistence is best-effort: if the new tokens can't be saved (e.g.,
// transient DB issue), we still return the decrypted access token so the
// retry can succeed. The next refresh cycle will re-persist.
//
// Contract: see learning/docs/handler-contracts.md Q3.
// ---------------------------------------------------------------------------

/**
 * Refresh the OAuth access token for a (provider, userId) pair using the
 * existing `refreshTokenForProvider` flow. Loads, refreshes, persists, and
 * returns a `RefreshResult` whose `accessToken` is decrypted and ready to
 * use. Never throws expected auth failures — caller inspects `success` and
 * `classifiedError`.
 *
 * Pass `options.supabase` to inject a client (used by tests). Defaults to
 * the admin client.
 */
export async function refresh(
  provider: string,
  userId: string,
  options: { supabase?: any; verbose?: boolean } = {}
): Promise<RefreshResult> {
  const supabase = options.supabase ?? createAdminClient()

  let integration: Integration | null = null
  try {
    const { data, error } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", provider)
      .eq("status", "connected")
      .single()

    if (error || !data) {
      return {
        success: false,
        error: `Integration not found for provider "${provider}" (user "${userId}")`,
        needsReauthorization: true,
        statusCode: 404,
      }
    }
    integration = data as Integration
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to load integration row: ${err?.message ?? "unknown error"}`,
      statusCode: 500,
      needsReauthorization: false,
    }
  }

  if (!integration?.refresh_token) {
    return {
      success: false,
      error: `No refresh token stored for provider "${provider}" — user must reconnect`,
      needsReauthorization: true,
      statusCode: 401,
    }
  }

  const result = await refreshTokenForProvider(
    provider,
    integration.refresh_token,
    integration,
    { verbose: options.verbose }
  )

  if (!result.success || !result.accessToken) {
    return result
  }

  // Best-effort persist. Failure here doesn't fail the refresh — the caller
  // can still use the new access token, and the next cron sweep will repair
  // persistence if it didn't land here.
  try {
    const updateData: Record<string, any> = {
      access_token: encrypt(result.accessToken),
    }

    if (typeof result.accessTokenExpiresIn === "number") {
      updateData.expires_at = new Date(
        Date.now() + result.accessTokenExpiresIn * 1000
      ).toISOString()
    }

    if (result.refreshToken) {
      updateData.refresh_token = encrypt(result.refreshToken)
    }

    await supabase
      .from("integrations")
      .update(updateData)
      .eq("id", integration.id)
  } catch (err: any) {
    logger.warn(
      `[tokenRefreshService.refresh] Persist after-refresh failed for ${provider}: ${err?.message}`
    )
    // Continue — the refreshed token is still valid for the immediate retry.
  }

  return result
}

/**
 * Export convenience methods for use in API routes and other services
 */
export const TokenRefreshService = {
  shouldRefreshToken,
  refreshTokenForProvider,
  refresh,
}

export default TokenRefreshService
