import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Reply to a message in a Microsoft Teams channel
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/chatmessage-post-replies
 */
export async function replyToTeamsMessage(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values
    const teamId = input.teamId || config.teamId
    const channelId = input.channelId || config.channelId
    // Support both dropdown selection and manual ID entry
    const messageId = input.messageId || config.messageId || input.messageIdManual || config.messageIdManual
    const replyContent = input.replyContent || config.replyContent

    if (!teamId || !channelId || !messageId || !replyContent) {
      return {
        success: false,
        error: 'Missing required fields: teamId, channelId, messageId, and replyContent are required'
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

    // Send reply to the message
    // API: POST /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${messageId}/replies`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          body: {
            content: replyContent
          }
        })
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to reply to message:', errorData)
      return {
        success: false,
        error: `Failed to reply to message: ${errorData.error?.message || response.statusText}`
      }
    }

    const reply = await response.json()

    return {
      success: true,
      output: {
        replyId: reply.id,
        parentMessageId: messageId,
        timestamp: reply.createdDateTime,
        success: true
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error replying to message:', error)
    return {
      success: false,
      error: error.message || 'Failed to reply to Teams message'
    }
  }
}
