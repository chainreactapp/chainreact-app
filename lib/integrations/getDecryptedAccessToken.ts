import { createAdminClient } from "@/lib/supabase/admin"
import { decrypt } from "@/lib/security/encryption"
import { refreshIntegrationToken } from "./refreshToken"
import { CONNECTED_STATUSES_LIST } from "./connectionStatus"

import { logger } from '@/lib/utils/logger'

/**
 * Gets a decrypted access token for a specific integration
 * Will automatically refresh the token if it's expired or close to expiring
 */
export async function getDecryptedAccessToken(
  userId: string, 
  provider: string
): Promise<string> {
  const supabase = createAdminClient()
  
  // Get the integration record from the database
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .in("status", CONNECTED_STATUSES_LIST)
    .single()
  
  if (error || !data) {
    throw new Error(`Integration not found: ${provider}`)
  }

  // Check if token is expired or will expire soon (within 5 minutes)
  const expiresAt = data.expires_at ? new Date(data.expires_at) : null
  const isExpired = expiresAt && expiresAt.getTime() < Date.now() + 5 * 60 * 1000
  
  if (isExpired && data.refresh_token) {
    try {
      // Refresh the token
      const refreshedData = await refreshIntegrationToken(userId, provider)
      
      // Decrypt and return the new access token
      return decrypt(refreshedData.access_token)
    } catch (refreshError) {
      logger.error("Error refreshing token:", refreshError)
      throw new Error(`Failed to refresh ${provider} token. User needs to reconnect.`)
    }
  }
  
  // If not expired or no refresh token, return the current token
  if (!data.access_token) {
    throw new Error(`No access token found for ${provider}`)
  }
  
  return decrypt(data.access_token)
}

/**
 * Gets all needed credentials for an integration (tokens, API keys, etc)
 */
export async function getIntegrationCredentials(
  userId: string, 
  provider: string
): Promise<Record<string, any>> {
  try {
    const accessToken = await getDecryptedAccessToken(userId, provider)
    
    // For Gmail and other OAuth services, just return the access token
    if (["gmail", "google_calendar", "google_drive", "google_sheets"].includes(provider)) {
      return { accessToken }
    }
    
    // For API-key based integrations, you might have different fields
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("integrations")
      .select("metadata")
      .eq("user_id", userId)
      .eq("provider", provider)
      .in("status", CONNECTED_STATUSES_LIST)
      .single()
    
    if (error || !data) {
      throw new Error(`Integration credentials not found: ${provider}`)
    }
    
    const metadata = data.metadata || {}
    return {
      accessToken,
      apiKey: metadata.api_key ? decrypt(metadata.api_key) : undefined,
      apiSecret: metadata.api_secret ? decrypt(metadata.api_secret) : undefined,
      customFields: metadata.custom_fields || {}
    }
  } catch (error) {
    logger.error(`Error getting ${provider} credentials:`, error)
    throw error
  }
} 