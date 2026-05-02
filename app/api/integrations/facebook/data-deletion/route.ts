import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import { revokeOAuthTokenAsync } from '@/lib/integrations/oauth-revocation'

// Facebook data-deletion callback per
// https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
//
// Two entry shapes:
//   1. Facebook-initiated — POST { signed_request } from Meta. Verify HMAC with
//      FACEBOOK_CLIENT_SECRET, look up the integration by provider_user_id,
//      revoke + delete it.
//   2. User-initiated — POST with a Supabase Bearer token. Authenticate the
//      user, find all of their facebook integrations, revoke + delete them.

interface FacebookSignedRequest {
  algorithm?: string
  user_id?: string
  issued_at?: number
  expires?: number
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (padded.length % 4)) % 4
  return Buffer.from(padded + '='.repeat(padLen), 'base64')
}

function verifyAndParseSignedRequest(signedRequest: string, appSecret: string): FacebookSignedRequest | null {
  const parts = signedRequest.split('.')
  if (parts.length !== 2) return null
  const [encodedSig, payload] = parts

  const expected = createHmac('sha256', appSecret).update(payload).digest()
  const provided = base64UrlDecode(encodedSig)
  if (provided.length !== expected.length) return null
  // Constant-time compare
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ provided[i]
  if (diff !== 0) return null

  try {
    const decoded = JSON.parse(base64UrlDecode(payload).toString('utf-8'))
    if (decoded?.algorithm !== 'HMAC-SHA256') return null
    return decoded as FacebookSignedRequest
  } catch {
    return null
  }
}

function getServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function deleteFacebookIntegrations(
  supabase: ReturnType<typeof getServiceRoleClient>,
  integrations: Array<{ id: string; access_token: string | null; refresh_token: string | null; provider: string }>
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0
  let failed = 0

  for (const integration of integrations) {
    try {
      if (integration.access_token) {
        revokeOAuthTokenAsync(integration.provider, integration.access_token, integration.refresh_token)
      }

      // Mirror the cleanup order used by /api/integrations/[id] DELETE — clear
      // permission/share rows explicitly so RLS cannot block the cascade when
      // running under the service role with auth.uid() = NULL.
      await supabase.from('integration_permissions').delete().eq('integration_id', integration.id)
      await supabase.from('integration_shares').delete().eq('integration_id', integration.id)

      const { error: deleteError } = await supabase
        .from('integrations')
        .delete()
        .eq('id', integration.id)

      if (deleteError) {
        logger.error('[Facebook data-deletion] Failed to delete integration', {
          integrationId: integration.id,
          error: deleteError.message,
        })
        failed++
        continue
      }

      deleted++
    } catch (error: any) {
      logger.error('[Facebook data-deletion] Exception deleting integration', {
        integrationId: integration.id,
        error: error?.message,
      })
      failed++
    }
  }

  return { deleted, failed }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') || ''
  let data: any = {}

  if (contentType.includes('application/json')) {
    data = await request.json()
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData()
    data = Object.fromEntries(formData.entries())
  }

  const supabase = getServiceRoleClient()

  // Facebook-initiated deletion (signed_request from Meta).
  if (data.signed_request) {
    const appSecret = process.env.FACEBOOK_CLIENT_SECRET
    if (!appSecret) {
      logger.error('[Facebook data-deletion] FACEBOOK_CLIENT_SECRET not configured')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const signed = verifyAndParseSignedRequest(data.signed_request, appSecret)
    if (!signed?.user_id) {
      logger.warn('[Facebook data-deletion] Invalid signed_request')
      return NextResponse.json({ error: 'Invalid signed_request' }, { status: 400 })
    }

    const { data: integrations } = await supabase
      .from('integrations')
      .select('id, access_token, refresh_token, provider')
      .eq('provider', 'facebook')
      .eq('provider_user_id', signed.user_id)

    if (integrations && integrations.length > 0) {
      const { deleted, failed } = await deleteFacebookIntegrations(supabase, integrations)
      logger.info('[Facebook data-deletion] Facebook-initiated deletion', {
        facebookUserId: signed.user_id,
        deleted,
        failed,
      })
    } else {
      logger.info('[Facebook data-deletion] No matching integration for Facebook user', {
        facebookUserId: signed.user_id,
      })
    }

    // Confirmation code is the Facebook user_id; status URL must be reachable.
    return NextResponse.json({
      url: 'https://chainreact.app/settings/security?deletion=facebook',
      confirmation_code: signed.user_id,
    })
  }

  // User-initiated deletion (authenticated via Bearer token).
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Authorization header required' }, { status: 401 })
  }
  const token = authHeader.slice('Bearer '.length)
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ success: false, error: 'Invalid authentication token' }, { status: 401 })
  }

  const { data: integrations } = await supabase
    .from('integrations')
    .select('id, access_token, refresh_token, provider')
    .eq('user_id', user.id)
    .eq('provider', 'facebook')

  const { deleted, failed } = await deleteFacebookIntegrations(supabase, integrations || [])
  logger.info('[Facebook data-deletion] User-initiated deletion', {
    userId: user.id,
    deleted,
    failed,
  })

  return NextResponse.json({
    success: true,
    deleted,
    failed,
    message: 'Your Facebook data has been removed from ChainReact.',
  })
}

export async function GET() {
  // Status page for Facebook deletion requests. Facebook's docs suggest a
  // human-readable status URL; the JSON shape is fine for their crawler too.
  return NextResponse.json({ status: 'completed', message: 'Facebook data deletion completed.' })
}
