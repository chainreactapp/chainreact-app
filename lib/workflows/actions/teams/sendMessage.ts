import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Send a message to a Microsoft Teams channel
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/channel-post-messages
 */
export async function sendTeamsMessage(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values
    const teamId = input.teamId || config.teamId
    const channelId = input.channelId || config.channelId
    const message = input.message || config.message

    if (!teamId || !channelId || !message) {
      return {
        success: false,
        error: 'Missing required fields: teamId, channelId, and message are required'
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

    // Send message to the channel
    // API: POST /teams/{team-id}/channels/{channel-id}/messages
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          body: {
            contentType: 'html',
            content: message
          }
        })
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to send message:', errorData)
      return {
        success: false,
        error: `Failed to send message: ${errorData.error?.message || response.statusText}`
      }
    }

    const sentMessage = await response.json()

    return {
      success: true,
      output: {
        messageId: sentMessage.id,
        channelId: channelId,
        timestamp: sentMessage.createdDateTime,
        success: true
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error sending message:', error)
    return {
      success: false,
      error: error.message || 'Failed to send Teams message'
    }
  }
}
