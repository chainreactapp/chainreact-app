import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Delete a message from a Microsoft Teams channel or chat
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/chatmessage-softdelete
 */
export async function deleteTeamsMessage(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values
    const messageType = input.messageType || config.messageType
    const teamId = input.teamId || config.teamId
    const channelId = input.channelId || config.channelId
    const chatId = input.chatId || config.chatId
    // Support both dropdown selection and manual ID entry
    // For channel messages: messageId (dropdown) or messageIdManual (text input)
    // For chat messages: chatMessageId (dropdown) or chatMessageIdManual (text input)
    const messageId = input.messageId || config.messageId || input.messageIdManual || config.messageIdManual ||
                      input.chatMessageId || config.chatMessageId || input.chatMessageIdManual || config.chatMessageIdManual

    if (!messageType || !messageId) {
      return {
        success: false,
        error: 'Missing required fields: messageType and messageId are required'
      }
    }

    if (messageType === 'channel' && (!teamId || !channelId)) {
      return {
        success: false,
        error: 'teamId and channelId are required for channel messages'
      }
    }

    if (messageType === 'chat' && !chatId) {
      return {
        success: false,
        error: 'chatId is required for chat messages'
      }
    }

    const supabase = createAdminClient()

    // Get Teams integration
    const { data: integration } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'teams')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (!integration || !integration.access_token) {
      return {
        success: false,
        error: 'Teams integration not found or not connected'
      }
    }

    const accessToken = await decrypt(integration.access_token)

    // Get the current user's ID for chat message deletion
    let graphUserId: string | null = null
    if (messageType === 'chat') {
      const meResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })
      if (meResponse.ok) {
        const meData = await meResponse.json()
        graphUserId = meData.id
      }
      if (!graphUserId) {
        return {
          success: false,
          error: 'Failed to get user ID for chat message deletion'
        }
      }
    }

    // Construct API endpoint based on message type
    // For chat messages, must use /users/{userId}/chats/{chatId}/messages/{messageId}/softDelete
    // For channel messages, use /teams/{teamId}/channels/{channelId}/messages/{messageId}/softDelete
    let endpoint: string
    if (messageType === 'channel') {
      endpoint = `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${messageId}/softDelete`
    } else {
      endpoint = `https://graph.microsoft.com/v1.0/users/${graphUserId}/chats/${chatId}/messages/${messageId}/softDelete`
    }

    // Delete the message (soft delete)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to delete message:', errorData)
      return {
        success: false,
        error: `Failed to delete message: ${errorData.error?.message || response.statusText}`
      }
    }

    return {
      success: true,
      output: {
        success: true,
        deletedMessageId: messageId
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error deleting message:', error)
    return {
      success: false,
      error: error.message || 'Failed to delete Teams message'
    }
  }
}
