/**
 * Webhook Manager — registration / lookup / unregistration over the
 * `webhook_configs` table.
 *
 * Note: this class no longer participates in webhook execution. The
 * unified webhook dispatcher in lib/webhooks/execute.ts owns runtime
 * dispatch (v1/v2 routing, billing, dedup). The previous in-class
 * processWebhook + transformPayload + per-provider transformers were
 * deleted in 8f24eea64 (parent) and this commit (orphan helpers).
 */

import { createAdminClient } from "@/lib/supabase/admin"

import { logger } from '@/lib/utils/logger'

export interface WebhookConfig {
  id: string
  workflowId: string
  userId: string
  triggerType: string
  providerId: string
  webhookUrl: string
  secret?: string
  status: 'active' | 'inactive' | 'error'
  lastTriggered?: Date
  errorCount: number
  createdAt: Date
  updatedAt: Date
}

export class WebhookManager {
  private _supabase: ReturnType<typeof createAdminClient> | null = null

  private get supabase() {
    if (!this._supabase) {
      this._supabase = createAdminClient()
    }
    return this._supabase
  }

  /**
   * Register a new webhook for a workflow trigger
   */
  async registerWebhook(
    workflowId: string,
    userId: string,
    triggerType: string,
    providerId: string,
    config?: any
  ): Promise<WebhookConfig> {
    try {
      const webhookId = `webhook_${workflowId}_${triggerType}_${Date.now()}`
      const secret = this.generateWebhookSecret()

      const webhookConfig: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt'> = {
        workflowId,
        userId,
        triggerType,
        providerId,
        webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/${webhookId}`,
        secret,
        status: 'active',
        errorCount: 0
      }

      const { data, error } = await this.supabase
        .from("webhook_configs")
        .insert({
          ...webhookConfig,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) {
        // If table doesn't exist yet, throw error
        if (error.code === '42P01') { // Table doesn't exist
          throw new Error('Webhook tables not created yet. Please run the webhook migration first.')
        }
        throw new Error(`Failed to register webhook: ${error.message}`)
      }

      // Register with external service if needed
      await this.registerWithExternalService(providerId, triggerType, webhookConfig.webhookUrl, config)

      return this.mapToWebhookConfig(data)
    } catch (error) {
      logger.error("Failed to register webhook:", error)
      throw error
    }
  }

  /**
   * Unregister a webhook
   */
  async unregisterWebhook(webhookId: string): Promise<void> {
    const { data: webhook } = await this.supabase
      .from('webhook_configs')
      .select('*')
      .eq('id', webhookId)
      .single()

    if (webhook) {
      // Unregister from external service
      await this.unregisterFromExternalService(
        webhook.provider_id,
        webhook.trigger_type,
        webhook.webhook_url
      )

      // Delete from database
      await this.supabase
        .from('webhook_configs')
        .delete()
        .eq('id', webhookId)
    }
  }

  /**
   * Get all webhooks for a user
   */
  async getUserWebhooks(userId: string): Promise<WebhookConfig[]> {
    try {
      const { data, error } = await this.supabase
        .from("webhook_configs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })

      if (error) {
        // If table doesn't exist yet, return empty array
        if (error.code === '42P01') { // Table doesn't exist
          logger.info('Webhook tables not created yet, returning empty array')
          return []
        }
        throw error
      }

      return data.map(this.mapToWebhookConfig)
    } catch (error) {
      logger.error("Failed to get user webhooks:", error)
      return []
    }
  }

  /**
   * Get webhook by ID
   */
  async getWebhook(webhookId: string): Promise<WebhookConfig | null> {
    try {
      const { data, error } = await this.supabase
        .from("webhook_configs")
        .select("*")
        .eq("id", webhookId)
        .single()

      if (error) {
        // If table doesn't exist yet, return null
        if (error.code === '42P01') { // Table doesn't exist
          logger.info('Webhook tables not created yet')
          return null
        }
        if (error.code === 'PGRST116') return null
        throw error
      }

      return this.mapToWebhookConfig(data)
    } catch (error) {
      logger.error("Failed to get webhook:", error)
      return null
    }
  }

  /**
   * Generate webhook secret
   */
  private generateWebhookSecret(): string {
    return crypto.randomUUID()
  }

  /**
   * Register webhook with external service
   */
  private async registerWithExternalService(
    providerId: string,
    triggerType: string,
    webhookUrl: string,
    config?: any
  ): Promise<void> {
    // Implementation depends on the provider
    // This would make API calls to register webhooks with external services
    logger.info(`Registering webhook with ${providerId} for ${triggerType}`)
  }

  /**
   * Unregister webhook from external service
   */
  private async unregisterFromExternalService(
    providerId: string,
    triggerType: string,
    webhookUrl: string
  ): Promise<void> {
    // Implementation depends on the provider
    logger.info(`Unregistering webhook from ${providerId} for ${triggerType}`)
  }

  /**
   * Map database record to WebhookConfig
   */
  private mapToWebhookConfig(data: any): WebhookConfig {
    return {
      id: data.id,
      workflowId: data.workflow_id,
      userId: data.user_id,
      triggerType: data.trigger_type,
      providerId: data.provider_id,
      webhookUrl: data.webhook_url,
      secret: data.secret,
      status: data.status,
      lastTriggered: data.last_triggered ? new Date(data.last_triggered) : undefined,
      errorCount: data.error_count,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at)
    }
  }
}

// Export singleton instance
export const webhookManager = new WebhookManager()
