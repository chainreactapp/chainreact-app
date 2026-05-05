import { BaseActionHandler } from "./baseActionHandler"
import { IntentAnalysisResult, Integration } from "../aiIntentAnalysisService"
import { ActionExecutionResult } from "../aiActionExecutionService"
import { logger } from '@/lib/utils/logger'
import { isConnectedStatus } from "@/lib/integrations/connectionStatus"

/**
 * Integration Management Handler
 * Handles integration connection, disconnection, and status queries
 */
export class IntegrationManagementHandler extends BaseActionHandler {
  // Map of provider IDs to user-friendly names
  private readonly PROVIDER_NAMES: Record<string, string> = {
    'gmail': 'Gmail',
    'microsoft-outlook': 'Microsoft Outlook',
    'google-calendar': 'Google Calendar',
    'google-drive': 'Google Drive',
    'microsoft-onedrive': 'Microsoft OneDrive',
    'dropbox': 'Dropbox',
    'box': 'Box',
    'notion': 'Notion',
    'airtable': 'Airtable',
    'trello': 'Trello',
    'slack': 'Slack',
    'discord': 'Discord',
    'microsoft-teams': 'Microsoft Teams',
    'hubspot': 'HubSpot',
    'shopify': 'Shopify',
    'stripe': 'Stripe',
    'paypal': 'PayPal',
    'github': 'GitHub',
    'gitlab': 'GitLab',
    'twitter': 'Twitter',
    'facebook': 'Facebook',
    'instagram': 'Instagram',
    'linkedin': 'LinkedIn',
    'tiktok': 'TikTok',
    'youtube': 'YouTube',
    'google-sheets': 'Google Sheets',
    'microsoft-onenote': 'Microsoft OneNote'
  }

  async handleQuery(
    intent: IntentAnalysisResult,
    integrations: Integration[],
    userId: string,
    supabaseAdmin: any
  ): Promise<ActionExecutionResult> {
    this.logHandlerStart("Integration Management Query", intent)

    try {
      const action = intent.action || "list_integrations"

      switch (action) {
        case "list_integrations":
        case "show_integrations":
          return this.handleListIntegrations(integrations)
        case "integration_status":
          return this.handleIntegrationStatus(intent.parameters, integrations)
        case "available_integrations":
          return this.handleAvailableIntegrations(integrations)
        default:
          return this.getErrorResponse(`Integration query "${action}" is not supported yet.`)
      }
    } catch (error: any) {
      logger.error("❌ Integration management query error:", error)
      return this.getErrorResponse("Failed to retrieve integration information.")
    }
  }

  async handleAction(
    intent: IntentAnalysisResult,
    integrations: Integration[],
    userId: string,
    supabaseAdmin: any
  ): Promise<ActionExecutionResult> {
    this.logHandlerStart("Integration Management Action", intent)

    try {
      const action = intent.action || "unknown"
      const provider = intent.parameters?.provider || intent.specifiedIntegration

      switch (action) {
        case "connect_integration":
          return this.handleConnectIntegration(provider, integrations)
        case "disconnect_integration":
          return this.handleDisconnectIntegration(provider, integrations, userId, supabaseAdmin)
        case "reconnect_integration":
          return this.handleReconnectIntegration(provider, integrations)
        default:
          return this.getErrorResponse(`Integration action "${action}" is not supported yet.`)
      }
    } catch (error: any) {
      logger.error("❌ Integration management action error:", error)
      return this.getErrorResponse("Failed to perform integration action.")
    }
  }

  private handleListIntegrations(integrations: Integration[]): ActionExecutionResult {
    if (integrations.length === 0) {
      return {
        content: "You don't have any integrations connected yet. Would you like to connect one?",
        metadata: {
          type: "integration_prompt",
          action: "list_available"
        }
      }
    }

    const connected = integrations.filter(i => isConnectedStatus(i.status))
    const expired = integrations.filter(i => i.status === 'expired' || i.status === 'error')

    let content = `You have ${connected.length} integration${connected.length !== 1 ? 's' : ''} connected`
    if (expired.length > 0) {
      content += ` and ${expired.length} that need reconnection`
    }
    content += '.'

    return {
      content,
      metadata: {
        type: "list",
        items: integrations.map(i => ({
          id: i.id,
          title: this.PROVIDER_NAMES[i.provider] || i.provider,
          subtitle: `Status: ${i.status}`,
          description: `Connected ${new Date(i.created_at).toLocaleDateString()}`,
          badge: i.status,
          badgeVariant: i.status === 'connected' ? 'default' : 'destructive',
          link: `/integrations`,
          metadata: [
            { label: 'Provider', value: i.provider },
            { label: 'Status', value: i.status },
            { label: 'Connected', value: new Date(i.created_at).toLocaleDateString() }
          ]
        }))
      }
    }
  }

