import { type NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { cookies } from "next/headers"
import type { Database } from "@/types/supabase"
import { getRequiredScopes, getOptionalScopes } from "@/lib/integrations/integrationScopes"

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

interface DiagnosticResult {
  integrationId: string
  provider: string
  status: "✅ Connected & functional" | "⚠️ Connected but limited" | "❌ Connected but broken"
  tokenValid: boolean
  grantedScopes: string[]
  requiredScopes: string[]
  optionalScopes: string[]
  missingScopes: string[]
  missingRequiredScopes: string[]
  missingOptionalScopes: string[]
  availableComponents: string[]
  unavailableComponents: string[]
  recommendations: string[]
  details: {
    tokenExpiry?: string
    lastVerified?: string
    errorMessage?: string
    connectionType: "oauth" | "demo" | "api_key"
    rawScopeString?: string
  }
}

// Component definitions with their required scopes
const COMPONENT_SCOPE_MAPPING = {
  // Slack components
  slack_message: { scopes: ["chat:write"], provider: "slack" },
  slack_user_info: { scopes: ["users:read"], provider: "slack" },
  slack_channels_list: { scopes: ["channels:read"], provider: "slack" },

  // Discord components
  discord_message: { scopes: ["identify"], provider: "discord" },
  discord_guild_info: { scopes: ["guilds"], provider: "discord" },

  // Microsoft Teams components
  //teams_user_info: { scopes: ["User.Read"], provider: "teams" },
  teams_get_profile: { scopes: ["profile"], provider: "teams" },

  // OneDrive components
  //onedrive_upload: { scopes: ["Files.ReadWrite"], provider: "onedrive" },
  //onedrive_download: { scopes: ["Files.Read"], provider: "onedrive" },

  // Google Calendar components
  google_calendar_create: { scopes: ["https://www.googleapis.com/auth/calendar"], provider: "google-calendar" },
  //google_calendar_read: { scopes: ["https://www.googleapis.com/auth/calendar.readonly"], provider: "google-calendar" },

  // Google Sheets components
  google_sheets_append: { scopes: ["https://www.googleapis.com/auth/spreadsheets"], provider: "google-sheets" },
  //google_sheets_read: { scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"], provider: "google-sheets" },

  // Google Docs components
  google_docs_create: { scopes: ["https://www.googleapis.com/auth/documents"], provider: "google-docs" },
  //google_docs_read: { scopes: ["https://www.googleapis.com/auth/documents.readonly"], provider: "google-docs" },

  // Gmail components
  gmail_send: { scopes: ["https://www.googleapis.com/auth/gmail.modify"], provider: "gmail" },
  gmail_modify: { scopes: ["https://www.googleapis.com/auth/gmail.modify"], provider: "gmail" },

  // Google Drive components
  google_drive_upload: { scopes: ["https://www.googleapis.com/auth/drive"], provider: "google-drive" },
  //google_drive_read: { scopes: ["https://www.googleapis.com/auth/drive"], provider: "google-drive" },

  // YouTube components
  youtube_get_channel: { scopes: ["https://www.googleapis.com/auth/youtube.readonly"], provider: "youtube" },
  youtube_get_videos: { scopes: ["https://www.googleapis.com/auth/youtube.readonly"], provider: "youtube" },
  youtube_get_analytics: { scopes: ["https://www.googleapis.com/auth/youtube.readonly"], provider: "youtube" },

  // GitHub components
  //github_get_user: { scopes: ["user:email"], provider: "github" },
  //github_get_repos: { scopes: ["public_repo"], provider: "github" },
  github_create_issue: { scopes: ["repo"], provider: "github" },
  github_create_pr: { scopes: ["repo"], provider: "github" },

  // GitLab components
  gitlab_get_user: { scopes: ["read_user"], provider: "gitlab" },
  gitlab_get_projects: { scopes: ["read_repository"], provider: "gitlab" },

  // Notion components
  notion_create_page: { scopes: [], provider: "notion" },
  notion_read_page: { scopes: [], provider: "notion" },
  notion_update_page: { scopes: [], provider: "notion" },

  // Airtable components
  airtable_create_record: { scopes: ["data.records:write"], provider: "airtable" },
  airtable_read_records: { scopes: ["data.records:read"], provider: "airtable" },

  // Trello components
  trello_create_card: { scopes: ["write"], provider: "trello" },
  trello_read_boards: { scopes: ["read"], provider: "trello" },

  // Dropbox components
  dropbox_upload: { scopes: ["files.content.write"], provider: "dropbox" },
  dropbox_download: { scopes: ["files.content.read"], provider: "dropbox" },

  // Twitter/X components
  twitter_post_tweet: { scopes: ["tweet.write"], provider: "twitter" },
  twitter_read_tweets: { scopes: ["tweet.read"], provider: "twitter" },
  twitter_get_user: { scopes: ["users.read"], provider: "twitter" },

  // LinkedIn components
  //linkedin_get_profile: { scopes: ["r_liteprofile"], provider: "linkedin" },
  linkedin_post_share: { scopes: ["w_member_social"], provider: "linkedin" },

  // Facebook components
  facebook_get_profile: { scopes: ["public_profile"], provider: "facebook" },
  facebook_post_page: { scopes: ["pages_manage_posts"], provider: "facebook" },

  // Instagram components
  instagram_get_profile: { scopes: ["user_profile"], provider: "instagram" },
  instagram_get_media: { scopes: ["user_media"], provider: "instagram" },

  // TikTok components
  tiktok_get_profile: { scopes: ["user.info.basic"], provider: "tiktok" },
  tiktok_get_videos: { scopes: ["video.list"], provider: "tiktok" },

  // Mailchimp components
  mailchimp_create_campaign: { scopes: ["basic_access"], provider: "mailchimp" },
  mailchimp_add_subscriber: { scopes: ["basic_access"], provider: "mailchimp" },

  // HubSpot components
  //hubspot_create_contact: { scopes: ["contacts"], provider: "hubspot" },
  //hubspot_get_deals: { scopes: ["crm.objects.deals.read"], provider: "hubspot" },

  // Shopify components
  shopify_get_products: { scopes: ["read_products"], provider: "shopify" },
  shopify_create_order: { scopes: ["write_orders"], provider: "shopify" },

  // PayPal components
  paypal_create_payment: { scopes: [], provider: "paypal" },
  paypal_get_transactions: { scopes: [], provider: "paypal" },

  // Stripe components
  stripe_create_payment: { scopes: [], provider: "stripe" },
  stripe_get_customers: { scopes: [], provider: "stripe" },

  // Docker components
  docker_list_containers: { scopes: [], provider: "docker" },
  docker_create_container: { scopes: [], provider: "docker" },
}

function checkTokenExpiry(integration: any): { valid: boolean; error?: string } {
  // Check if token exists
  if (!integration.access_token) {
    return { valid: false, error: "No access token found" }
  }

  // Check if token is expired based on expires_at
  if (integration.expires_at) {
    const now = new Date()
    const expiresAt = new Date(integration.expires_at)

    if (expiresAt < now) {
      return { valid: false, error: "Token expired" }
    }
  }

  // Check if integration is marked as active
  if (integration.is_active === false) {
    return { valid: false, error: "Integration is inactive" }
  }

  return { valid: true }
}

function analyzeIntegration(
  integration: any,
  tokenValid: boolean,
  grantedScopes: string[],
  error?: string,
): DiagnosticResult {
  const provider = integration.provider

  // Get required and optional scopes for this provider
  const requiredScopes = getRequiredScopes(provider)
  const optionalScopes = getOptionalScopes(provider)

  // Find missing scopes
  const missingRequiredScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope))
  const missingOptionalScopes = optionalScopes.filter((scope) => !grantedScopes.includes(scope))

  // Only include missing required scopes in the main missing scopes array
  const missingScopes = missingRequiredScopes

  // Get all components for this provider
  const providerComponents = Object.entries(COMPONENT_SCOPE_MAPPING).filter(
    ([_, config]) => config.provider === provider,
  )

  const availableComponents: string[] = []
  const unavailableComponents: string[] = []

  // Analyze each component
  providerComponents.forEach(([componentName, config]) => {
    // Check if component scopes are satisfied
    const hasRequiredScopes =
      config.scopes.length === 0 || config.scopes.every((scope) => grantedScopes.includes(scope))

    if (hasRequiredScopes) {
      availableComponents.push(componentName)
    } else {
      unavailableComponents.push(componentName)
    }
  })

  const recommendations: string[] = []

  // Determine status
  let status: DiagnosticResult["status"]
  if (!tokenValid) {
    status = "❌ Connected but broken"
    recommendations.push("Reconnect this integration - token is invalid or expired")
  } else if (missingRequiredScopes.length > 0) {
    status = "⚠️ Connected but limited"
    recommendations.push(`Missing ${missingRequiredScopes.length} required scopes`)
    recommendations.push("Reconnect with expanded permissions to unlock more components")
  } else if (unavailableComponents.length > 0) {
    status = "⚠️ Connected but limited"
    recommendations.push(`Some optional features are unavailable due to missing scopes`)
    recommendations.push("Reconnect with expanded permissions to unlock more components")
  } else {
    status = "✅ Connected & functional"
    recommendations.push(`All ${provider} features are available with your current permissions`)
  }

  // Add optional scope recommendations
  if (missingOptionalScopes.length > 0) {
    recommendations.push(`${missingOptionalScopes.length} optional scopes available for additional features`)
  }

  return {
    integrationId: integration.id,
    provider,
    status,
    tokenValid,
    grantedScopes,
    requiredScopes,
    optionalScopes,
    missingScopes, // Keep for backward compatibility
    missingRequiredScopes,
    missingOptionalScopes,
    availableComponents,
    unavailableComponents,
    recommendations,
    details: {
      tokenExpiry: integration.expires_at,
      lastVerified: integration.updated_at,
      errorMessage: error,
      connectionType: integration.access_token ? "oauth" : "api_key",
      rawScopeString: Array.isArray(integration.scopes) ? integration.scopes.join(" ") : "",
    },
  }
}

