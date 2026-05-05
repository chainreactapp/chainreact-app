import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/utils/admin-auth'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * POST /api/admin/test-integration-oauth
 * Tests a specific integration's OAuth connection and API functionality
 * Admin only endpoint
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdmin({ capabilities: ['support_admin'] })
    if (!authResult.isAdmin) return authResult.response

    const { userId, serviceClient: supabase } = authResult

    const { provider } = await request.json()

    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 })
    }

    logger.info('[TestIntegrationOAuth] Testing integration:', { provider, userId })

    const startTime = Date.now()
    const warnings: string[] = []

    // Check if OAuth is configured
    const oAuthConfigured = await checkOAuthConfig(provider)
    if (!oAuthConfigured) {
      warnings.push('OAuth credentials not configured in environment variables')
    }

    // Check if user has a connection for this provider
    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    const connectionAvailable = !!integration && !integrationError

    if (!connectionAvailable) {
      warnings.push('No active connection found for this integration')
    }

    // Check if token is valid (not expired)
    let tokenValid = false
    if (integration && integration.expires_at) {
      const expiresAt = new Date(integration.expires_at)
      tokenValid = expiresAt > new Date()

      if (!tokenValid) {
        warnings.push('Access token has expired')
      }
    } else if (integration) {
      tokenValid = true // No expiry means token doesn't expire (or we don't track it)
    }

    // Test API call if connection exists
    let apiCallSuccessful = false
    let apiError: string | undefined

    if (connectionAvailable && integration && tokenValid) {
      try {
        apiCallSuccessful = await testAPICall(provider, integration)
      } catch (error: any) {
        apiError = error.message
        warnings.push(`API call failed: ${error.message}`)
      }
    }

    // Check webhook support
    const webhookSupported = checkWebhookSupport(provider)

    const duration = Date.now() - startTime

    // Determine overall pass/fail
    const passed =
      oAuthConfigured &&
      connectionAvailable &&
      tokenValid &&
      apiCallSuccessful

    const result = {
      provider,
      name: getProviderName(provider),
      category: getProviderCategory(provider),
      oAuthConfigured,
      connectionAvailable,
      tokenValid,
      apiCallSuccessful,
      webhookSupported,
      passed,
      duration,
      error: apiError,
      warnings,
      details: {
        authUrl: integration?.provider ? getAuthUrl(provider) : undefined,
        scopes: integration?.scopes ? (typeof integration.scopes === 'string' ? JSON.parse(integration.scopes) : integration.scopes) : [],
        hasRefreshToken: !!integration?.refresh_token,
        expiresAt: integration?.expires_at,
        lastAPICall: integration?.last_api_call,
      }
    }

    logger.info('[TestIntegrationOAuth] Test complete:', { provider, passed, duration })

    return NextResponse.json(result)

  } catch (error: any) {
    logger.error('[TestIntegrationOAuth] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to test integration' },
      { status: 500 }
    )
  }
}

// Helper functions

async function checkOAuthConfig(provider: string): Promise<boolean> {
  // Check if OAuth client ID and secret are configured
  // Different providers use different env var naming patterns
  const providerUpper = provider.toUpperCase().replace(/-/g, '_')

  // Try multiple naming patterns
  const patterns = [
    `${providerUpper}_CLIENT_ID`,
    `NEXT_PUBLIC_${providerUpper}_CLIENT_ID`,
    `${providerUpper}_APP_ID`,
  ]

  const secretPatterns = [
    `${providerUpper}_CLIENT_SECRET`,
    `${providerUpper}_APP_SECRET`,
    `${providerUpper}_API_KEY`,
  ]

  const hasClientId = patterns.some(pattern => !!process.env[pattern])
  const hasSecret = secretPatterns.some(pattern => !!process.env[pattern])

  return hasClientId && hasSecret
}

