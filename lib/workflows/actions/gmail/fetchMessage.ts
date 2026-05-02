import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { refreshAndRetry } from '../core/refreshAndRetry'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Fetch Gmail messages with various options
 */
export async function fetchGmailMessage(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    const {
      messageId,
      searchQuery,
      maxResults = 10,
      includeSpamTrash = false,
      labelIds = [],
      format = 'full',
      includeAttachments = false,
      markAsRead = false,
      extractLinks = false,
      extractEmails = false
    } = resolvedConfig

    const accessToken = await getDecryptedAccessToken(userId, "gmail")

    // Build a Gmail SDK client for a given token. Every API call below is
    // wrapped in `refreshAndRetry` (Q3, post-§A5 cleanup) so a 401 anywhere
    // triggers one refresh+retry attempt with the new token.
    const buildGmailClient = (token: string) => {
      const oauth2Client = new google.auth.OAuth2()
      oauth2Client.setCredentials({ access_token: token })
      return google.gmail({ version: 'v1', auth: oauth2Client })
    }

    let messages: any[] = []

    if (messageId) {
      // Fetch specific message (principal Q3 wrap).
      try {
        const getResult = await refreshAndRetry({
          provider: 'gmail',
          userId,
          accessToken,
          call: async (token) =>
            buildGmailClient(token).users.messages.get({
              userId: 'me',
              id: messageId,
              format: format as 'minimal' | 'full' | 'raw' | 'metadata'
            }),
        })
        if (!getResult.success) {
          return { success: false, output: {}, message: getResult.message }
        }
        const message = getResult.data
        messages = [message.data]
      } catch (error) {
        return {
          success: false,
          output: {},
          message: `Message ${messageId} not found`
        }
      }
    } else {
      // Search for messages
      const listParams: any = {
        userId: 'me',
        maxResults,
        includeSpamTrash
      }

      if (searchQuery) {
        listParams.q = searchQuery
      }

      if (labelIds.length > 0) {
        listParams.labelIds = labelIds
      }

      // Principal list call (Q3 wrap).
      const listResult = await refreshAndRetry({
        provider: 'gmail',
        userId,
        accessToken,
        call: async (token) =>
          buildGmailClient(token).users.messages.list(listParams),
      })
      if (!listResult.success) {
        return { success: false, output: {}, message: listResult.message }
      }
      const listResponse = listResult.data
      const messageIds = listResponse.data.messages || []

      // Fetch full details for each message (Q3 wrap; non-401 errors still
      // logged + skipped to preserve partial-success behavior).
      for (const msg of messageIds) {
        try {
          const fullMessageResult = await refreshAndRetry({
            provider: 'gmail',
            userId,
            accessToken,
            call: async (token) =>
              buildGmailClient(token).users.messages.get({
                userId: 'me',
                id: msg.id!,
                format: format as 'minimal' | 'full' | 'raw' | 'metadata'
              }),
          })
          if (!fullMessageResult.success) {
            logger.warn(`Failed to fetch message ${msg.id}: ${fullMessageResult.message}`)
            continue
          }
          messages.push(fullMessageResult.data.data)
        } catch (error) {
          logger.warn(`Failed to fetch message ${msg.id}:`, error)
        }
      }
    }

    // Process messages
    const processedMessages = messages.map(msg => {
      const processed: any = {
        id: msg.id,
        threadId: msg.threadId,
        labelIds: msg.labelIds,
        snippet: msg.snippet
      }

      // Extract headers
      if (msg.payload?.headers) {
        const headers: Record<string, string> = {}
        msg.payload.headers.forEach((header: any) => {
          headers[header.name.toLowerCase()] = header.value
        })
        
        processed.from = headers.from
        processed.to = headers.to
        processed.subject = headers.subject
        processed.date = headers.date
        processed.cc = headers.cc
        processed.bcc = headers.bcc
      }

      // Extract body
      let body = ''
      let htmlBody = ''
      
      if (msg.payload?.parts) {
        for (const part of msg.payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            body += Buffer.from(part.body.data, 'base64').toString('utf-8')
          } else if (part.mimeType === 'text/html' && part.body?.data) {
            htmlBody += Buffer.from(part.body.data, 'base64').toString('utf-8')
          }
        }
      } else if (msg.payload?.body?.data) {
        body = Buffer.from(msg.payload.body.data, 'base64').toString('utf-8')
      }
      
      processed.body = body
      processed.htmlBody = htmlBody

      // Extract attachments info
      if (includeAttachments && msg.payload?.parts) {
        processed.attachments = msg.payload.parts
          .filter((part: any) => part.filename)
          .map((part: any) => ({
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body?.size || 0,
            attachmentId: part.body?.attachmentId
          }))
      }

      // Extract links from body
      if (extractLinks) {
        const linkRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g
        const allText = `${body } ${ htmlBody}`
        const links = [...new Set(allText.match(linkRegex) || [])]
        processed.extractedLinks = links
      }

      // Extract email addresses
      if (extractEmails) {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
        const allText = `${body } ${ htmlBody } ${ processed.from } ${ processed.to } ${ processed.cc}`
        const emails = [...new Set(allText.match(emailRegex) || [])]
        processed.extractedEmails = emails
      }

      return processed
    })

    // Mark messages as read if requested. Auxiliary post-fetch call wrapped
    // in `refreshAndRetry` (Q3, post-§A5 cleanup). Best-effort: non-401
    // errors are logged + swallowed so the read-success isn't overridden by
    // a markAsRead failure on one message.
    if (markAsRead && messages.length > 0) {
      for (const msg of messages) {
        try {
          await refreshAndRetry({
            provider: 'gmail',
            userId,
            accessToken,
            call: async (token) =>
              buildGmailClient(token).users.messages.modify({
                userId: 'me',
                id: msg.id,
                requestBody: {
                  removeLabelIds: ['UNREAD']
                }
              }),
          })
        } catch (error) {
          logger.warn(`Failed to mark message ${msg.id} as read:`, error)
        }
      }
    }

    return {
      success: true,
      output: {
        messageCount: processedMessages.length,
        messages: processedMessages
      },
      message: `Fetched ${processedMessages.length} message(s)`
    }

  } catch (error: any) {
    logger.error('Fetch Gmail message error:', error)
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to fetch messages'
    }
  }
}