  private handleIntegrationStatus(
    parameters: any,
    integrations: Integration[]
  ): ActionExecutionResult {
    const provider = parameters?.provider

    if (provider) {
      const integration = integrations.find(i => i.provider === provider)
      const providerName = this.PROVIDER_NAMES[provider] || provider

      if (!integration) {
        return {
          content: `${providerName} is not connected. Would you like to connect it?`,
          metadata: {
            type: "integration_connect_prompt",
            provider,
            providerName
          }
        }
      }

      return {
        content: `${providerName} is ${integration.status}. Connected on ${new Date(integration.created_at).toLocaleDateString()}.`,
        metadata: {
          type: "integration_status",
          provider: integration.provider,
          providerName,
          status: integration.status,
          connectedDate: new Date(integration.created_at).toLocaleDateString()
        }
      }
    }

    // Overall status
    const connected = integrations.filter(i => isConnectedStatus(i.status)).length
    const needsReconnection = integrations.filter(i => i.status === 'expired' || i.status === 'error').length
    const total = integrations.length

    return {
      content: `Integration Status: ${connected} connected, ${needsReconnection} need reconnection, ${total} total.`,
      metadata: {
        type: "metrics",
        metrics: [
          {
            label: "Connected",
            value: connected,
            icon: "check-circle",
            color: "success"
          },
          {
            label: "Need Reconnection",
            value: needsReconnection,
            icon: "alert-circle",
            color: needsReconnection > 0 ? "warning" : "default"
          },
          {
            label: "Total Integrations",
            value: total,
            icon: "activity",
            color: "info"
          }
        ]
      }
    }
  }

  private handleAvailableIntegrations(integrations: Integration[]): ActionExecutionResult {
    const allProviders = [
      'gmail', 'microsoft-outlook', 'slack', 'discord', 'microsoft-teams',
      'notion', 'airtable', 'trello', 'google-sheets', 'microsoft-onenote',
      'google-drive', 'microsoft-onedrive', 'dropbox', 'box',
      'hubspot', 'stripe', 'shopify', 'paypal',
      'github', 'gitlab',
      'twitter', 'facebook', 'instagram', 'linkedin', 'tiktok', 'youtube',
      'google-calendar'
    ]

    // Build apps list with connection status and dates
    const apps = allProviders.map(providerId => {
      const integration = integrations.find(i => i.provider === providerId)

      let connectedDate = undefined
      let expiresDate = undefined

      if (integration) {
        connectedDate = new Date(integration.created_at).toLocaleDateString('en-US', {
          month: 'numeric',
          day: 'numeric',
          year: 'numeric'
        })

        // Calculate expiration date if token has expiry
        if (integration.expires_at) {
          expiresDate = new Date(integration.expires_at).toLocaleDateString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric'
          })
        }
      }

      return {
        id: providerId,
        name: this.PROVIDER_NAMES[providerId] || providerId,
        connected: !!integration,
        status: integration?.status,
        connectedDate,
        expiresDate
      }
    })

    return {
      content: `Here are the apps available on ChainReact:`,
      metadata: {
        type: "apps_grid",
        apps
      }
    }
  }

  private handleConnectIntegration(
    provider: string | undefined,
    integrations: Integration[]
  ): ActionExecutionResult {
    if (!provider) {
      return {
        content: "Which integration would you like to connect? I support Gmail, Slack, Notion, Google Drive, and many more. Just tell me which one!",
        metadata: {
          type: "question_prompt"
        }
      }
    }

    const providerName = this.PROVIDER_NAMES[provider] || provider

    // Check if already connected
    const existing = integrations.find(i => i.provider === provider)
    if (existing && existing.status === 'connected') {
      return {
        content: `${providerName} is already connected!`,
        metadata: {
          type: "info",
          provider,
          status: "already_connected"
        }
      }
    }

    // Generate OAuth URL (simplified - in production this would call actual OAuth endpoint)
    const oauthUrl = `/api/integrations/${provider}/connect`

    return {
      content: `Let's connect ${providerName}! Click the button below to authorize the connection.`,
      metadata: {
        type: "integration_connect",
        provider,
        providerName,
        oauthUrl,
        action: "connect"
      }
    }
  }

  private async handleDisconnectIntegration(
    provider: string | undefined,
    integrations: Integration[],
    userId: string,
    supabaseAdmin: any
  ): Promise<ActionExecutionResult> {
    if (!provider) {
      return this.getErrorResponse("Please specify which integration to disconnect.")
    }

    const providerName = this.PROVIDER_NAMES[provider] || provider
    const integration = integrations.find(i => i.provider === provider)

    if (!integration) {
      return {
        content: `${providerName} is not connected, so there's nothing to disconnect.`,
        metadata: { type: "info" }
      }
    }

    // Delete integration
    const { error } = await supabaseAdmin
      .from('integrations')
      .delete()
      .eq('id', integration.id)
      .eq('user_id', userId)

    if (error) {
      logger.error("Error disconnecting integration:", error)
      return this.getErrorResponse(`Failed to disconnect ${providerName}.`)
    }

    return {
      content: `Successfully disconnected ${providerName}. You can reconnect it anytime from the Integrations page.`,
      metadata: {
        type: "confirmation",
        provider,
        providerName,
        action: "disconnected"
      }
    }
  }

  private handleReconnectIntegration(
    provider: string | undefined,
    integrations: Integration[]
  ): ActionExecutionResult {
    if (!provider) {
      return this.getErrorResponse("Please specify which integration to reconnect.")
    }

    const providerName = this.PROVIDER_NAMES[provider] || provider
    const integration = integrations.find(i => i.provider === provider)

    if (!integration) {
      return {
        content: `${providerName} is not connected yet. Would you like to connect it for the first time?`,
        metadata: {
          type: "integration_connect_prompt",
          provider,
          providerName
        }
      }
    }

    if (integration.status === 'connected') {
      return {
        content: `${providerName} is working fine and doesn't need reconnection.`,
        metadata: { type: "info" }
      }
    }

    // Generate OAuth URL for reconnection
    const oauthUrl = `/api/integrations/${provider}/connect`

    return {
      content: `Let's reconnect ${providerName}! Click the button below to re-authorize the connection.`,
      metadata: {
        type: "integration_connect",
        provider,
        providerName,
        oauthUrl,
        action: "reconnect"
      }
    }
  }
}
