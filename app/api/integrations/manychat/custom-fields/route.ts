import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/utils/supabase/server'
import { logger } from '@/lib/utils/logger'
import { decrypt } from '@/lib/security/encryption'
import { createManyChatClient } from '@/lib/integrations/providers/manychat/client'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get integration ID from query params
    const searchParams = request.nextUrl.searchParams
    const integrationId = searchParams.get('integrationId')

    if (!integrationId) {
      return NextResponse.json({ error: 'Integration ID required' }, { status: 400 })
    }

    // Get ManyChat integration
    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('*')
      .eq('id', integrationId)
      .eq('user_id', user.id)
      .eq('provider', 'manychat')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (integrationError || !integration) {
      logger.error('[MANYCHAT CUSTOM FIELDS] No ManyChat integration found:', integrationError)
      return NextResponse.json({ error: 'ManyChat not connected' }, { status: 404 })
    }

    // Decrypt API key
    const apiKey = decrypt(integration.access_token)

    // Create ManyChat client and fetch custom fields
    const client = createManyChatClient(apiKey)
    const fields = await client.getCustomFields()

    logger.info(`[MANYCHAT CUSTOM FIELDS] Fetched ${fields.length} custom fields`)

    return NextResponse.json({ fields })

  } catch (error: any) {
    logger.error('[MANYCHAT CUSTOM FIELDS] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch custom fields' },
      { status: 500 }
    )
  }
}
