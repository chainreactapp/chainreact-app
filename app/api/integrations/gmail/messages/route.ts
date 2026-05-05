import { NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

async function fetchGmailMessages(integrationId?: string) {
  const supabase = await createSupabaseRouteHandlerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return errorResponse("Unauthorized" , 401)
  }

  logger.info('📨 Gmail messages: Looking for integration, integrationId:', integrationId, 'userId:', user.id)

  // Get Gmail integration - try integrationId first, then fall back to user/provider lookup
  let integration = null
  
  if (integrationId) {
    logger.info('📨 Gmail messages: Trying to find integration by ID...')
    const { data: integrationById, error: byIdError } = await supabase
      .from('integrations')
      .select('*')
      .eq('id', integrationId)
      .eq('user_id', user.id) // Security: ensure user owns this integration
      .single()
    logger.info('📨 Gmail messages: Integration by ID result:', integrationById, 'error:', byIdError)
    integration = integrationById
  }
  
  // Fallback to finding by user and provider if integrationId lookup failed
  if (!integration) {
    logger.info('📨 Gmail messages: Trying to find integration by user/provider...')
    const { data: integrationByProvider, error: byProviderError } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', 'gmail')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()
    logger.info('📨 Gmail messages: Integration by provider result:', integrationByProvider, 'error:', byProviderError)
    integration = integrationByProvider
  }

  if (!integration) {
    logger.info('❌ Gmail messages: No integration found!')
    return jsonResponse({ 
      success: false, 
      error: "Integration not found: gmail" 
    }, { status: 404 })
  }

  logger.info('✅ Gmail messages: Integration found:', integration.id, 'status:', integration.status)

  // Use access token directly from integration record
  const accessToken = integration.access_token
  if (!accessToken) {
    logger.error('❌ Gmail messages: No access token in integration record')
    return jsonResponse({ 
      success: false, 
      error: "No access token available" 
    }, { status: 500 })
  }

  logger.info('🔑 Gmail messages: Using access token from integration record')

  // Fetch Gmail messages
  const allMailResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100", {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!allMailResponse.ok) {
    throw new Error(`Gmail API error: ${allMailResponse.status}`)
  }

  const allMail = await allMailResponse.json()
  const messages = []

  // Fetch details for each message
  for (const message of allMail.messages?.slice(0, 20) || []) {
    try {
      const messageResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (messageResponse.ok) {
        const messageData = await messageResponse.json()
        const headers = messageData.payload?.headers || []
        
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || 'No Subject'
        const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown'
        const date = headers.find((h: any) => h.name === 'Date')?.value || ''

        messages.push({
          id: message.id,
          threadId: message.threadId,
          subject,
          from,
          date,
          snippet: messageData.snippet || ''
        })
      }
    } catch (error) {
      logger.error(`Error fetching message ${message.id}:`, error)
    }
  }

  return jsonResponse({
    success: true,
    data: messages.map(msg => ({
      value: msg.id,
      label: `${msg.subject} (from: ${msg.from})`
    }))
  })
}

export async function GET() {
  try {
    return await fetchGmailMessages()
  } catch (error: any) {
    logger.error("Error fetching Gmail messages:", error)
    return jsonResponse({ 
      success: false, 
      error: error.message || "Failed to fetch Gmail messages" 
    }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { integrationId } = body
    return await fetchGmailMessages(integrationId)
  } catch (error: any) {
    logger.error("Error fetching Gmail messages:", error)
    return jsonResponse({ 
      success: false, 
      error: error.message || "Failed to fetch Gmail messages" 
    }, { status: 500 })
  }
} 