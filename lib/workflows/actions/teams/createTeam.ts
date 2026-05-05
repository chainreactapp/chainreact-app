import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Create a new Microsoft Teams team
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/team-post
 */
export async function createTeamsTeam(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values
    const displayName = input.displayName || config.displayName
    const description = input.description || config.description
    const visibility = input.visibility || config.visibility

    if (!displayName) {
      return {
        success: false,
        error: 'Missing required field: displayName is required'
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

    // Get the current user's ID first (required for team creation)
    const meResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    if (!meResponse.ok) {
      const meError = await meResponse.json()
      logger.error('[Teams] Failed to get current user:', meError)
      return {
        success: false,
        error: `Failed to get current user: ${meError.error?.message || meResponse.statusText}`
      }
    }

    const currentUser = await meResponse.json()
    const currentUserId = currentUser.id

    // Build team payload
    // Teams must be created from a group template
    const teamPayload = {
      "template@odata.bind": "https://graph.microsoft.com/v1.0/teamsTemplates('standard')",
      displayName: displayName,
      description: description || '',
      visibility: visibility === 'public' ? 'public' : 'private',
      members: [
        {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          "roles": ["owner"],
          "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${currentUserId}')`
        }
      ]
    }

    // Create the team
    // API: POST /teams
    const response = await fetch('https://graph.microsoft.com/v1.0/teams', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(teamPayload)
    })

    // Team creation is async - returns 202 Accepted with a Location header
    if (response.status === 202) {
      // Get the operation location from headers
      const operationLocation = response.headers.get('Content-Location') || response.headers.get('Location')

      // Wait a moment and try to get the team ID from the location header
      // The location typically contains the team ID after the operation completes
      // Format: /teams('team-id')
      let teamId = ''
      if (operationLocation) {
        const match = operationLocation.match(/teams\('([^']+)'\)/)
        if (match) {
          teamId = match[1]
        }
      }

      // If we couldn't get the team ID immediately, we need to poll the operation
      // For now, return success with the operation status
      return {
        success: true,
        output: {
          teamId: teamId || 'pending',
          displayName: displayName,
          description: description || '',
          visibility: visibility || 'private',
          webUrl: teamId ? `https://teams.microsoft.com/l/team/${encodeURIComponent(teamId)}` : '',
          success: true,
          note: teamId ? 'Team created successfully' : 'Team creation initiated. It may take a few moments to complete.'
        }
      }
    }

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to create team:', errorData)
      return {
        success: false,
        error: `Failed to create team: ${errorData.error?.message || response.statusText}`
      }
    }

    const team = await response.json()

    return {
      success: true,
      output: {
        teamId: team.id,
        displayName: team.displayName,
        description: team.description || '',
        visibility: team.visibility,
        webUrl: team.webUrl || '',
        success: true
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error creating team:', error)
    return {
      success: false,
      error: error.message || 'Failed to create Teams team'
    }
  }
}
