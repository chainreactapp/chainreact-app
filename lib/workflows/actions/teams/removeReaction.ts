import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Remove all of the current user's emoji reactions from a Microsoft Teams message
 *
 * This action automatically detects which reactions you have on a message and removes them all.
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/chatmessage-unsetreaction
 */
export async function removeTeamsReaction(
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

    if (!messageType) {
      return {
        success: false,
        error: 'Missing required field: messageType is required'
      }
    }

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

    // First, get the current user's ID from Microsoft Graph
    const meResponse = await fetch('https://graph.microsoft.com/beta/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    if (!meResponse.ok) {
      return {
        success: false,
        error: 'Failed to get current user information'
      }
    }

    const meData = await meResponse.json()
    const currentUserId = meData.id

    // Get the message to find the user's reactions
    let getMessageEndpoint: string
    if (messageType === 'channel') {
      getMessageEndpoint = `https://graph.microsoft.com/beta/teams/${teamId}/channels/${channelId}/messages/${messageId}`
    } else {
      getMessageEndpoint = `https://graph.microsoft.com/beta/chats/${chatId}/messages/${messageId}`
    }

    const messageResponse = await fetch(getMessageEndpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!messageResponse.ok) {
      const errorData = await messageResponse.json()
      logger.error('[Teams] Failed to get message for reaction removal:', errorData)
      return {
        success: false,
        error: `Failed to get message: ${errorData.error?.message || messageResponse.statusText}`
      }
    }

    const message = await messageResponse.json()

    // Find reactions made by the current user
    const userReactions = (message.reactions || []).filter((reaction: any) =>
      reaction.user?.user?.id === currentUserId
    )

    if (userReactions.length === 0) {
      return {
        success: true,
        output: {
          success: true,
          messageId,
          removedReactions: [],
          message: 'No reactions found from current user on this message'
        }
      }
    }

    // Construct the unsetReaction endpoint
    let unsetEndpoint: string
    if (messageType === 'channel') {
      unsetEndpoint = `https://graph.microsoft.com/beta/teams/${teamId}/channels/${channelId}/messages/${messageId}/unsetReaction`
    } else {
      unsetEndpoint = `https://graph.microsoft.com/beta/chats/${chatId}/messages/${messageId}/unsetReaction`
    }

    // Remove all of the user's reactions
    const removedReactions: string[] = []
    const failedReactions: string[] = []

    for (const reaction of userReactions) {
      const reactionType = reaction.reactionType

      const response = await fetch(unsetEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reactionType: reactionType
        })
      })

      if (response.ok) {
        removedReactions.push(reactionType)
      } else {
        failedReactions.push(reactionType)
        logger.error(`[Teams] Failed to remove reaction ${reactionType}:`, await response.text())
      }
    }

    if (removedReactions.length === 0 && failedReactions.length > 0) {
      return {
        success: false,
        error: `Failed to remove reactions: ${failedReactions.join(', ')}`
      }
    }

    return {
      success: true,
      output: {
        success: true,
        messageId,
        removedReactions,
        failedReactions: failedReactions.length > 0 ? failedReactions : undefined
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error removing reaction:', error)
    return {
      success: false,
      error: error.message || 'Failed to remove Teams reaction'
    }
  }
}
