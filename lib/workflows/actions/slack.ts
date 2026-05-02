/**
 * Slack Actions
 */

import { ActionResult } from './core/executeWait'
import { getDecryptedAccessToken } from './core/getDecryptedAccessToken'
import { resolveValue } from './core/resolveValue'
import { requireExplicitField } from './core/requireExplicitField'
import { sendSlackMessage as sendSlackMessageNew } from './slack/sendMessage'

// Re-export actions so consumers of "./slack" continue working
export { slackActionDeleteMessage } from './slack/deleteMessage'
export { slackActionAddReaction } from './slack/addReaction'
export { slackActionAddReminder } from './slack/addReminder'
export { slackActionInviteUsersToChannel } from './slack/inviteUsersToChannel'
export { slackActionArchiveChannel } from './slack/archiveChannel'
export { slackActionUnarchiveChannel } from './slack/unarchiveChannel'
export { slackActionJoinChannel } from './slack/joinChannel'
export { slackActionLeaveChannel } from './slack/leaveChannel'
export { slackActionRenameChannel } from './slack/renameChannel'
export { slackActionSetChannelTopic } from './slack/setChannelTopic'
export { slackActionSetChannelPurpose } from './slack/setChannelPurpose'
export { slackActionGetChannelInfo } from './slack/getChannelInfo'
export { slackActionListChannels } from './slack/listChannels'
export { slackActionRemoveUserFromChannel } from './slack/removeUserFromChannel'
export { slackActionGetUserInfo } from './slack/getUserInfo'
export { slackActionListUsers } from './slack/listUsers'
export { slackActionFindUser } from './slack/findUser'
export { slackActionSendDirectMessage } from './slack/sendDirectMessage'
export { slackActionUpdateMessage } from './slack/updateMessage'
export { slackActionRemoveReaction } from './slack/removeReaction'
export { slackActionPinMessage } from './slack/pinMessage'
export { slackActionUnpinMessage } from './slack/unpinMessage'
export { slackActionScheduleMessage } from './slack/scheduleMessage'
export { slackActionCancelScheduledMessage } from './slack/cancelScheduledMessage'
export { slackActionListScheduledMessages } from './slack/listScheduledMessages'
export { slackActionGetThreadMessages } from './slack/getThreadMessages'
export { slackActionUploadFile } from './slack/uploadFile'
export { slackActionDownloadFile } from './slack/downloadFile'
export { slackActionGetFileInfo } from './slack/getFileInfo'
export { slackActionPostInteractive } from './slack/postInteractiveBlocks'
export { slackActionSetUserPresence } from './slack/setUserPresence'
export { slackActionUpdateUserStatus } from './slack/updateUserStatus'

import { logger } from '@/lib/utils/logger'

/**
 * Wrapper for the new Slack send message implementation
 * This creates an ExecutionContext and calls the new handler
 */
export async function slackActionSendMessage(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Create ExecutionContext for the new handler
    const context = {
      userId,
      workflowId: input.workflowId || '',
      executionId: input.executionId || '',
      nodeId: input.nodeId || '',
      testMode: input.testMode || false,
      config,
      dataFlowManager: {
        resolveVariable: (value: any) => {
          if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
            const match = value.match(/\{\{([^}]+)\}\}/);
            if (match) {
              const path = match[1].split('.');
              let result: any = input;
              for (const key of path) {
                result = result?.[key];
              }
              return result !== undefined ? result : value;
            }
          }
          return value;
        },
        getNodeOutput: (nodeId: string) => {
          return input.previousResults?.[nodeId];
        },
        setNodeOutput: () => {},
        getTriggerData: () => input.trigger
      },
      getIntegration: async (provider: string) => {
        const { createSupabaseServerClient } = await import('@/utils/supabase/server')
        const supabase = await createSupabaseServerClient()

        const { data: integration } = await supabase
          .from('integrations')
          .select('*')
          .eq('user_id', userId)
          .eq('provider', provider)
          .eq('status', 'connected')
          .single()

        return integration
      }
    }

    // Call the new handler with ExecutionContext
    return await sendSlackMessageNew(context)
  } catch (error: any) {
    logger.error('Slack send message error:', error)
    throw error
  }
}

// `slackActionSendMessageLegacy` (319 lines) was @deprecated and had
// zero callers. Removed in §E sweep — 2026-05-02. The active path is
// `slackActionSendMessage` above (which delegates to the new
// ExecutionContext-shaped `sendSlackMessageNew` implementation).

/**
 * Create a new Slack channel
 */
