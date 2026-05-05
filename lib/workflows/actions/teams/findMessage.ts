import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Find and retrieve a specific message by ID in Microsoft Teams
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/chatmessage-get
 */
export async function findTeamsMessage(
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

    // Construct API endpoint based on message type
    let endpoint: string
    if (messageType === 'channel') {
      endpoint = `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${messageId}`
    } else {
      endpoint = `https://graph.microsoft.com/v1.0/chats/${chatId}/messages/${messageId}`
    }

    // Get the message
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to find message:', errorData)
      return {
        success: false,
        error: `Failed to find message: ${errorData.error?.message || response.statusText}`
      }
    }

    const message = await response.json()

    return {
      success: true,
      output: {
        messageId: message.id,
        content: message.body?.content || '',
        senderId: message.from?.user?.id || '',
        senderName: message.from?.user?.displayName || '',
        createdDateTime: message.createdDateTime,
        attachments: message.attachments || [],
        reactions: message.reactions || []
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error finding message:', error)
    return {
      success: false,
      error: error.message || 'Failed to find Teams message'
    }
  }
}