async function testAPICall(provider: string, integration: any): Promise<boolean> {
  if (!integration.access_token) {
    throw new Error('No access token available')
  }

  // Provider-specific API test endpoints
  const testEndpoints: Record<string, { url: string, headers?: Record<string, string> }> = {
    'gmail': {
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'slack': {
      url: 'https://slack.com/api/auth.test',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'discord': {
      url: 'https://discord.com/api/users/@me',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'notion': {
      url: 'https://api.notion.com/v1/users/me',
      headers: {
        'Authorization': `Bearer ${integration.access_token}`,
        'Notion-Version': '2022-06-28'
      }
    },
    'github': {
      url: 'https://api.github.com/user',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'stripe': {
      url: 'https://api.stripe.com/v1/account',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'hubspot': {
      url: 'https://api.hubapi.com/oauth/v1/access-tokens/' + integration.access_token,
    },
    'airtable': {
      url: 'https://api.airtable.com/v0/meta/whoami',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'trello': {
      url: 'https://api.trello.com/1/members/me',
      headers: { 'Authorization': `OAuth oauth_consumer_key="${process.env.TRELLO_API_KEY}", oauth_token="${integration.access_token}"` }
    },
    'dropbox': {
      url: 'https://api.dropboxapi.com/2/users/get_current_account',
      headers: {
        'Authorization': `Bearer ${integration.access_token}`,
        'Content-Type': 'application/json'
      }
    },
    'twitter': {
      url: 'https://api.twitter.com/2/users/me',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'facebook': {
      url: 'https://graph.facebook.com/me',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'google-sheets': {
      url: 'https://sheets.googleapis.com/v4/spreadsheets',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'google-calendar': {
      url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'google-drive': {
      url: 'https://www.googleapis.com/drive/v3/about?fields=user',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'google-docs': {
      url: 'https://www.googleapis.com/drive/v3/about?fields=user',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'google-analytics': {
      url: 'https://www.googleapis.com/analytics/v3/management/accounts',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'teams': {
      url: 'https://graph.microsoft.com/v1.0/me',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'outlook': {
      url: 'https://graph.microsoft.com/v1.0/me',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'onedrive': {
      url: 'https://graph.microsoft.com/v1.0/me/drive',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'onenote': {
      url: 'https://graph.microsoft.com/v1.0/me/onenote/notebooks',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'microsoft-excel': {
      url: 'https://graph.microsoft.com/v1.0/me/drive',
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
    'shopify': {
      url: `https://${integration.shop_domain}/admin/api/2024-01/shop.json`,
      headers: { 'X-Shopify-Access-Token': integration.access_token }
    },
    'monday': {
      url: 'https://api.monday.com/v2',
      headers: {
        'Authorization': integration.access_token,
        'Content-Type': 'application/json'
      }
    },
    'mailchimp': {
      url: `https://${integration.server_prefix}.api.mailchimp.com/3.0/`,
      headers: { 'Authorization': `Bearer ${integration.access_token}` }
    },
  }

  const endpoint = testEndpoints[provider]

  if (!endpoint) {
    // Provider doesn't have a test endpoint configured
    return false
  }

  try {
    const response = await fetch(endpoint.url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...endpoint.headers
      }
    })

    return response.ok
  } catch (error) {
    throw new Error(`API call failed: ${error}`)
  }
}

function checkWebhookSupport(provider: string): boolean {
  // List of providers that support webhooks
  const webhookProviders = [
    'stripe',
    'shopify',
    'github',
    'slack',
    'discord',
    'hubspot',
    'airtable',
    'trello',
    'mailchimp',
    'notion',
    'google-calendar',
    'outlook',
    'teams',
    'dropbox',
    'monday',
  ]

  return webhookProviders.includes(provider)
}

function getProviderName(provider: string): string {
  const names: Record<string, string> = {
    'gmail': 'Gmail',
    'outlook': 'Outlook',
    'slack': 'Slack',
    'discord': 'Discord',
    'teams': 'Microsoft Teams',
    'notion': 'Notion',
    'google-drive': 'Google Drive',
    'google-docs': 'Google Docs',
    'google-sheets': 'Google Sheets',
    'google-calendar': 'Google Calendar',
    'google-analytics': 'Google Analytics',
    'microsoft-excel': 'Microsoft Excel',
    'onedrive': 'OneDrive',
    'onenote': 'OneNote',
    'dropbox': 'Dropbox',
    'trello': 'Trello',
    'monday': 'Monday.com',
    'hubspot': 'HubSpot',
    'airtable': 'Airtable',
    'stripe': 'Stripe',
    'shopify': 'Shopify',
    'mailchimp': 'Mailchimp',
    'twitter': 'Twitter (X)',
    'facebook': 'Facebook',
    'github': 'GitHub',
  }

  return names[provider] || provider
}

function getProviderCategory(provider: string): string {
  const categories: Record<string, string> = {
    'gmail': 'Communication',
    'outlook': 'Communication',
    'slack': 'Communication',
    'discord': 'Communication',
    'teams': 'Communication',
    'notion': 'Productivity',
    'google-drive': 'Productivity',
    'google-docs': 'Productivity',
    'google-sheets': 'Productivity',
    'google-calendar': 'Productivity',
    'google-analytics': 'Analytics',
    'microsoft-excel': 'Productivity',
    'onedrive': 'Productivity',
    'onenote': 'Productivity',
    'dropbox': 'Productivity',
    'trello': 'Productivity',
    'monday': 'Productivity',
    'hubspot': 'Business',
    'airtable': 'Business',
    'stripe': 'Business',
    'shopify': 'Business',
    'mailchimp': 'Marketing',
    'twitter': 'Social',
    'facebook': 'Social',
    'github': 'Developer',
  }

  return categories[provider] || 'Other'
}

function getAuthUrl(provider: string): string {
  return `/api/integrations/${provider}/authorize`
}
