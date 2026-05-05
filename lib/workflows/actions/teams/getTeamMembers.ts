import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Get all members of a Microsoft Teams team
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/team-list-members
 */
export async function getTeamsTeamMembers(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values
    const teamId = input.teamId || config.teamId

    if (!teamId) {
      return {
        success: false,
        error: 'Missing required field: teamId is required'
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

    // Get team members
    // API: GET /teams/{team-id}/members
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/members`,
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
      logger.error('[Teams] Failed to get team members:', errorData)
      return {
        success: false,
        error: `Failed to get team members: ${errorData.error?.message || response.statusText}`
      }
    }

    const data = await response.json()
    const members = data.value || []

    // Format member data
    const formattedMembers = members.map((member: any) => ({
      id: member.id,
      displayName: member.displayName,
      email: member.email,
      roles: member.roles || [],
      userId: member.userId
    }))

    return {
      success: true,
      output: {
        members: formattedMembers,
        memberCount: formattedMembers.length,
        teamId: teamId,
        success: true
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error getting team members:', error)
    return {
      success: false,
      error: error.message || 'Failed to get Teams team members'
    }
  }
}
