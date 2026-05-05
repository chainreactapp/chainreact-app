import { TriggerLifecycle, TriggerActivationContext, TriggerDeactivationContext, TriggerHealthStatus } from '../types'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt, encrypt } from '@/lib/security/encryption'
import { logger } from '@/lib/utils/logger'
import { getWebhookBaseUrl } from '@/lib/utils/getBaseUrl'
import { generateEncryptionCertificate, rotateCertificateIfNeeded } from '@/lib/utils/encryptionCertificate'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Microsoft Teams Trigger Lifecycle Handler
 *
 * Manages Graph API change notification subscriptions for Teams triggers
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions
 *
 * Supported Resources:
 * - /teams/{id}/channels/{id}/messages - Channel messages
 * - /chats/{id}/messages - Chat messages
 * - /chats - All chats
 * - /teams/{id}/channels - Channels in a team
 */
export class TeamsTriggerLifecycle implements TriggerLifecycle {
  /**
   * Create a Graph API subscription when workflow is activated
   */
  async onActivate(context: TriggerActivationContext): Promise<void> {
    const { workflowId, userId, nodeId, triggerType, config, testMode } = context

    const modeLabel = testMode ? '🧪 TEST' : '🚀 PRODUCTION'
    logger.info(`${modeLabel} [Teams Trigger] Activating trigger:`, { workflowId, triggerType, nodeId })

    try {
      const supabase = createAdminClient()

      // Get Teams integration
      const { data: integration, error: integrationError } = await supabase
        .from('integrations')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', 'teams')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      if (integrationError || !integration || !integration.access_token) {
        logger.error('[Teams Trigger] Integration error:', integrationError)
        throw new Error('Teams integration not found or not connected')
      }

      let accessToken = await decrypt(integration.access_token)

      if (triggerType === 'teams_trigger_new_chat') {
        const appAccessToken = await this.getAppOnlyAccessToken()
        logger.info('[Teams Trigger] Using app-only token for new chat subscription')
        accessToken = appAccessToken
      }
      if (triggerType === 'teams_trigger_new_chat_message' && !config?.chatId) {
        const appAccessToken = await this.getAppOnlyAccessToken()
        logger.info('[Teams Trigger] Using app-only token for all-chats subscription')
        accessToken = appAccessToken
      }

      // Build subscription resource based on trigger type
      const resource = this.buildSubscriptionResource(triggerType, config)
      const changeTypes = this.getChangeTypes(triggerType)

      // Subscription expires in 4230 minutes (3 days - max for most resources)
      const expirationDateTime = new Date()
      expirationDateTime.setMinutes(expirationDateTime.getMinutes() + 4230)

      // Avoid includeResourceData for Teams subscriptions to prevent certificate validation failures.
      // We'll fetch resource details separately when needed.
      const includeResourceData = false

      // Create subscription
      const baseUrl = getWebhookBaseUrl()
      const webhookUrl = `${baseUrl}/api/webhooks/teams`
      const subscriptionPayload: any = {
        changeType: changeTypes.join(','),
        notificationUrl: webhookUrl,
        lifecycleNotificationUrl: webhookUrl, // Receive lifecycle events
        resource: resource,
        expirationDateTime: expirationDateTime.toISOString(),
        clientState: `workflow_${workflowId}`, // Used to validate notifications
        includeResourceData
      }

      logger.info('[Teams Trigger] Creating subscription:', {
        resource,
        changeType: subscriptionPayload.changeType,
        webhookUrl,
        lifecycleNotificationUrl: subscriptionPayload.lifecycleNotificationUrl
      })

      // Reuse existing active test subscription for the same resource to avoid Graph limits
      const { data: existingSubscription } = await supabase
        .from('trigger_resources')
        .select('*')
        .eq('provider', 'teams')
        .eq('user_id', userId)
        .eq('status', 'active')
        .eq('is_test', true)
        .contains('config', { resource })
        .maybeSingle()

      if (existingSubscription && testMode?.isTest) {
        const expirationRaw = existingSubscription.config?.expirationDateTime
        const expirationMs = expirationRaw ? Date.parse(expirationRaw) : NaN
        const isExpired = !Number.isFinite(expirationMs) || expirationMs <= Date.now() + 60000

        if (!isExpired) {
          const graphSubscription = await this.findGraphSubscription(accessToken, resource, webhookUrl)

          if (graphSubscription?.id) {
            logger.info('[Teams Trigger] Reusing existing test subscription:', {
              subscriptionId: existingSubscription.external_id,
              resource
            })

            await supabase
              .from('trigger_resources')
              .update({
                workflow_id: workflowId,
                node_id: nodeId,
                test_session_id: testMode.testSessionId,
                config: {
                  ...(existingSubscription.config || {}),
                  expirationDateTime: graphSubscription.expirationDateTime || existingSubscription.config?.expirationDateTime,
                  webhookUrl
                },
                updated_at: new Date().toISOString()
              })
              .eq('id', existingSubscription.id)

            return
          }
        }

        logger.info('[Teams Trigger] Removing stale test subscription record:', {
          subscriptionId: existingSubscription.external_id,
          resource,
          isExpired
        })

        await supabase
          .from('trigger_resources')
          .delete()
          .eq('id', existingSubscription.id)
      }

      // If no local record exists, check Graph subscriptions and recreate the row
      if (testMode?.isTest) {
        const graphSubscription = await this.findGraphSubscription(accessToken, resource, webhookUrl)

        if (graphSubscription) {
          logger.info('[Teams Trigger] Reusing Graph subscription without local record:', {
            subscriptionId: graphSubscription.id,
            resource
          })

          const { error: recreateError } = await supabase
            .from('trigger_resources')
            .insert({
              workflow_id: workflowId,
              user_id: userId,
              node_id: nodeId,
              provider: 'teams',
              provider_id: 'teams',
              trigger_type: triggerType,
              resource_type: 'subscription',
              resource_id: graphSubscription.id,
              external_id: graphSubscription.id,
              config: {
                resource,
                changeType: changeTypes.join(','),
                expirationDateTime: graphSubscription.expirationDateTime,
                webhookUrl,
                ...config
              },
              status: 'active',
              is_test: true,
              test_session_id: testMode.testSessionId
            })

          if (recreateError) {
            logger.warn('[Teams Trigger] Failed to recreate trigger resource from Graph subscription:', recreateError)
          }

          return
        }
      }

      const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(subscriptionPayload)
      })

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('[Teams Trigger] Failed to create subscription:', errorData)
        throw new Error(`Failed to create Teams subscription: ${errorData.error?.message || response.statusText}`)
      }

      const subscription = await response.json()

      logger.info('[Teams Trigger] Subscription created:', {
        id: subscription.id,
        expirationDateTime: subscription.expirationDateTime,
        includeResourceData
      })

      // Store subscription details in trigger_resources (consistent with other triggers)
      const { error: insertError } = await supabase
        .from('trigger_resources')
        .insert({
          workflow_id: workflowId,
          user_id: userId,
          node_id: nodeId,
          provider: 'teams',
          provider_id: 'teams',
          trigger_type: triggerType,
          resource_type: 'subscription',
          resource_id: subscription.id,
          external_id: subscription.id,
          config: {
            resource: resource,
            changeType: subscriptionPayload.changeType,
            expirationDateTime: subscription.expirationDateTime,
            webhookUrl,
            ...config
          },
          status: 'active',
          // Test mode fields for isolation
          is_test: testMode?.isTest || false,
          test_session_id: testMode?.testSessionId || null
        })

      if (insertError) {
        logger.error('[Teams Trigger] Failed to store trigger resource:', insertError)
        // Try to delete the subscription since we couldn't store it
        try {
          await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscription.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
          })
        } catch (cleanupError) {
          logger.error('[Teams Trigger] Failed to cleanup subscription after storage error:', cleanupError)
        }
        throw new Error(`Failed to store trigger resource: ${insertError.message}`)
      }

      logger.info(`✅ ${modeLabel} [Teams Trigger] Trigger activation complete - subscription: ${subscription.id}`)
    } catch (error: any) {
      logger.error('[Teams Trigger] Error activating trigger:', error)
      throw error
    }
  }

  /**
   * Delete the Graph API subscription when workflow is deactivated
   */
  async onDeactivate(context: TriggerDeactivationContext): Promise<void> {
    const { workflowId, userId, testSessionId } = context

    const modeLabel = testSessionId ? '🧪 TEST' : '🛑 PRODUCTION'
    logger.info(`${modeLabel} [Teams Trigger] Deactivating trigger:`, { workflowId, testSessionId })

    try {
      const supabase = createAdminClient()

      // Build query based on whether we're deactivating test or production triggers
      let query = supabase
        .from('trigger_resources')
        .select('*')
        .eq('workflow_id', workflowId)
        .eq('provider', 'teams')
        .eq('status', 'active')

      if (testSessionId) {
        // Only deactivate test triggers for this specific session
        query = query.eq('test_session_id', testSessionId)
      } else {
        // Deactivate production triggers only (not test triggers)
        query = query.or('is_test.is.null,is_test.eq.false')
      }

      const { data: resources, error: queryError } = await query

      if (queryError) {
        logger.error('[Teams Trigger] Failed to query trigger resources:', queryError)
        return
      }

      if (!resources || resources.length === 0) {
        logger.info(`[Teams Trigger] No trigger resources found for workflow ${workflowId}${testSessionId ? ` (session ${testSessionId})` : ''}`)
        return
      }

      // Get Teams integration for delegated API calls
      const { data: integration } = await supabase
        .from('integrations')
        .select('access_token')
        .eq('user_id', userId)
        .eq('provider', 'teams')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      let userAccessToken: string | null = null
      if (integration && integration.access_token) {
        try {
          userAccessToken = await decrypt(integration.access_token)
        } catch (decryptError) {
          logger.warn('[Teams Trigger] Failed to decrypt access token, will skip delegated API cleanup:', decryptError)
        }
      }

      let appAccessToken: string | null = null

      // Delete each subscription
      for (const resource of resources) {
        const needsAppToken = this.needsAppOnlyToken(resource.trigger_type, resource.config)
        if (needsAppToken && !appAccessToken) {
          try {
            appAccessToken = await this.getAppOnlyAccessToken()
          } catch (tokenError) {
            logger.warn('[Teams Trigger] Failed to get app-only token, will skip app-only API cleanup:', tokenError)
          }
        }

        const accessToken = needsAppToken ? appAccessToken : userAccessToken

        if (accessToken && resource.external_id) {
          try {
            const response = await fetch(
              `https://graph.microsoft.com/v1.0/subscriptions/${resource.external_id}`,
              {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${accessToken}`
                }
              }
            )

            if (!response.ok && response.status !== 404) {
              logger.warn(`[Teams Trigger] Failed to delete subscription from Graph API: ${resource.external_id}`, await response.text())
            } else {
              logger.info(`[Teams Trigger] Subscription deleted from Graph API: ${resource.external_id}`)
            }
          } catch (apiError) {
            logger.warn(`[Teams Trigger] Error calling Graph API to delete subscription: ${resource.external_id}`, apiError)
          }
        }

        // Delete from database regardless of API result
        const { error: deleteError } = await supabase
          .from('trigger_resources')
          .delete()
          .eq('id', resource.id)

        if (deleteError) {
          logger.error(`[Teams Trigger] Failed to delete trigger resource from database: ${resource.id}`, deleteError)
        } else {
          logger.info(`[Teams Trigger] Trigger resource deleted from database: ${resource.id}`)
        }
      }

      logger.info(`✅ ${modeLabel} [Teams Trigger] Trigger deactivation complete`)
    } catch (error: any) {
      logger.error('[Teams Trigger] Error deactivating trigger:', error)
      // Don't throw - we want to clean up even if Graph API call fails
    }
  }

  /**
   * Delete subscription when workflow is deleted (same as deactivate)
   */
  async onDelete(context: TriggerDeactivationContext): Promise<void> {
    await this.onDeactivate(context)
  }

  /**
   * Check if the subscription is still valid
   */
  async checkHealth(workflowId: string, userId: string): Promise<TriggerHealthStatus> {
    try {
      const supabase = createAdminClient()

      // Get trigger resource (production only)
      const { data: resource, error: queryError } = await supabase
        .from('trigger_resources')
        .select('*')
        .eq('workflow_id', workflowId)
        .eq('provider', 'teams')
        .eq('status', 'active')
        .or('is_test.is.null,is_test.eq.false')
        .single()

      if (queryError || !resource || !resource.external_id) {
        return {
          healthy: false,
          message: 'No subscription found'
        }
      }

      // Check subscription expiration
      const expirationTime = new Date(resource.config?.expirationDateTime).getTime()
      const now = Date.now()
      const hoursUntilExpiration = (expirationTime - now) / (1000 * 60 * 60)

      if (hoursUntilExpiration < 0) {
        return {
          healthy: false,
          message: 'Subscription expired'
        }
      }

      // Renew if less than 24 hours remaining
      if (hoursUntilExpiration < 24) {
        await this.renewSubscription(workflowId, userId, resource.external_id)
        return {
          healthy: true,
          message: 'Subscription renewed'
        }
      }

      return {
        healthy: true,
        message: `Subscription valid for ${Math.floor(hoursUntilExpiration)} hours`
      }
    } catch (error: any) {
      logger.error('[Teams Trigger] Error checking health:', error)
      return {
        healthy: false,
        message: error.message || 'Health check failed'
      }
    }
  }

  /**
   * Renew a subscription before it expires
   */
  private async renewSubscription(workflowId: string, userId: string, subscriptionId: string): Promise<void> {
    try {
      const supabase = createAdminClient()

      const { data: existingResource } = await supabase
        .from('trigger_resources')
        .select('config, trigger_type')
        .eq('workflow_id', workflowId)
        .eq('provider', 'teams')
        .eq('external_id', subscriptionId)
        .single()

      if (!existingResource) {
        throw new Error('Trigger resource not found')
      }

      let accessToken: string | null = null
      if (this.needsAppOnlyToken(existingResource.trigger_type, existingResource.config)) {
        accessToken = await this.getAppOnlyAccessToken()
      } else {
        // Get Teams integration
        const { data: integration } = await supabase
          .from('integrations')
          .select('access_token')
          .eq('user_id', userId)
          .eq('provider', 'teams')
          .in('status', CONNECTED_STATUSES_LIST)
          .single()

        if (!integration || !integration.access_token) {
          throw new Error('Teams integration not found')
        }

        accessToken = await decrypt(integration.access_token)
      }

      // Extend expiration by 3 days
      const newExpiration = new Date()
      newExpiration.setMinutes(newExpiration.getMinutes() + 4230)

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expirationDateTime: newExpiration.toISOString()
          })
        }
      )

      if (!response.ok) {
        throw new Error('Failed to renew subscription')
      }

      const updatedConfig = {
        ...(existingResource?.config || {}),
        expirationDateTime: newExpiration.toISOString()
      }

      await supabase
        .from('trigger_resources')
        .update({
          config: updatedConfig,
          updated_at: new Date().toISOString()
        })
        .eq('workflow_id', workflowId)
        .eq('provider', 'teams')
        .eq('external_id', subscriptionId)

      logger.info('[Teams Trigger] Subscription renewed:', subscriptionId)
    } catch (error: any) {
      logger.error('[Teams Trigger] Error renewing subscription:', error)
      throw error
    }
  }

  private needsAppOnlyToken(triggerType: string, config: any): boolean {
    if (triggerType === 'teams_trigger_new_chat') {
      return true
    }

    if (triggerType === 'teams_trigger_user_joins_team') {
      return true
    }

    if (triggerType === 'teams_trigger_new_chat_message') {
      const resource = config?.resource
      return resource === '/chats/getAllMessages'
    }

    return false
  }

  private async getAppOnlyAccessToken(): Promise<string> {
    const tenantId = process.env.TEAMS_TENANT_ID || process.env.MICROSOFT_TENANT_ID
    const clientId = process.env.TEAMS_CLIENT_ID
    const clientSecret = process.env.TEAMS_CLIENT_SECRET

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error('Missing Teams app credentials (TEAMS_TENANT_ID, TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET)')
    }

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default'
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to get Teams app-only token: ${errorText}`)
    }

    const data = await response.json()
    if (!data?.access_token) {
      throw new Error('Teams app-only token response missing access_token')
    }

    return data.access_token
  }

  /**
   * Build the Graph API resource path for the subscription
   */
  private buildSubscriptionResource(triggerType: string, config: any): string {
    switch (triggerType) {
      case 'teams_trigger_new_message':
      case 'teams_trigger_new_reply':
      case 'teams_trigger_channel_mention':
        // Subscribe to messages in a specific channel
        return `/teams/${config.teamId}/channels/${config.channelId}/messages`

      case 'teams_trigger_user_joins_team':
        if (!config.teamId) {
          throw new Error('teamId is required for user joins team trigger')
        }
        return `/teams/${config.teamId}/members`

      case 'teams_trigger_new_chat_message':
        if (config.chatId) {
          // Subscribe to messages in a specific chat
          return `/chats/${config.chatId}/messages`
        } else {
          // Subscribe to all chats for the user
          return `/chats/getAllMessages`
        }

      case 'teams_trigger_new_chat':
        // Subscribe to all chats
        return `/chats`

      case 'teams_trigger_new_channel':
        // Subscribe to channels in a team
        return `/teams/${config.teamId}/channels`

      default:
        throw new Error(`Unsupported trigger type: ${triggerType}`)
    }
  }

  /**
   * Get the change types to subscribe to based on trigger type
   */
  private getChangeTypes(triggerType: string): string[] {
    switch (triggerType) {
      case 'teams_trigger_new_message':
      case 'teams_trigger_new_reply':
      case 'teams_trigger_channel_mention':
      case 'teams_trigger_new_chat_message':
      case 'teams_trigger_user_joins_team':
        return ['created']

      case 'teams_trigger_new_chat':
      case 'teams_trigger_new_channel':
        return ['created']

      default:
        return ['created', 'updated']
    }
  }

  private async findGraphSubscription(
    accessToken: string,
    resource: string,
    notificationUrl: string
  ): Promise<{ id: string; expirationDateTime: string } | null> {
    try {
      const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        logger.warn('[Teams Trigger] Failed to list Graph subscriptions:', response.status)
        return null
      }

      const data = await response.json()
      const subscriptions = Array.isArray(data?.value) ? data.value : []
      const match = subscriptions.find((sub: any) =>
        sub?.resource === resource && sub?.notificationUrl === notificationUrl
      )

      if (!match?.id) {
        return null
      }

      return {
        id: match.id,
        expirationDateTime: match.expirationDateTime
      }
    } catch (error) {
      logger.warn('[Teams Trigger] Error listing Graph subscriptions:', error)
      return null
    }
  }
}