export async function GET(request: NextRequest) {
  try {
    cookies()
    const supabase = await createSupabaseRouteHandlerClient()
    const {
      data: { user },
      error: sessionError,
    } = await supabase.auth.getUser()

    if (sessionError || !user) {
      return errorResponse("Not authenticated" , 401)
    }

    const userId = user.id

    const { data: integrations, error } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .in("status", CONNECTED_STATUSES_LIST)

    if (error) {
      logger.error("Database error:", error)
      throw error
    }

    const diagnostics: DiagnosticResult[] = []

    for (const integration of integrations || []) {
      const { provider } = integration

      logger.info(`Processing integration: ${provider}`)

      // Check token validity based on database information only
      const tokenCheck = checkTokenExpiry(integration)
      const tokenValid = tokenCheck.valid
      const errorMessage = tokenCheck.error

      // Get granted scopes from integration.scopes column
      const grantedScopes = Array.isArray(integration.scopes) ? integration.scopes : []

      const diagnostic = analyzeIntegration(integration, tokenValid, grantedScopes, errorMessage)
      diagnostics.push(diagnostic)
    }

    return jsonResponse({ diagnostics })
  } catch (error: any) {
    logger.error("Error running diagnostics:", error)
    return errorResponse(error.message , 500)
  }
}