export async function createSlackChannel(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('🆕 [Slack] Starting channel creation with config:', {
      channelName: config.channelName,
      visibility: config.visibility,
      template: config.template
    })

    const resolvedConfig = resolveValue(config, input)

    // Q11 — visibility is a workspace-wide channel-creation decision
    // (public exposes the channel to the entire workspace). Previous silent
    // default `'public'` removed; workflow author must explicitly choose.
    const missingRequired = requireExplicitField(resolvedConfig, 'visibility')
    if (missingRequired) return missingRequired as unknown as ActionResult

    // Extract configuration
    const channelName = resolvedConfig.channelName
    const visibility = resolvedConfig.visibility
    const isPrivate = visibility === 'private'
    const workspace = resolvedConfig.workspace
    const addPeople = resolvedConfig.addPeople
    const autoAddNewMembers = resolvedConfig.autoAddNewMembers

    // Template fields
    const channelTopic = resolvedConfig.channelTopic
    const initialMessage = resolvedConfig.initialMessage
    const pinnedMessages = resolvedConfig.pinnedMessages || []
    const template = resolvedConfig.template

    if (!channelName) {
      throw new Error('Channel name is required')
    }

    // Sanitize channel name - Slack requires lowercase, no spaces, only letters/numbers/hyphens/underscores
    const sanitizedChannelName = channelName
      .toLowerCase()
      .replace(/\s+/g, '-')           // Replace spaces with hyphens
      .replace(/[^a-z0-9-_]/g, '')    // Remove invalid characters
      .replace(/^-+|-+$/g, '')        // Remove leading/trailing hyphens
      .substring(0, 80)               // Max 80 characters

    if (!sanitizedChannelName) {
      throw new Error('Channel name contains no valid characters. Use letters, numbers, hyphens, or underscores.')
    }

    logger.info('🔤 [Slack] Sanitized channel name:', { original: channelName, sanitized: sanitizedChannelName })

    // Get Slack integration
    const { createSupabaseServerClient } = await import('@/utils/supabase/server')
    const supabase = await createSupabaseServerClient()

    const { data: integration } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'slack')
      .eq('status', 'connected')
      .single()

    if (!integration) {
      throw new Error('Slack integration not connected')
    }

    // Get decrypted access token
    const accessToken = await getDecryptedAccessToken(userId, 'slack')

    if (!accessToken) {
      throw new Error('Failed to get Slack access token')
    }

    logger.info('📤 [Slack] Creating channel:', sanitizedChannelName)

    // Create the channel
    const createResponse = await fetch('https://slack.com/api/conversations.create', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: sanitizedChannelName,
        is_private: isPrivate
      })
    })

    const createResult = await createResponse.json()

    if (!createResult.ok) {
      logger.error('❌ [Slack] Channel creation failed:', createResult)

      if (createResult.error === 'invalid_auth') {
        throw new Error('Slack authentication expired. Please reconnect your account.')
      } else if (createResult.error === 'name_taken') {
        throw new Error('Channel name already exists. Please choose a different name.')
      } else if (createResult.error === 'invalid_name' || createResult.error === 'invalid_name_specials') {
        throw new Error('Invalid channel name. Channel names must be lowercase and can only contain letters, numbers, hyphens, and underscores (no spaces or special characters).')
      } else if (createResult.error === 'missing_scope') {
        throw new Error('Missing required Slack permissions. Please disconnect and reconnect your Slack account to grant the channels:manage scope.')
      } else {
        throw new Error(`Failed to create channel: ${createResult.error}`)
      }
    }

    const channelId = createResult.channel.id
    logger.info('✅ [Slack] Channel created successfully:', channelId)

    // Set channel topic if provided
    if (channelTopic) {
      await fetch('https://slack.com/api/conversations.setTopic', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel: channelId,
          topic: channelTopic
        })
      })
    }

    // Send initial message if provided
    if (initialMessage) {
      const messageResult = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel: channelId,
          text: initialMessage
        })
      })

      const messageData = await messageResult.json()

      // Pin the initial message if it was sent successfully
      if (messageData.ok && messageData.ts) {
        await fetch('https://slack.com/api/pins.add', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channel: channelId,
            timestamp: messageData.ts
          })
        })
      }
    }

    // Send and pin additional messages
    for (const pinnedMessage of pinnedMessages) {
      if (pinnedMessage.content) {
        const messageResult = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channel: channelId,
            text: pinnedMessage.content
          })
        })

        const messageData = await messageResult.json()

        // Pin the message
        if (messageData.ok && messageData.ts) {
          await fetch('https://slack.com/api/pins.add', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              channel: channelId,
              timestamp: messageData.ts
            })
          })
        }
      }
    }

    // Add template-specific content
    if (template && template !== 'blank') {
      await applyChannelTemplate(channelId, template, resolvedConfig, accessToken)
    }

    // Invite users to the channel if provided
    if (addPeople && Array.isArray(addPeople)) {
      for (const user of addPeople) {
        await fetch('https://slack.com/api/conversations.invite', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channel: channelId,
            users: user
          })
        })
      }
    }

    // Return channel details in ActionResult format
    return {
      success: true,
      output: {
        channelId,
        channelName: createResult.channel.name,
        isPrivate,
        created: true,
        template: template || 'blank'
      },
      message: `Channel "${channelName}" created successfully`
    }
  } catch (error: any) {
    logger.error('❌ [Slack] Create channel error:', error)
    return {
      success: false,
      output: {},
      message: `Slack channel creation failed: ${error.message}`
    }
  }
}

/**
 * Apply template content to a channel
 */
async function applyChannelTemplate(
  channelId: string,
  template: string,
  config: any,
  accessToken: string
): Promise<void> {
  // Send template-specific messages based on the selected template
  const templateMessages: string[] = []

  switch (template) {
    case 'bug-intake-and-triage':
      if (config.bugReportTemplate) {
        templateMessages.push(config.bugReportTemplate)
      }
      break

    case 'project-starter-kit':
      if (config.projectSections) {
        for (const section of config.projectSections) {
          if (section.title && section.content) {
            templateMessages.push(`**${section.title}**\n\n${section.content}`)
          }
        }
      }
      break

    case 'help-requests-process':
      if (config.helpCategories && config.helpCategories.length > 0) {
        let categoriesMessage = '**Help Request Categories:**\n'
        for (const cat of config.helpCategories) {
          categoriesMessage += `• ${cat.category}`
          if (cat.description) {
            categoriesMessage += ` - ${cat.description}`
          }
          categoriesMessage += '\n'
        }
        templateMessages.push(categoriesMessage)
      }
      break

    // Add more template implementations as needed
  }

  // Send all template messages
  for (const message of templateMessages) {
    if (message) {
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel: channelId,
          text: message
        })
      })
    }
  }
}
