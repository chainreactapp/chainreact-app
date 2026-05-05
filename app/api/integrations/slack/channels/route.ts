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

    // Get Slack integration
    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', 'slack')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (integrationError || !integration) {
      logger.error('[SLACK CHANNELS] No Slack integration found:', integrationError)
      return NextResponse.json({ error: 'Slack not connected' }, { status: 404 })
    }

    // Decrypt access token
    const accessToken = decrypt(integration.access_token)

    // Fetch channels from Slack API
    const response = await fetch('https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=1000', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error('Failed to fetch Slack channels')
    }

    const data = await response.json()

    if (!data.ok) {
      throw new Error(data.error || 'Slack API error')
    }

    // Format channels for dropdown
    const channels = data.channels.map((channel: any) => ({
      id: channel.id,
      name: channel.name,
      label: `#${channel.name}`,
      value: channel.id,
      isPrivate: channel.is_private
    }))

    logger.info('[SLACK CHANNELS] Fetched channels:', { count: channels.length })

    return NextResponse.json({ channels })

  } catch (error: any) {
    logger.error('[SLACK CHANNELS] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch channels' },
      { status: 500 }
    )
  }
}
