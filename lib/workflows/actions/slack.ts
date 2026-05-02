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

/**
 * Legacy send message implementation - kept for reference
 * @deprecated Use the wrapper above which calls the new implementation
 */
export async function slackActionSendMessageLegacy(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('💬 [Slack] Starting message send with config:', {
      channel: config.channel,
      hasMessage: !!config.message
    })

    const resolvedConfig = resolveValue(config, input)

    // Extract configuration
    const channel = resolvedConfig.channel
    const message = resolvedConfig.message || resolvedConfig.text
    const threadTs = resolvedConfig.threadTs
    // asUser is now used to enable bot customization (true = customize, false = default bot)
    const customizeBot = resolvedConfig.asUser === true
    const username = resolvedConfig.username
    const iconEmoji = resolvedConfig.iconEmoji
    const icon = resolvedConfig.icon
    const attachments = resolvedConfig.attachments
    const blocks = resolvedConfig.blocks
    const unfurlLinks = resolvedConfig.unfurlLinks !== false
    const unfurlMedia = resolvedConfig.unfurlMedia !== false
    const linkNames = resolvedConfig.linkNames || false

    if (!channel) {
      throw new Error('Channel is required')
    }

    if (!message && !blocks) {
      throw new Error('Message or blocks are required')
    }

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

    logger.info('📤 [Slack] Sending message to channel:', channel, {
      customizeBot,
      hasUsername: !!username,
      hasIcon: !!icon,
      hasIconEmoji: !!iconEmoji,
      hasAttachments: !!attachments
    })

    // Process file attachments if any
    const fileUrls: string[] = []
    const attachmentArray = attachments ? (Array.isArray(attachments) ? attachments : [attachments]) : []

    if (attachmentArray.length > 0) {
      logger.info('📎 [Slack] Processing attachments:', attachmentArray.length)

      for (const attachment of attachmentArray) {
        try {
          let fileUrl: string | null = null

          if (typeof attachment === 'string') {
            // It's a URL or file ID
            if (attachment.startsWith('http')) {
              fileUrl = attachment
            } else {
              // Try to get file from storage service
              const { FileStorageService } = await import('@/lib/storage/fileStorage')
              const fileData = await FileStorageService.getFile(attachment, userId)
              if (fileData) {
                // Upload to temporary storage
                const tempUrl = await uploadToTempStorage(fileData, userId)
                if (tempUrl) fileUrl = tempUrl
              }
            }
          } else if (attachment && typeof attachment === 'object') {
            if (attachment.type === 'base64' && attachment.data) {
              // Base64 encoded file
              logger.info('📎 [Slack] Processing base64 attachment:', attachment.name)

              // Convert base64 to buffer
              const base64Data = attachment.data.split(',')[1] // Remove data:mime;base64, prefix
              const buffer = Buffer.from(base64Data, 'base64')

              // Upload to temporary Supabase storage
              const fileName = `slack-temp/${Date.now()}-${attachment.name || 'attachment'}`
              const { data: uploadData, error: uploadError } = await supabase.storage
                .from('temp-files')
                .upload(fileName, buffer, {
                  contentType: attachment.mimeType || 'application/octet-stream',
                  upsert: false
                })

              if (uploadError) {
                logger.error('❌ [Slack] Failed to upload file to temp storage:', uploadError)
                continue
              }

              // Get public URL
              const { data: { publicUrl } } = supabase.storage
                .from('temp-files')
                .getPublicUrl(fileName)

              fileUrl = publicUrl
              logger.info('✅ [Slack] Uploaded file to temp storage:', fileName)

            } else if (attachment.type === 'file' && attachment.file) {
              // Large file that needs to be uploaded to permanent storage first
              logger.info('📎 [Slack] Processing large file:', attachment.name)

              // This would need to be handled differently - files can't be passed directly
              // from client to server action. The file should be uploaded to storage first
              // and then the storage path should be passed here
              logger.warn('⚠️ [Slack] Large file uploads need to be handled via storage first')
              continue

            } else if (attachment.filePath) {
              // File already in storage
              const { data: storageFile, error } = await supabase.storage
                .from('workflow-files')
                .download(attachment.filePath)

              if (!error && storageFile) {
                const arrayBuffer = await storageFile.arrayBuffer()
                const buffer = Buffer.from(arrayBuffer)

                // Re-upload to temp storage for Slack
                const fileName = `slack-temp/${Date.now()}-${attachment.name || 'attachment'}`
                const { data: uploadData } = await supabase.storage
                  .from('temp-files')
                  .upload(fileName, buffer, {
                    contentType: attachment.mimeType || 'application/octet-stream'
                  })

                if (uploadData) {
                  const { data: { publicUrl } } = supabase.storage
                    .from('temp-files')
                    .getPublicUrl(fileName)
                  fileUrl = publicUrl
                }
              }
            }
          }

          if (fileUrl) {
            fileUrls.push(fileUrl)
          }
        } catch (error) {
          logger.error('❌ [Slack] Error processing attachment:', error)
        }
      }
    }

    // Helper function to upload file data to temp storage
    async function uploadToTempStorage(fileData: any, userId: string): Promise<string | null> {
      try {
        const buffer = Buffer.from(fileData.data, 'base64')
        const fileName = `slack-temp/${Date.now()}-${fileData.fileName || 'attachment'}`

        const { data: uploadData, error } = await supabase.storage
          .from('temp-files')
          .upload(fileName, buffer, {
            contentType: fileData.mimeType || 'application/octet-stream'
          })

        if (error) {
          logger.error('❌ [Slack] Upload to temp storage failed:', error)
          return null
        }

        const { data: { publicUrl } } = supabase.storage
          .from('temp-files')
          .getPublicUrl(fileName)

        return publicUrl
      } catch (error) {
        logger.error('❌ [Slack] Error uploading to temp storage:', error)
        return null
      }
    }

    // Build message payload
    const messagePayload: any = {
      channel,
      text: message,
      unfurl_links: unfurlLinks,
      unfurl_media: unfurlMedia,
      link_names: linkNames
    }

    if (threadTs) {
      messagePayload.thread_ts = threadTs
    }

    // Add bot customization options if enabled
    // Note: This requires the chat:write.customize scope
    if (customizeBot) {
      if (username) {
        messagePayload.username = username
      }

      if (iconEmoji) {
        messagePayload.icon_emoji = iconEmoji
      } else if (icon) {
        // Handle icon URL or emoji
        if (typeof icon === 'string' && icon.startsWith(':') && icon.endsWith(':')) {
          messagePayload.icon_emoji = icon
        } else {
          messagePayload.icon_url = icon
        }
      }
    }

    if (attachments) {
      messagePayload.attachments = attachments
    }

    if (blocks) {
      messagePayload.blocks = blocks
    }

    // If we have file URLs, upload them to Slack using the new API
    const uploadedFileIds: string[] = []
    if (fileUrls.length > 0) {
      logger.info('📤 [Slack] Uploading files to Slack:', fileUrls.length)

      for (const fileUrl of fileUrls) {
        try {
          // For each file URL, we need to use Slack's new file upload API
          // Since we have URLs (not actual file content), we'll include them in the message
          // Slack will unfurl the URLs if they are publicly accessible
          logger.info('📎 [Slack] File URL to share:', fileUrl)
        } catch (error) {
          logger.error('❌ [Slack] Error uploading file to Slack:', error)
        }
      }

      // Add file URLs to the message
      if (fileUrls.length > 0) {
        const fileLinksText = `\n\nAttached files:\n${fileUrls.map((url, i) => `${i + 1}. ${url}`).join('\n')}`
        messagePayload.text = (messagePayload.text || '') + fileLinksText
      }
    }

    // Send message to Slack
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messagePayload)
    })

    const result = await response.json()

    if (!result.ok) {
      logger.error('❌ [Slack] Message send failed:', result)

      if (result.error === 'invalid_auth') {
        throw new Error('Slack authentication expired. Please reconnect your account.')
      } else if (result.error === 'channel_not_found') {
        throw new Error('Channel not found. Please check the channel ID.')
      } else if (result.error === 'not_in_channel') {
        throw new Error('Bot is not in this channel. Please add the bot to the channel first.')
      } else if (result.error === 'is_archived') {
        throw new Error('Cannot post to archived channel.')
      } else {
        throw new Error(`Failed to send message: ${result.error}`)
      }
    }

    logger.info('✅ [Slack] Message sent successfully:', {
      channel: result.channel,
      ts: result.ts
    })

    // Return message details in ActionResult format
    return {
      success: true,
      output: {
        messageId: result.ts,
        channel: result.channel,
        message: result.message?.text || message,
        timestamp: result.ts,
        permalink: result.permalink
      },
      message: `Message sent successfully to ${channel}`
    }
  } catch (error: any) {
    logger.error('❌ [Slack] Send message error:', error)
    return {
      success: false,
      output: {},
      message: `Slack message failed: ${error.message}`
    }
  }
}

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
