/**
 * GitHub Trigger Lifecycle
 *
 * Manages GitHub webhook subscriptions for triggers:
 * - github_trigger_new_commit (push events)
 *
 * Uses GitHub REST API to create/delete repository webhooks.
 * Docs: https://docs.github.com/en/rest/webhooks/repos
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
import { getWebhookBaseUrl } from '@/lib/utils/getBaseUrl'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const GITHUB_API_BASE = 'https://api.github.com'

// Map trigger types to GitHub webhook events
const TRIGGER_TO_EVENTS: Record<string, string[]> = {
  'github_trigger_new_commit': ['push'],
}

export class GitHubTriggerLifecycle implements TriggerLifecycle {

  async onActivate(context: TriggerActivationContext): Promise<void> {
    const { workflowId, userId, nodeId, triggerType, config } = context

    logger.info(`[GitHub] Activating trigger for workflow ${workflowId}`, {
      triggerType,
      repository: config.repository,
    })

    const repository = config.repository
    if (!repository) {
      throw new Error('Repository is required to activate GitHub trigger')
    }

    // Parse owner/repo from repository field (could be "owner/repo" or just a repo name)
    const repoPath = repository.includes('/') ? repository : null
    if (!repoPath) {
      throw new Error('Repository must be in "owner/repo" format')
    }

    // Get GitHub access token
    const supabase = getSupabase()
    const { data: integration, error: intError } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'github')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (intError || !integration) {
      throw new Error('GitHub integration not found or not connected')
    }

    const accessToken = integration.encrypted_access_token
      ? decrypt(integration.encrypted_access_token)
      : integration.access_token

    if (!accessToken) {
      throw new Error('Failed to get GitHub access token')
    }

    // Determine which events to subscribe to
    const events = TRIGGER_TO_EVENTS[triggerType] || ['push']

    // Build webhook URL
    const baseUrl = getWebhookBaseUrl()
    const webhookUrl = `${baseUrl}/api/webhooks/github`

    // Create webhook on the repository
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_CLIENT_SECRET || ''
    const createUrl = `${GITHUB_API_BASE}/repos/${repoPath}/hooks`

    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events,
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret: webhookSecret,
          insecure_ssl: '0',
        },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      logger.error('[GitHub] Failed to create webhook:', { repoPath, status: response.status, error })
      throw new Error(`Failed to create GitHub webhook: ${response.status} ${error}`)
    }

    const webhook = await response.json()
    logger.info('[GitHub] Webhook created:', { repoPath, webhookId: webhook.id })

    // Store trigger resource
    const resourceId = `${workflowId}-${nodeId}`
    const { error: upsertError } = await supabase
      .from('trigger_resources')
      .upsert({
        workflow_id: workflowId,
        user_id: userId,
        provider: 'github',
        provider_id: 'github',
        trigger_type: triggerType,
        node_id: nodeId,
        resource_type: 'webhook',
        resource_id: resourceId,
        external_id: String(webhook.id),
        config: {
          repository: repoPath,
          branch: config.branch || null,
          webhookId: webhook.id,
          events,
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
        logger.warn('[GitHub] Could not store trigger resource (workflow may be unsaved)')
        return
      }
      throw new Error(`Failed to store trigger resource: ${upsertError.message}`)
    }

    logger.info(`[GitHub] Trigger activated for ${repoPath}`)
  }

  async onDeactivate(context: TriggerDeactivationContext): Promise<void> {
    const { workflowId, userId } = context

    logger.info(`[GitHub] Deactivating triggers for workflow ${workflowId}`)

    const supabase = getSupabase()
    const { data: resources } = await supabase
      .from('trigger_resources')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'github')
      .eq('status', 'active')

    if (!resources || resources.length === 0) {
      logger.info('[GitHub] No active trigger resources found')
      return
    }

    for (const resource of resources) {
      try {
        const repoPath = resource.config?.repository
        const webhookId = resource.config?.webhookId || resource.external_id
        if (!repoPath || !webhookId) continue

        // Get integration for deletion
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

        if (accessToken) {
          const deleteUrl = `${GITHUB_API_BASE}/repos/${repoPath}/hooks/${webhookId}`
          const response = await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          })

          if (response.ok || response.status === 404) {
            logger.info('[GitHub] Webhook deleted:', { repoPath, webhookId })
          } else {
            logger.warn('[GitHub] Failed to delete webhook:', { repoPath, webhookId, status: response.status })
          }
        }

        await supabase.from('trigger_resources').delete().eq('id', resource.id)
      } catch (error: any) {
        logger.error('[GitHub] Error deactivating resource:', { error: error.message })
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
      .select('id, status, config')
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'github')
      .eq('status', 'active')

    if (!resources || resources.length === 0) {
      return { healthy: false, details: 'No active GitHub trigger resources found' }
    }

    return { healthy: true, details: `${resources.length} active GitHub webhook(s)` }
  }
}
