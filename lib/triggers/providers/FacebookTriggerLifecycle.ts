/**
 * Facebook Trigger Lifecycle
 *
 * Manages Facebook Page webhook subscriptions for triggers:
 * - facebook_trigger_new_post (page feed updates)
 * - facebook_trigger_new_comment (comments on page posts)
 *
 * Uses Facebook Graph API to subscribe/unsubscribe pages from app webhooks.
 * Requires: pages_manage_metadata permission + Page access token.
 */

import { createClient } from '@supabase/supabase-js'
import {
  TriggerLifecycle,
  TriggerActivationContext,
  TriggerDeactivationContext,
  TriggerHealthStatus
} from '../types'
import { logger } from '@/lib/utils/logger'
import { decrypt } from '@/lib/security/encryption'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const GRAPH_API_VERSION = 'v19.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export class FacebookTriggerLifecycle implements TriggerLifecycle {

  async onActivate(context: TriggerActivationContext): Promise<void> {
    const { workflowId, userId, nodeId, triggerType, config } = context

    logger.info(`[Facebook] Activating trigger for workflow ${workflowId}`, {
      triggerType,
      pageId: config.pageId,
    })

    const pageId = config.pageId
    if (!pageId) {
      throw new Error('Facebook Page ID is required to activate trigger')
    }

    // Get the Facebook integration and page access token
    const supabase = getSupabase()
    const { data: integration, error: intError } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'facebook')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (intError || !integration) {
      throw new Error('Facebook integration not found or not connected')
    }

    const accessToken = integration.encrypted_access_token
      ? decrypt(integration.encrypted_access_token)
      : integration.access_token

    if (!accessToken) {
      throw new Error('Failed to get Facebook access token')
    }

    // Determine which fields to subscribe to based on trigger type
    const subscribedFields = triggerType === 'facebook_trigger_new_comment'
      ? 'feed' // feed includes comments
      : 'feed' // feed includes new posts

    // Subscribe the page to receive webhooks
    const subscribeUrl = `${GRAPH_API_BASE}/${pageId}/subscribed_apps`
    const response = await fetch(subscribeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        access_token: accessToken,
        subscribed_fields: subscribedFields,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      logger.error('[Facebook] Failed to subscribe page:', { pageId, error })
      throw new Error(`Failed to subscribe Facebook page: ${error}`)
    }

    const result = await response.json()
    logger.info('[Facebook] Page subscribed successfully:', { pageId, result })

    // Store trigger resource
    const resourceId = `${workflowId}-${nodeId}`
    const { error: upsertError } = await supabase
      .from('trigger_resources')
      .upsert({
        workflow_id: workflowId,
        user_id: userId,
        provider: 'facebook',
        provider_id: 'facebook',
        trigger_type: triggerType,
        node_id: nodeId,
        resource_type: 'webhook',
        resource_id: resourceId,
        external_id: pageId,
        config: {
          pageId,
          subscribedFields,
          integrationId: integration.id,
        },
        status: 'active',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'provider,resource_type,resource_id',
        ignoreDuplicates: false,
      })

    if (upsertError) {
      if (upsertError.code === '23503') {
        logger.warn('[Facebook] Could not store trigger resource (workflow may be unsaved)')
        return
      }
      throw new Error(`Failed to store trigger resource: ${upsertError.message}`)
    }

    logger.info(`[Facebook] Trigger activated for page ${pageId}`)
  }

  async onDeactivate(context: TriggerDeactivationContext): Promise<void> {
    const { workflowId, userId } = context

    logger.info(`[Facebook] Deactivating triggers for workflow ${workflowId}`)

    const supabase = getSupabase()

    // Find all active Facebook trigger resources for this workflow
    const { data: resources, error: queryError } = await supabase
      .from('trigger_resources')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'facebook')
      .eq('status', 'active')

    if (queryError || !resources || resources.length === 0) {
      logger.info('[Facebook] No active trigger resources found')
      return
    }

    for (const resource of resources) {
      try {
        const pageId = resource.config?.pageId || resource.external_id
        if (!pageId) continue

        // Get integration for unsubscribe
        const integrationId = resource.config?.integrationId
        let accessToken: string | null = null

        if (integrationId) {
          const { data: integration } = await supabase
            .from('integrations')
            .select('encrypted_access_token, access_token')
            .eq('id', integrationId)
            .single()

          if (integration) {
            accessToken = integration.encrypted_access_token
              ? decrypt(integration.encrypted_access_token)
              : integration.access_token
          }
        }

        // Unsubscribe the page
        if (accessToken) {
          const unsubscribeUrl = `${GRAPH_API_BASE}/${pageId}/subscribed_apps`
          const response = await fetch(unsubscribeUrl, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: accessToken }),
          })

          if (!response.ok) {
            logger.warn('[Facebook] Failed to unsubscribe page:', { pageId })
          } else {
            logger.info('[Facebook] Page unsubscribed:', { pageId })
          }
        }

        // Delete the trigger resource
        await supabase
          .from('trigger_resources')
          .delete()
          .eq('id', resource.id)

      } catch (error: any) {
        logger.error('[Facebook] Error deactivating trigger resource:', {
          resourceId: resource.id,
          error: error.message,
        })
      }
    }
  }

  async onDelete(context: TriggerDeactivationContext): Promise<void> {
    await this.onDeactivate(context)
  }

  async checkHealth(workflowId: string, userId: string): Promise<TriggerHealthStatus> {
    const supabase = getSupabase()

    const { data: resources } = await supabase
      .from('trigger_resources')
      .select('id, status, config, external_id')
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'facebook')
      .eq('status', 'active')

    if (!resources || resources.length === 0) {
      return {
        healthy: false,
        details: 'No active Facebook trigger resources found',
      }
    }

    return {
      healthy: true,
      details: `${resources.length} active Facebook trigger(s)`,
    }
  }
}
