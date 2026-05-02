import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { requireExplicitField } from '../core/requireExplicitField'
import { logger } from '@/lib/utils/logger'

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Invite an external user to Azure AD as a guest
 * Returns the invited user's ID if successful
 */
async function inviteGuestUser(
  accessToken: string,
  email: string,
  sendInvitationMessage: boolean = true
): Promise<{ success: boolean; userId?: string; error?: string }> {
  try {
    // Validate email format before calling API
    if (!isValidEmail(email)) {
      logger.warn('[Teams] Invalid email format for invitation:', email)
      return {
        success: false,
        error: `Invalid email format: ${email}`
      }
    }

    logger.info('[Teams] Attempting to invite guest user:', { email, sendInvitationMessage })

    const inviteResponse = await fetch('https://graph.microsoft.com/v1.0/invitations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invitedUserEmailAddress: email,
        inviteRedirectUrl: 'https://teams.microsoft.com',
        sendInvitationMessage: sendInvitationMessage
      })
    })

    if (!inviteResponse.ok) {
      const errorData = await inviteResponse.json()
      logger.error('[Teams] Invitation API error:', {
        email,
        status: inviteResponse.status,
        error: errorData
      })
      return {
        success: false,
        error: errorData.error?.message || `API error ${inviteResponse.status}`
      }
    }

    const inviteResult = await inviteResponse.json()
    logger.info('[Teams] Successfully invited guest user:', {
      email,
      userId: inviteResult.invitedUser?.id
    })
    return {
      success: true,
      userId: inviteResult.invitedUser?.id
    }
  } catch (error: any) {
    logger.error('[Teams] Exception during invitation:', { email, error: error.message })
    return {
      success: false,
      error: error.message || 'Failed to invite user'
    }
  }
}

/**
 * Create a new group chat in Microsoft Teams
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/chat-post
 *
 * Supports:
 * - Internal tenant users (regular members)
 * - In-tenant guest users (already invited to Azure AD)
 * - External users (can be auto-invited if inviteExternalUsers is true)
 */
