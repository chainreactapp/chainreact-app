import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Add a member to a Microsoft Teams team
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/team-post-members
 */
export async function addTeamsMemberToTeam(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values (different callers use different conventions)
    const teamId = input.teamId || config.teamId
    const userEmail = input.userEmail || config.userEmail
    const role = input.role || config.role

    if (!teamId || !userEmail) {
      return {
        success: false,
        error: 'Missing required fields: teamId and userEmail are required'
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

    // userEmail can be either an email address or a user ID
    const isEmail = userEmail.includes('@')
    let resolvedUserId = userEmail

    // If it's an email, we need to look up the user ID first
    // This handles both native Azure AD users and guest accounts
    if (isEmail) {
      // Try to find the user by email (works for both native and guest users)
      // For guests, the mail property contains the original email
      const userSearchResponse = await fetch(
        `https://graph.microsoft.com/v1.0/users?$filter=mail eq '${encodeURIComponent(userEmail)}' or userPrincipalName eq '${encodeURIComponent(userEmail)}'&$select=id,mail,userPrincipalName,displayName`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )

      if (userSearchResponse.ok) {
        const searchResult = await userSearchResponse.json()
        if (searchResult.value && searchResult.value.length > 0) {
          resolvedUserId = searchResult.value[0].id
          logger.info('[Teams] Resolved user email to ID:', { email: userEmail, userId: resolvedUserId })
        } else {
          // User not found in directory - they may need to be invited first
          return {
            success: false,
            error: `User '${userEmail}' not found in the organization directory. The user may need to be invited to the organization first.`
          }
        }
      } else {
        const searchError = await userSearchResponse.json()
        logger.error('[Teams] Failed to search for user:', searchError)
        // Fall back to trying the email directly
      }
    }

    // Build member payload using the resolved user ID
    const memberPayload = {
      "@odata.type": "#microsoft.graph.aadUserConversationMember",
      "roles": role === 'owner' ? ['owner'] : [],
      "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${resolvedUserId}')`
    }

    // Add member to the team
    // API: POST /teams/{team-id}/members
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/members`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(memberPayload)
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to add member to team:', errorData)
      return {
        success: false,
        error: `Failed to add member to team: ${errorData.error?.message || response.statusText}`
      }
    }

    const member = await response.json()

    // Extract user ID from the response
    const addedUserId = member.userId || member.id

    return {
      success: true,
      output: {
        odataId: member['@odata.id'],
        userId: addedUserId,
        userEmail: isEmail ? userEmail : (member.email || userEmail),
        displayName: member.displayName,
        teamId: teamId,
        role: role || 'member',
        success: true
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error adding member to team:', error)
    return {
      success: false,
      error: error.message || 'Failed to add member to Teams team'
    }
  }
}
