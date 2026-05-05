import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/utils/supabase/server'
import { logger } from '@/lib/utils/logger'
import { decrypt } from '@/lib/security/encryption'
import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Get ManyChat flows
 * Note: ManyChat API doesn't have a public endpoint for listing flows yet.
 * This endpoint returns a placeholder response for now.
 * TODO: Update when ManyChat adds flow listing API
 */
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
      logger.error('[MANYCHAT FLOWS] No ManyChat integration found:', integrationError)
      return NextResponse.json({ error: 'ManyChat not connected' }, { status: 404 })
    }

    // Decrypt API key
    const apiKey = decrypt(integration.access_token)

    // Try to fetch flows from ManyChat API
    // Note: This endpoint may not be available in all ManyChat API versions
    try {
      const response = await fetchWithTimeout(
        'https://api.manychat.com/fb/page/getFlows',
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
        8000
      )

      if (response.ok) {
        const data = await response.json()
        const flows = data.data || []
        logger.info(`[MANYCHAT FLOWS] Fetched ${flows.length} flows`)
        return NextResponse.json({ flows })
      }
    } catch (apiError: any) {
      logger.warn('[MANYCHAT FLOWS] API endpoint not available:', apiError.message)
    }

    // Return empty array with helper message if API not available
    logger.info('[MANYCHAT FLOWS] Flow listing API not available, returning helper message')
    return NextResponse.json({
      flows: [],
      message: 'Flow listing requires manual configuration. Please enter the flow namespace manually.',
      note: 'You can find flow namespaces in your ManyChat dashboard under Automation > Flows. They look like: content20220101000000_123456'
    })

  } catch (error: any) {
    logger.error('[MANYCHAT FLOWS] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch flows' },
      { status: 500 }
    )
  }
}
