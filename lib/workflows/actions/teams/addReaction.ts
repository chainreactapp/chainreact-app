import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

// Microsoft Graph setReaction expects unicode emoji characters, not string names
// See: https://learn.microsoft.com/en-us/graph/api/chatmessage-setreaction
const REACTION_TYPE_TO_EMOJI: Record<string, string> = {
  'like': '👍',
  'heart': '❤️',
  'laugh': '😂',
  'surprised': '😮',
  'sad': '😢',
  'angry': '😠',
}
const VALID_REACTION_TYPES = Object.keys(REACTION_TYPE_TO_EMOJI)

/**
 * Add an emoji reaction to a Microsoft Teams message
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/chatmessage-setreaction
 */
export async function addTeamsReaction(
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
    const reactionType = input.reactionType || config.reactionType

    if (!messageType || !reactionType) {
      return {
        success: false,
        error: 'Missing required fields: messageType and reactionType are required'
      }
    }

    // Validate and normalize reaction type
    const normalizedReaction = reactionType.toLowerCase().trim()
    if (!VALID_REACTION_TYPES.includes(normalizedReaction)) {
      return {
        success: false,
        error: `Invalid reaction type: "${reactionType}". Valid types are: ${VALID_REACTION_TYPES.join(', ')}`
      }
    }
    const reactionEmoji = REACTION_TYPE_TO_EMOJI[normalizedReaction]

    if (!messageId) {
      return {
        success: false,
        error: 'Missing required field: messageId (for channel) or chatMessageId (for chat) is required'
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
      endpoint = `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${messageId}/setReaction`
    } else {
      endpoint = `https://graph.microsoft.com/v1.0/chats/${chatId}/messages/${messageId}/setReaction`
    }

    // Add the reaction
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reactionType: reactionEmoji
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to add reaction:', errorData)
      return {
        success: false,
        error: `Failed to add reaction: ${errorData.error?.message || response.statusText}`
      }
    }

    return {
      success: true,
      output: {
        success: true,
        messageId,
        reactionType
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error adding reaction:', error)
    return {
      success: false,
      error: error.message || 'Failed to add Teams reaction'
    }
  }
}