export async function createTeamsGroupChat(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Q11 — sendInvitationEmail emails real people on group-chat creation.
    // Previous silent default `true` removed; workflow author must
    // explicitly choose. The check considers both `config` and `input`
    // (handler accepts either) so a user-supplied value at either layer
    // satisfies the requirement.
    const sendInvitationFromInput = input.sendInvitationEmail
    const sendInvitationFromConfig = config?.sendInvitationEmail
    const hasExplicitSendInvitation =
      sendInvitationFromInput !== undefined && sendInvitationFromInput !== null && sendInvitationFromInput !== '' ||
      sendInvitationFromConfig !== undefined && sendInvitationFromConfig !== null && sendInvitationFromConfig !== ''
    if (!hasExplicitSendInvitation) {
      const missingRequired = requireExplicitField(config, 'sendInvitationEmail')
      if (missingRequired) return missingRequired as unknown as ActionResult
    }

    // Support both config and input for field values
    const topic = input.topic || config.topic
    const members = input.members || config.members
    const initialMessage = input.initialMessage || config.initialMessage
    const inviteExternalUsers = input.inviteExternalUsers ?? config.inviteExternalUsers ?? false
    const sendInvitationEmail = input.sendInvitationEmail ?? config.sendInvitationEmail

    if (!members || members.length === 0) {
      return {
        success: false,
        error: 'At least one member is required to create a group chat'
      }
    }

    const supabase = createAdminClient()

    // Get Teams integration
    const { data: integration } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'teams')
      .eq('status', 'connected')
      .single()

    if (!integration || !integration.access_token) {
      return {
        success: false,
        error: 'Teams integration not found or not connected'
      }
    }

    const accessToken = await decrypt(integration.access_token)

    // First, get the current user's ID
    const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    if (!userResponse.ok) {
      return {
        success: false,
        error: 'Failed to get current user information'
      }
    }

    const currentUser = await userResponse.json()

    // Format members array - needs to be array of user IDs or email addresses
    // Handle comma-separated or newline-separated strings
    let memberEmails: string[] = []
    if (Array.isArray(members)) {
      // Flatten in case array contains comma-separated strings
      memberEmails = members.flatMap((m: string) =>
        m.split(/[,\n]/).map((e: string) => e.trim()).filter(Boolean)
      )
    } else if (typeof members === 'string') {
      memberEmails = members.split(/[,\n]/).map((e: string) => e.trim()).filter(Boolean)
    }

    // Build members list
    const chatMembers: any[] = [
      {
        "@odata.type": "#microsoft.graph.aadUserConversationMember",
        "roles": ["owner"],
        "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${currentUser.id}')`
      }
    ]

    // Track results
    const failedMembers: string[] = []
    const invitedMembers: string[] = []
    const addedMembers: string[] = []

    for (const memberEmail of memberEmails) {
      const isEmail = memberEmail.includes('@')
      let memberId = memberEmail
      let isGuest = false

      if (isEmail) {
        // Search for user by email in Azure AD
        // This finds both regular users and existing guest users
        const userSearchResponse = await fetch(
          `https://graph.microsoft.com/v1.0/users?$filter=mail eq '${encodeURIComponent(memberEmail)}' or userPrincipalName eq '${encodeURIComponent(memberEmail)}'&$select=id,mail,userPrincipalName,displayName,userType`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        )

        if (userSearchResponse.ok) {
          const searchResult = await userSearchResponse.json()
          if (searchResult.value && searchResult.value.length > 0) {
            const foundUser = searchResult.value[0]
            memberId = foundUser.id
            isGuest = foundUser.userType === 'Guest'
            addedMembers.push(memberEmail)
            logger.info('[Teams] Resolved member email to ID:', {
              email: memberEmail,
              userId: memberId,
              userType: foundUser.userType
            })
          } else {
            // User not found in directory - try to invite if enabled
            if (inviteExternalUsers) {
              logger.info('[Teams] User not found, attempting to invite:', memberEmail)
              const inviteResult = await inviteGuestUser(accessToken, memberEmail, sendInvitationEmail)

              if (inviteResult.success && inviteResult.userId) {
                memberId = inviteResult.userId
                isGuest = true
                invitedMembers.push(memberEmail)
                logger.info('[Teams] Successfully invited guest user:', { email: memberEmail, userId: memberId })
              } else {
                logger.warn('[Teams] Failed to invite user:', { email: memberEmail, error: inviteResult.error })
                failedMembers.push(`${memberEmail} (invite failed: ${inviteResult.error})`)
                continue
              }
            } else {
              logger.warn('[Teams] User not found in directory (auto-invite disabled):', memberEmail)
              failedMembers.push(`${memberEmail} (not in directory - enable "Invite External Users" to auto-invite)`)
              continue
            }
          }
        } else {
          logger.warn('[Teams] Failed to search for user:', memberEmail)
          failedMembers.push(`${memberEmail} (search failed)`)
          continue
        }
      }

      // Add member with appropriate role
      // Guest users in the tenant should have "guest" role
      // Regular users and owners have "owner" role
      chatMembers.push({
        "@odata.type": "#microsoft.graph.aadUserConversationMember",
        "roles": isGuest ? ["guest"] : ["owner"],
        "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${memberId}')`
      })
    }

    // Check if we have enough members (at least 2 including the current user for a group chat)
    if (chatMembers.length < 2) {
      return {
        success: false,
        error: `Could not create group chat: no valid members found. Failed to resolve: ${failedMembers.join(', ')}`
      }
    }

    // Create the group chat
    const chatPayload: any = {
      chatType: "group",
      members: chatMembers
    }

    if (topic) {
      chatPayload.topic = topic
    }

    const response = await fetch('https://graph.microsoft.com/v1.0/chats', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(chatPayload)
    })

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to create group chat:', errorData)
      return {
        success: false,
        error: `Failed to create group chat: ${errorData.error?.message || response.statusText}`
      }
    }

    const chat = await response.json()

    // Send initial message if provided
    if (initialMessage && chat.id) {
      await fetch(`https://graph.microsoft.com/v1.0/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          body: {
            content: initialMessage
          }
        })
      })
    }

    const output: any = {
      chatId: chat.id,
      chatType: chat.chatType,
      topic: chat.topic || '',
      createdDateTime: chat.createdDateTime,
      membersAdded: chatMembers.length - 1, // Exclude current user from count
      success: true
    }

    // Include details about what happened with each member
    if (addedMembers.length > 0) {
      output.addedMembers = addedMembers
    }

    if (invitedMembers.length > 0) {
      output.invitedMembers = invitedMembers
      output.inviteNote = `${invitedMembers.length} external user(s) were invited to your organization and added to the chat`
    }

    if (failedMembers.length > 0) {
      output.failedMembers = failedMembers
      output.warning = `Some members could not be added: ${failedMembers.join(', ')}`
    }

    return {
      success: true,
      output
    }
  } catch (error: any) {
    logger.error('[Teams] Error creating group chat:', error)
    return {
      success: false,
      error: error.message || 'Failed to create Teams group chat'
    }
  }
}
