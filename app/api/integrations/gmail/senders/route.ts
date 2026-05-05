import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/utils/supabase/server'
import { logger } from '@/lib/utils/logger'
import { decrypt } from '@/lib/security/encryption'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get Gmail integration
    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', 'gmail')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (integrationError || !integration) {
      logger.error('[GMAIL SENDERS] No Gmail integration found:', integrationError)
      return NextResponse.json({ error: 'Gmail not connected' }, { status: 404 })
    }

    // Decrypt access token
    const accessToken = decrypt(integration.access_token)

    // Fetch recent messages to extract senders
    // Get last 50 messages to have a good sample of recent senders
    const messagesResponse = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&labelIds=INBOX',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!messagesResponse.ok) {
      throw new Error('Failed to fetch Gmail messages')
    }

    const messagesData = await messagesResponse.json()

    if (!messagesData.messages || messagesData.messages.length === 0) {
      return NextResponse.json({ senders: [] })
    }

    // Fetch full message details to get sender info
    // We'll batch fetch the first 20 messages to get recent senders
    const messagePromises = messagesData.messages.slice(0, 20).map((msg: any) =>
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }).then(res => res.json())
    )

    const messages = await Promise.all(messagePromises)

    // Extract unique senders
    const sendersMap = new Map<string, { email: string; name?: string; count: number }>()

    messages.forEach((message: any) => {
      const fromHeader = message.payload?.headers?.find((h: any) => h.name === 'From')
      if (fromHeader) {
        const fromValue = fromHeader.value
        // Parse "Name <email@example.com>" format
        const emailMatch = fromValue.match(/<(.+?)>/)
        const email = emailMatch ? emailMatch[1] : fromValue.trim()
        const nameMatch = fromValue.match(/^(.+?)\s*</)
        const name = nameMatch ? nameMatch[1].replace(/"/g, '').trim() : undefined

        if (email) {
          const existing = sendersMap.get(email)
          if (existing) {
            existing.count++
          } else {
            sendersMap.set(email, { email, name, count: 1 })
          }
        }
      }
    })

    // Convert to array and sort by count (most frequent first)
    const senders = Array.from(sendersMap.values())
      .sort((a, b) => b.count - a.count)
      .map(sender => ({
        id: sender.email,
        value: sender.email,
        label: sender.name ? `${sender.name} (${sender.email})` : sender.email,
        email: sender.email,
        name: sender.name,
        count: sender.count
      }))

    logger.info('[GMAIL SENDERS] Fetched senders:', { count: senders.length })

    return NextResponse.json({ senders })

  } catch (error: any) {
    logger.error('[GMAIL SENDERS] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch senders' },
      { status: 500 }
    )
  }
}
