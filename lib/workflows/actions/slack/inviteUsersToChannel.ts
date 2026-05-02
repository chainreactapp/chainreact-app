/**
 * Slack Invite Users to Channel Action
 * Invites one or more users to a Slack channel
 */

import { ActionResult } from '../core/executeWait'
import { requireExplicitField } from '../core/requireExplicitField'
import { logger } from '@/lib/utils/logger'
import { getSlackToken } from './utils'

export async function inviteUsersToChannel(params: {
  config: any
  userId: string
  input: Record<string, any>
}): Promise<ActionResult> {
  const { config, userId } = params

  try {
    // Q11 — sendInviteNotification is required (audit decision: notification
    // intent must be explicit even though Slack's `conversations.invite`
    // currently always notifies). Workflow author must acknowledge intent.
    const missingRequired = requireExplicitField(config, 'sendInviteNotification')
    if (missingRequired) return missingRequired as unknown as ActionResult

    const {
      workspace,
      channel,
      users,
      sendInviteNotification,
      customWelcomeMessage,
      asUser = false
    } = config

    // Validate required fields
    if (!channel) {
      throw new Error('Channel is required')
    }

    if (!users || (Array.isArray(users) && users.length === 0)) {
      throw new Error('At least one user is required')
    }

    // Normalize users to array
    const userIds = Array.isArray(users) ? users : [users]

    // If asUser is true, use the user token (xoxp-) instead of bot token (xoxb-)
    const useUserToken = asUser === true
    const accessToken = workspace
      ? await getSlackToken(workspace, true, useUserToken)
      : await getSlackToken(userId, false, useUserToken)

    logger.info('[Slack Invite Users] Inviting users to channel:', {
      channel,
      userCount: userIds.length,
      sendNotification: sendInviteNotification
    })

    // Helper function to call Slack API
    const callSlackApiLocal = async (endpoint: string, payload: any) => {
      const response = await fetch(`https://slack.com/api/${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(payload)
      })
      return response.json()
    }

    // Ensure the bot is in the channel before inviting others
    // This prevents "cant_invite" and "not_in_channel" errors
    const joinResult = await callSlackApiLocal('conversations.join', { channel })
    if (!joinResult.ok && joinResult.error !== 'method_not_supported_for_channel_type') {
      logger.info('[Slack Invite Users] Bot join attempt:', joinResult.error || 'success')
    }

    // Track results
    const invitedUsers: string[] = []
    const failedUsers: { userId: string; error: string }[] = []
    const alreadyInChannel: string[] = []

    // Invite users (Slack API accepts comma-separated user IDs)
    // The conversations.invite API can handle multiple users at once
    const invitePayload = {
      channel: channel,
      users: userIds.join(',')
    }

    const result = await callSlackApiLocal('conversations.invite', invitePayload)

    if (result.ok) {
      // All users were invited successfully
      invitedUsers.push(...userIds)
      logger.info('[Slack Invite Users] Successfully invited all users')
    } else {
      // Handle specific errors
      if (result.error === 'already_in_channel') {
        // All users already in channel
        alreadyInChannel.push(...userIds)
        logger.info('[Slack Invite Users] Users already in channel')
      } else if (result.error === 'cant_invite_self') {
        // Can't invite the bot itself
        failedUsers.push({ userId: 'self', error: 'Cannot invite the bot itself' })
      } else if (result.error === 'channel_not_found') {
        throw new Error('Channel not found. Please check the channel ID.')
      } else if (result.error === 'not_in_channel') {
        throw new Error('Bot is not in this channel. Please invite the bot to the channel first.')
      } else if (result.error === 'is_archived') {
        throw new Error('Cannot invite users to an archived channel.')
      } else if (result.error === 'user_not_found') {
        throw new Error('One or more users were not found.')
      } else if (result.error === 'cant_invite') {
        throw new Error('Cannot invite users to this channel. The bot may lack permissions.')
      } else {
        // If bulk invite fails, try inviting users one by one
        logger.info('[Slack Invite Users] Bulk invite failed, trying individual invites:', result.error)

        for (const uid of userIds) {
          const singleResult = await callSlackApiLocal('conversations.invite', {
            channel: channel,
            users: uid
          })

          if (singleResult.ok) {
            invitedUsers.push(uid)
          } else if (singleResult.error === 'already_in_channel') {
            alreadyInChannel.push(uid)
          } else {
            failedUsers.push({ userId: uid, error: singleResult.error })
          }
        }
      }
    }

    // Get channel info for the response
    const channelInfo = await callSlackApiLocal('conversations.info', { channel })
    const channelName = channelInfo.ok ? channelInfo.channel?.name : channel

    // Send welcome message if configured and at least one user was invited
    if (customWelcomeMessage && invitedUsers.length > 0) {
      logger.info('[Slack Invite Users] Sending welcome message')

      await callSlackApiLocal('chat.postMessage', {
        channel: channel,
        text: customWelcomeMessage
      })
    }

    // Determine overall success
    const totalProcessed = invitedUsers.length + alreadyInChannel.length + failedUsers.length
    const success = failedUsers.length === 0 || invitedUsers.length > 0

    // Build response message
    let message = ''
    if (invitedUsers.length > 0) {
      message += `Successfully invited ${invitedUsers.length} user(s) to #${channelName}. `
    }
    if (alreadyInChannel.length > 0) {
      message += `${alreadyInChannel.length} user(s) were already in the channel. `
    }
    if (failedUsers.length > 0) {
      message += `Failed to invite ${failedUsers.length} user(s). `
    }

    return {
      success,
      output: {
        success,
        channelId: channel,
        channelName,
        invitedUsers,
        invitedCount: invitedUsers.length,
        failedUsers: failedUsers.map(f => f.userId),
        alreadyInChannel,
        welcomeMessageSent: !!(customWelcomeMessage && invitedUsers.length > 0)
      },
      message: message.trim() || 'No users to invite'
    }

  } catch (error: any) {
    logger.error('[Slack Invite Users] Error:', error)
    return {
      success: false,
      output: {
        success: false,
        error: error.message
      },
      message: `Failed to invite users: ${error.message}`
    }
  }
}

// Export with the expected action name
export const slackActionInviteUsersToChannel = inviteUsersToChannel
