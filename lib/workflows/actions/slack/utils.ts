/**
 * Shared utilities for Slack actions
 */

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Convert Slack URL message ID to timestamp format
 * Accepts:
 * - Full URL: https://chain-react.slack.com/archives/C0A67LNBE05/p1767325385562299
 * - URL format: p1767325385562299
 * - Timestamp: 1767325385.562299
 * API expects format: 1767325385.562299
 * @param messageId - Message ID from URL or timestamp
 */
export function normalizeMessageId(messageId: string): string {
  if (!messageId) return messageId

  let normalized = messageId

  // If it's a full Slack URL, extract the message ID from the end
  if (normalized.includes('slack.com/archives/')) {
    const urlMatch = normalized.match(/\/p(\d+)$/)
    if (urlMatch) {
      normalized = urlMatch[1] // Extract just the numbers after 'p'
    }
  }
  // Remove 'p' prefix if present (from Slack URLs)
  else if (normalized.startsWith('p')) {
    normalized = normalized.slice(1)
  }

  // If no dot present and length suggests it's a URL format (16+ digits)
  if (!normalized.includes('.') && normalized.length >= 16) {
    // Insert dot before last 6 digits (microseconds)
    normalized = normalized.slice(0, -6) + '.' + normalized.slice(-6)
  }

  return normalized
}

/**
 * Get decrypted Slack token for a user or specific integration
 * @param userIdOrIntegrationId - Either a user ID or integration ID
 * @param isIntegrationId - If true, treats the first param as an integration ID
 * @param useUserToken - If true, returns the user token (xoxp-) instead of bot token (xoxb-)
 */
export async function getSlackToken(
  userIdOrIntegrationId: string,
  isIntegrationId: boolean = false,
  useUserToken: boolean = false
): Promise<string> {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  let query = supabase
    .from('integrations')
    .select('access_token, metadata')
    .eq('provider', 'slack')
    .in('status', CONNECTED_STATUSES_LIST)

  if (isIntegrationId) {
    query = query.eq('id', userIdOrIntegrationId)
  } else {
    query = query.eq('user_id', userIdOrIntegrationId)
  }

  const { data: integration, error } = await query.single()

  if (error || !integration) {
    throw new Error('Slack integration not found. Please connect your Slack account.')
  }

  const { decryptToken } = await import('@/lib/integrations/tokenUtils')

  // If user token is requested, try to get it from metadata
  if (useUserToken) {
    const metadata = integration.metadata as any
    const encryptedUserToken = metadata?.user_token

    if (!encryptedUserToken) {
      throw new Error('User token not available. Please reconnect your Slack account to enable user-specific actions.')
    }

    const userToken = await decryptToken(encryptedUserToken)
    if (!userToken) {
      throw new Error('Failed to decrypt Slack user token. Please reconnect your Slack account.')
    }

    return userToken
  }

  // Otherwise, return the bot token (default behavior)
  if (!integration.access_token) {
    throw new Error('Slack access token not found. Please reconnect your Slack account.')
  }

  const accessToken = await decryptToken(integration.access_token)

  if (!accessToken) {
    throw new Error('Failed to decrypt Slack token. Please reconnect your Slack account.')
  }

  return accessToken
}

/**
 * Call Slack API with error handling
 */
export async function callSlackApi(endpoint: string, accessToken: string, payload: any): Promise<any> {
  const body = new URLSearchParams()
  if (payload && typeof payload === 'object') {
    Object.entries(payload).forEach(([key, value]) => {
      if (value === undefined || value === null) return
      const normalizedValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
      body.set(key, normalizedValue)
    })
  }

  const response = await fetch(`https://slack.com/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
    },
    body
  })
  return response.json()
}

/**
 * Common error message mapping
 * @param error - Error code or full error object from Slack API
 * @param apiResponse - Optional full API response for context
 */
export function getSlackErrorMessage(error: string | any, apiResponse?: any): string {
  // Handle if error is an object (full Slack response)
  const errorCode = typeof error === 'string' ? error : error?.error
  const needed = apiResponse?.needed || error?.needed

  const errorMessages: Record<string, string> = {
    'invalid_auth': 'Slack authentication expired. Please reconnect your account.',
    'token_revoked': 'Slack token has been revoked. Please reconnect your account.',
    'channel_not_found': 'Channel not found. Please check the channel ID.',
    'not_in_channel': 'Bot is not in this channel. Please invite the bot first.',
    'is_archived': 'Cannot perform action on archived channel.',
    'user_not_found': 'User not found.',
    'missing_scope': needed
      ? `Missing required Slack permissions: ${needed}. Please reconnect your Slack account to grant these permissions.`
      : 'Missing required Slack permissions. Please reconnect your Slack account to grant the necessary permissions.',
    'cant_invite_self': 'Cannot invite the bot itself.',
    'already_in_channel': 'User is already in the channel.',
    'message_not_found': 'Message not found.',
    'no_permission': 'Bot does not have permission to perform this action.',
    'restricted_action': 'This action is restricted by workspace settings.',
    'cant_update_message': 'Cannot update this message. You can only update messages posted by you or if you are a workspace admin. Try enabling "Update as User" or check if you have permission.',
    'cant_delete_message': 'Cannot delete this message. Only the message author, workspace admin, or workspace owner can delete messages.',
    'not_allowed_token_type': 'This action requires a user token. Please reconnect your Slack account to enable user-specific actions.'
  }
  return errorMessages[errorCode] || `Slack API error: ${errorCode || JSON.stringify(error)}`
}
