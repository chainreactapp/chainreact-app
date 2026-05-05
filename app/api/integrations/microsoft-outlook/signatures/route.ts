import { NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const userId = url.searchParams.get('userId')

    if (!userId) {
      return errorResponse('Missing userId parameter'
      , 400)
    }

    const supabase = await createSupabaseRouteHandlerClient()

    // Check if user has a connected Microsoft Outlook integration
    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'microsoft-outlook')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (integrationError || !integration) {
      // Integration not connected - return empty signatures
      return jsonResponse({
        signatures: [],
        needsConnection: true
      })
    }

    // For now, return empty signatures array
    // TODO: Implement actual Outlook signature fetching via Microsoft Graph API
    // Outlook signatures are complex and require special Graph API permissions
    return jsonResponse({
      signatures: [],
      needsConnection: false
    })

  } catch (error: any) {
    logger.error('[Outlook Signatures API] Error:', error)
    return errorResponse(error.message || 'Failed to fetch Outlook signatures' , 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    logger.info('🔍 [OUTLOOK SIGNATURES] POST endpoint called')
    const body = await request.json()
    const { userId, name, content, isDefault } = body

    logger.info('🔍 [OUTLOOK SIGNATURES] Request body:', { userId, name, hasContent: !!content, isDefault })

    if (!userId || !name || !content) {
      logger.info('❌ [SIGNATURES] Missing required fields')
      return errorResponse('Missing required fields: userId, name, and content are required', 400)
    }

    const supabase = await createSupabaseRouteHandlerClient()

    // Verify user exists
    const { data: userData, error: userError } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('id', userId)
      .single()

    if (userError || !userData) {
      logger.info('❌ [SIGNATURES] User not found:', userError)
      return errorResponse('User not found', 404)
    }

    // Check if user has Outlook integration
    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'microsoft-outlook')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (integrationError || !integration) {
      logger.info('❌ [OUTLOOK SIGNATURES] Outlook integration not connected')
      return errorResponse('Microsoft Outlook integration not connected', 401)
    }

    // Note: Outlook doesn't support creating signatures via API
    // We'll store custom signatures in our database instead
    // TODO: Create a custom_signatures table to store user-created signatures

    // For now, return success but note that Outlook signatures must be managed in Outlook
    logger.info('⚠️ [OUTLOOK SIGNATURES] Outlook API does not support signature creation')

    return jsonResponse({
      success: true,
      message: 'Outlook does not support signature creation via API. Please create signatures in Outlook settings.',
      signature: {
        id: `outlook-custom-${Date.now()}`,
        name: name,
        content: content,
        isDefault: isDefault,
        isCustom: true
      }
    })

  } catch (error: any) {
    logger.error('[Outlook Signatures API] Error creating signature:', error)
    return errorResponse(error.message || 'Failed to create Outlook signature', 500)
  }
}