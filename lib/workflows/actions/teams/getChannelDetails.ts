import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Get detailed information about a Microsoft Teams channel
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/channel-get
 */
export async function getTeamsChannelDetails(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values
    const teamId = input.teamId || config.teamId
    const channelId = input.channelId || config.channelId

    if (!teamId || !channelId) {
      return {
        success: false,
        error: 'Missing required fields: teamId and channelId are required'
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

    // Get channel details
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to get channel details:', errorData)
      return {
        success: false,
        error: `Failed to get channel details: ${errorData.error?.message || response.statusText}`
      }
    }

    const channel = await response.json()

    return {
      success: true,
      output: {
        channelId: channel.id,
        displayName: channel.displayName,
        description: channel.description || '',
        email: channel.email || '',
        membershipType: channel.membershipType,
        createdDateTime: channel.createdDateTime,
        webUrl: channel.webUrl || ''
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error getting channel details:', error)
    return {
      success: false,
      error: error.message || 'Failed to get Teams channel details'
    }
  }
}
