import { NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { decryptToken } from "@/lib/integrations/tokenUtils"
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { labels, query, startDate, endDate, includeSpamTrash } = body || {}

    // Get authenticated user
    const supabase = await createSupabaseRouteHandlerClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return errorResponse('Unauthorized' , 401)
    }

    // Get Gmail integration
    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('*')
      .eq('provider', 'gmail')
      .eq('user_id', user.id)
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (integrationError || !integration) {
      return errorResponse('No connected Gmail integration found' , 404)
    }

    // Decrypt access token
    if (!integration.access_token) {
      return errorResponse('No access token available for Gmail integration' , 401)
    }

    const accessToken = await decryptToken(integration.access_token)

    if (!accessToken) {
      return errorResponse('Failed to decrypt Gmail access token' , 401)
    }

    // Initialize Gmail API client
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: accessToken })
    const gmail = google.gmail({ version: 'v1', auth })

    // Build the Gmail search query
    let gmailQuery = query || ''

    // Add date filters to the query
    if (startDate) {
      const start = new Date(startDate)
      if (!isNaN(start.valueOf())) {
        // Gmail uses after: operator with yyyy/mm/dd format
        const formattedDate = `${start.getFullYear()}/${(start.getMonth() + 1).toString().padStart(2, '0')}/${start.getDate().toString().padStart(2, '0')}`
        gmailQuery = gmailQuery ? `${gmailQuery} after:${formattedDate}` : `after:${formattedDate}`
      }
    }

    if (endDate) {
      const end = new Date(endDate)
      if (!isNaN(end.valueOf())) {
        // Gmail uses before: operator with yyyy/mm/dd format
        const formattedDate = `${end.getFullYear()}/${(end.getMonth() + 1).toString().padStart(2, '0')}/${end.getDate().toString().padStart(2, '0')}`
        gmailQuery = gmailQuery ? `${gmailQuery} before:${formattedDate}` : `before:${formattedDate}`
      }
    }

    // Add label filter if specified
    let labelIds: string[] = []
    if (labels) {
      labelIds = Array.isArray(labels) ? labels : [labels]
    }

    // Search for messages
    const listParams: any = {
      maxResults: 1,
      q: gmailQuery
    }

    // Add labels to the query
    if (labelIds.length > 0) {
      listParams.labelIds = labelIds
    }

    // Include spam/trash if requested
    if (includeSpamTrash) {
      listParams.includeSpamTrash = true
    }

    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      ...listParams
    })

    if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
      return jsonResponse({
        error: 'No emails found matching criteria',
        searchApplied: true,
        query: gmailQuery
      })
    }

    // Get the full message details
    const messageId = listResponse.data.messages[0].id!
    const messageResponse = await gmail.users.messages.get({
      userId: 'me',
      id: messageId
    })

    const message = messageResponse.data

    // Parse the message headers
    const headers = message.payload?.headers || []
    const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''

    // Parse the body
    let bodyPreview = ''
    if (message.snippet) {
      bodyPreview = message.snippet
    }

    // Check for attachments
    const hasAttachments = message.payload?.parts?.some(part =>
      part.filename && part.filename.length > 0
    ) || false

    // Format the email for preview
    const formattedEmail = {
      id: message.id,
      subject: getHeader('subject'),
      from: getHeader('from'),
      receivedDateTime: getHeader('date'),
      bodyPreview,
      hasAttachments
    }

    return jsonResponse({
      email: formattedEmail,
      emails: [formattedEmail],
      searchApplied: true,
      query: gmailQuery
    })
  } catch (error: any) {
    logger.error('[Gmail Preview] Error:', error)

    // Check if it's a token error
    if (error.message?.includes('401') || error.message?.includes('Invalid Credentials')) {
      return errorResponse('Gmail authentication failed. Please reconnect your account.' , 401)
    }

    return errorResponse(error.message || 'Failed to fetch email preview' , 500)
  }
}