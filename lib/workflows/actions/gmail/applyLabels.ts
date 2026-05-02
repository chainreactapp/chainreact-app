import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { refreshAndRetry } from '../core/refreshAndRetry'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Apply labels to Gmail messages
 */
export async function applyGmailLabels(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    const {
      messageId,
      threadId,
      labels = [],
      labelIds = [],
      addLabels = [],
      removeLabels = [],
      createIfNotExists = false,
      applyToThread = false,
      searchQuery
    } = resolvedConfig

    const accessToken = await getDecryptedAccessToken(userId, "gmail")

    // Build a Gmail SDK client for a given token. All API calls in this
    // handler are wrapped in `refreshAndRetry` (Q3, post-§A5 cleanup) so a
    // 401 on any of them triggers one refresh+retry attempt. Building the
    // client inside each closure means the retry uses the refreshed token
    // end-to-end.
    const buildGmailClient = (token: string) => {
      const oauth2Client = new google.auth.OAuth2()
      oauth2Client.setCredentials({ access_token: token })
      return google.gmail({ version: 'v1', auth: oauth2Client })
    }

    // Combine labels for backward compatibility
    const labelsToAdd = [...labels, ...addLabels].filter(Boolean)
    const labelsToRemove = removeLabels.filter(Boolean)

    // Get or create labels
    const labelIdsToProcess: { add: string[], remove: string[] } = { add: [], remove: [] }

    // If labelIds are provided directly (from multiselect), use them
    if (labelIds.length > 0) {
      labelIdsToProcess.add.push(...labelIds)
    }
    
    // Fetch existing labels (Q3 wrap).
    const labelsListResult = await refreshAndRetry({
      provider: 'gmail',
      userId,
      accessToken,
      call: async (token) =>
        buildGmailClient(token).users.labels.list({ userId: 'me' }),
    })
    if (!labelsListResult.success) {
      return { success: false, output: {}, message: labelsListResult.message }
    }
    const existingLabelsResponse = labelsListResult.data
    const existingLabels = existingLabelsResponse.data.labels || []
    const labelMap = new Map(existingLabels.map(l => [l.name?.toLowerCase(), l.id]))

    // Process labels to add (only if labelIds not directly provided)
    if (labelIds.length === 0 && labelsToAdd.length > 0) {
      for (const labelName of labelsToAdd) {
        let labelId = labelMap.get(labelName.toLowerCase())

        if (!labelId && createIfNotExists) {
          // Create the label (Q3 wrap; non-401 errors still logged + skipped).
          try {
            const createResult = await refreshAndRetry({
              provider: 'gmail',
              userId,
              accessToken,
              call: async (token) =>
                buildGmailClient(token).users.labels.create({
                  userId: 'me',
                  requestBody: {
                    name: labelName,
                    labelListVisibility: 'labelShow',
                    messageListVisibility: 'show'
                  }
                }),
            })
            if (!createResult.success) {
              logger.warn(`Failed to create label ${labelName}: ${createResult.message}`)
              continue
            }
            const newLabel = createResult.data
            labelId = newLabel.data.id
            logger.info(`Created new label: ${labelName} (${labelId})`)
          } catch (error) {
            logger.warn(`Failed to create label ${labelName}:`, error)
            continue
          }
        }

        if (labelId) {
          labelIdsToProcess.add.push(labelId)
        }
      }
    }

    // Process labels to remove
    for (const labelName of labelsToRemove) {
      const labelId = labelMap.get(labelName.toLowerCase())
      if (labelId) {
        labelIdsToProcess.remove.push(labelId)
      }
    }

    // Determine target messages
    let targetMessages: string[] = []

    if (messageId) {
      // Handle different messageId formats:
      // 1. Array of objects with id property (e.g., from search results)
      // 2. Array of strings (message IDs)
      // 3. Single string (message ID)
      if (Array.isArray(messageId)) {
        targetMessages = messageId
          .map(item => typeof item === 'object' && item?.id ? item.id : item)
          .filter(Boolean)
      } else {
        targetMessages.push(messageId)
      }
    } else if (searchQuery) {
      // Search for messages matching the query (Q3 wrap).
      const searchResult = await refreshAndRetry({
        provider: 'gmail',
        userId,
        accessToken,
        call: async (token) =>
          buildGmailClient(token).users.messages.list({
            userId: 'me',
            q: searchQuery,
            maxResults: 100
          }),
      })
      if (!searchResult.success) {
        return { success: false, output: {}, message: searchResult.message }
      }
      const searchResponse = searchResult.data
      targetMessages = searchResponse.data.messages?.map(m => m.id!).filter(Boolean) || []
    } else if (threadId) {
      // Get all messages in the thread (Q3 wrap).
      const threadResult = await refreshAndRetry({
        provider: 'gmail',
        userId,
        accessToken,
        call: async (token) =>
          buildGmailClient(token).users.threads.get({
            userId: 'me',
            id: threadId
          }),
      })
      if (!threadResult.success) {
        return { success: false, output: {}, message: threadResult.message }
      }
      const threadResponse = threadResult.data
      targetMessages = threadResponse.data.messages?.map(m => m.id!).filter(Boolean) || []
    }

    if (targetMessages.length === 0) {
      return {
        success: false,
        output: {},
        message: 'No messages found to apply labels to'
      }
    }

    // Apply labels to messages
    const results = []
    for (const msgId of targetMessages) {
      try {
        const modifyRequest: any = {
          userId: 'me',
          id: msgId,
          requestBody: {}
        }
        
        if (labelIdsToProcess.add.length > 0) {
          modifyRequest.requestBody.addLabelIds = labelIdsToProcess.add
        }
        if (labelIdsToProcess.remove.length > 0) {
          modifyRequest.requestBody.removeLabelIds = labelIdsToProcess.remove
        }

        if (labelIdsToProcess.add.length > 0 || labelIdsToProcess.remove.length > 0) {
          // Principal modify call wrapped in `refreshAndRetry` (Q3,
          // post-§A5 cleanup). Per-message failures (including
          // permanent auth) get pushed into `results` rather than
          // aborting the loop, so partial success is preserved across
          // the batch — matches the prior catch-and-record semantics.
          const modifyResult = await refreshAndRetry({
            provider: 'gmail',
            userId,
            accessToken,
            call: async (token) =>
              buildGmailClient(token).users.messages.modify(modifyRequest),
          })
          if (!modifyResult.success) {
            results.push({
              messageId: msgId,
              success: false,
              error: modifyResult.message
            })
          } else {
            const result = modifyResult.data
            results.push({
              messageId: msgId,
              success: true,
              labelIds: result.data.labelIds
            })
          }
        }
      } catch (error) {
        logger.warn(`Failed to modify message ${msgId}:`, error)
        results.push({
          messageId: msgId,
          success: false,
          error: (error as any).message
        })
      }
    }

    const successCount = results.filter(r => r.success).length

    if (successCount === 0 && results.length > 0) {
      const firstError = results.find(r => !r.success)?.error || 'Unknown error'
      return {
        success: false,
        output: {},
        message: `Failed to apply labels: ${firstError}`,
      }
    }

    return {
      success: successCount > 0,
      output: {
        processedMessages: targetMessages.length,
        successfulUpdates: successCount,
        labelsAdded: labelsToAdd,
        labelsRemoved: labelsToRemove,
        results
      },
      message: `Labels applied to ${successCount} of ${targetMessages.length} messages`
    }

  } catch (error: any) {
    logger.error('Apply Gmail labels error:', error)
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to apply labels'
    }
  }
}