import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Create a new channel in a Microsoft Teams team
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/channel-post
 */
export async function createTeamsChannel(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values (different callers use different conventions)
    const teamId = input.teamId || config.teamId
    const channelName = input.channelName || config.channelName
    const description = input.description || config.description
    const isPrivate = input.isPrivate ?? config.isPrivate

    if (!teamId || !channelName) {
      return {
        success: false,
        error: 'Missing required fields: teamId and channelName are required'
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

    // Build channel payload
    const channelPayload: any = {
      displayName: channelName,
      membershipType: isPrivate ? 'private' : 'standard'
    }

    if (description) {
      channelPayload.description = description
    }

    // Create the channel
    // API: POST /teams/{team-id}/channels
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(channelPayload)
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to create channel:', errorData)
      return {
        success: false,
        error: `Failed to create channel: ${errorData.error?.message || response.statusText}`
      }
    }

    const channel = await response.json()

    return {
      success: true,
      output: {
        channelId: channel.id,
        channelName: channel.displayName,
        teamId: teamId,
        isPrivate: channel.membershipType === 'private',
        success: true
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error creating channel:', error)
    return {
      success: false,
      error: error.message || 'Failed to create Teams channel'
    }
  }
}
