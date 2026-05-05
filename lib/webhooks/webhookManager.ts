/**
 * Webhook Manager
 * 
 * Handles webhook registration, validation, and execution for all integrations
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { ALL_NODE_COMPONENTS } from "@/lib/workflows/nodes"

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

export interface WebhookPayload {
  workflowId: string
  triggerType: string
  providerId: string
  data: any
  timestamp: Date
  signature?: string
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
   * Process incoming webhook
   */
  async processWebhook(
    webhookId: string,
    payload: any,
    headers: Record<string, string>
  ): Promise<void> {
    // Get webhook config
    const { data: webhook } = await this.supabase
      .from('webhook_configs')
      .select('*')
      .eq('id', webhookId)
      .single()

    if (!webhook) {
      throw new Error('Webhook not found')
    }

    // Validate webhook signature if secret is configured
    if (webhook.secret && !this.validateWebhookSignature(payload, headers, webhook.secret)) {
      throw new Error('Invalid webhook signature')
    }

    // Transform payload based on provider
    const transformedPayload = await this.transformPayload(webhook.provider_id, webhook.trigger_type, payload)

    // Execute workflow
    await this.executeWorkflow(webhook.workflow_id, transformedPayload)

    // Update webhook stats
    await this.updateWebhookStats(webhookId, true)
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
   * Update webhook status
   */
  async updateWebhookStatus(webhookId: string, status: WebhookConfig['status']): Promise<void> {
    const { error } = await this.supabase
      .from('webhook_configs')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', webhookId)

    if (error) {
      throw new Error(`Failed to update webhook status: ${error.message}`)
    }
  }

  /**
   * Generate webhook secret
   */
  private generateWebhookSecret(): string {
    return crypto.randomUUID()
  }

  /**
   * Validate webhook signature
   */
  private validateWebhookSignature(
    payload: any,
    headers: Record<string, string>,
    secret: string
  ): boolean {
    // Implementation depends on the provider
    // For now, return true (implement specific validation per provider)
    return true
  }

  /**
   * Transform payload based on provider and trigger type
   */
  private async transformPayload(
    providerId: string,
    triggerType: string,
    payload: any
  ): Promise<any> {
    switch (providerId) {
      case 'gmail':
        return this.transformGmailPayload(triggerType, payload)
      case 'slack':
        return this.transformSlackPayload(triggerType, payload)
      case 'github':
        return this.transformGithubPayload(triggerType, payload)
      case 'discord':
        return this.transformDiscordPayload(triggerType, payload)
      case 'stripe':
        return this.transformStripePayload(triggerType, payload)
      case 'shopify':
        return this.transformShopifyPayload(triggerType, payload)
      case 'hubspot':
        return this.transformHubspotPayload(triggerType, payload)
      case 'notion':
        return this.transformNotionPayload(triggerType, payload)
      case 'airtable':
        return this.transformAirtablePayload(triggerType, payload)
      case 'google-calendar':
        return this.transformGoogleCalendarPayload(triggerType, payload)
      case 'google-sheets':
        return this.transformGoogleSheetsPayload(triggerType, payload)
      case 'google-drive':
        return this.transformGoogleDrivePayload(triggerType, payload)
      case 'trello':
        return this.transformTrelloPayload(triggerType, payload)
      case 'facebook':
        return this.transformFacebookPayload(triggerType, payload)
      case 'twitter':
        return this.transformTwitterPayload(triggerType, payload)
      case 'linkedin':
        return this.transformLinkedinPayload(triggerType, payload)
      case 'instagram':
        return this.transformInstagramPayload(triggerType, payload)
      case 'youtube':
        return this.transformYoutubePayload(triggerType, payload)
      case 'tiktok':
        return this.transformTiktokPayload(triggerType, payload)
      case 'twitch':
        return this.transformTwitchPayload(triggerType, payload)
      case 'spotify':
        return this.transformSpotifyPayload(triggerType, payload)
      case 'zoom':
        return this.transformZoomPayload(triggerType, payload)
      case 'teams':
        return this.transformTeamsPayload(triggerType, payload)
      case 'outlook':
        return this.transformOutlookPayload(triggerType, payload)
      case 'onedrive':
        return this.transformOneDrivePayload(triggerType, payload)
      case 'dropbox':
        return this.transformDropboxPayload(triggerType, payload)
      case 'box':
        return this.transformBoxPayload(triggerType, payload)
      case 'gitlab':
        return this.transformGitlabPayload(triggerType, payload)
      case 'bitbucket':
        return this.transformBitbucketPayload(triggerType, payload)
      case 'jira':
        return this.transformJiraPayload(triggerType, payload)
      case 'asana':
        return this.transformAsanaPayload(triggerType, payload)
      case 'clickup':
        return this.transformClickupPayload(triggerType, payload)
      case 'monday':
        return this.transformMondayPayload(triggerType, payload)
      case 'linear':
        return this.transformLinearPayload(triggerType, payload)
      case 'figma':
        return this.transformFigmaPayload(triggerType, payload)
      case 'canva':
        return this.transformCanvaPayload(triggerType, payload)
      case 'mailchimp':
        return this.transformMailchimpPayload(triggerType, payload)
      case 'sendgrid':
        return this.transformSendgridPayload(triggerType, payload)
      case 'resend':
        return this.transformResendPayload(triggerType, payload)
      case 'calendly':
        return this.transformCalendlyPayload(triggerType, payload)
      case 'typeform':
        return this.transformTypeformPayload(triggerType, payload)
      case 'google-forms':
        return this.transformGoogleFormsPayload(triggerType, payload)
      case 'microsoft-forms':
        return this.transformMicrosoftFormsPayload(triggerType, payload)
      case 'survey-monkey':
        return this.transformSurveyMonkeyPayload(triggerType, payload)
      case 'qualtrics':
        return this.transformQualtricsPayload(triggerType, payload)
      case 'zapier':
        return this.transformZapierPayload(triggerType, payload)
      case 'make':
        return this.transformMakePayload(triggerType, payload)
      case 'n8n':
        return this.transformN8nPayload(triggerType, payload)
      case 'node-red':
        return this.transformNodeRedPayload(triggerType, payload)
      case 'ifttt':
        return this.transformIftttPayload(triggerType, payload)
      case 'integromat':
        return this.transformIntegromatPayload(triggerType, payload)
      case 'automate-io':
        return this.transformAutomateIoPayload(triggerType, payload)
      case 'workato':
        return this.transformWorkatoPayload(triggerType, payload)
      case 'tray-io':
        return this.transformTrayIoPayload(triggerType, payload)
      case 'elastic-io':
        return this.transformElasticIoPayload(triggerType, payload)
      case 'pie-io':
        return this.transformPieIoPayload(triggerType, payload)
      case 'phantombuster':
        return this.transformPhantombusterPayload(triggerType, payload)
      case 'apify':
        return this.transformApifyPayload(triggerType, payload)
      case 'scraping-bee':
        return this.transformScrapingBeePayload(triggerType, payload)
      case 'scraper-api':
        return this.transformScraperApiPayload(triggerType, payload)
      case 'bright-data':
        return this.transformBrightDataPayload(triggerType, payload)
      case 'proxycurl':
        return this.transformProxycurlPayload(triggerType, payload)
      case 'hunter-io':
        return this.transformHunterIoPayload(triggerType, payload)
      case 'findthatlead':
        return this.transformFindthatleadPayload(triggerType, payload)
      case 'snov-io':
        return this.transformSnovIoPayload(triggerType, payload)
      case 'email-finder':
        return this.transformEmailFinderPayload(triggerType, payload)
      case 'email-verifier':
        return this.transformEmailVerifierPayload(triggerType, payload)
      case 'email-validator':
        return this.transformEmailValidatorPayload(triggerType, payload)
      case 'email-checker':
        return this.transformEmailCheckerPayload(triggerType, payload)
      case 'email-tester':
        return this.transformEmailTesterPayload(triggerType, payload)
      case 'email-analyzer':
        return this.transformEmailAnalyzerPayload(triggerType, payload)
      case 'email-scorer':
        return this.transformEmailScorerPayload(triggerType, payload)
      case 'email-profiler':
        return this.transformEmailProfilerPayload(triggerType, payload)
      case 'email-enricher':
        return this.transformEmailEnricherPayload(triggerType, payload)
      case 'email-finder-pro':
        return this.transformEmailFinderProPayload(triggerType, payload)
      case 'email-verifier-pro':
        return this.transformEmailVerifierProPayload(triggerType, payload)
      case 'email-validator-pro':
        return this.transformEmailValidatorProPayload(triggerType, payload)
      case 'email-checker-pro':
        return this.transformEmailCheckerProPayload(triggerType, payload)
      case 'email-tester-pro':
        return this.transformEmailTesterProPayload(triggerType, payload)
      case 'email-analyzer-pro':
        return this.transformEmailAnalyzerProPayload(triggerType, payload)
      case 'email-scorer-pro':
        return this.transformEmailScorerProPayload(triggerType, payload)
      case 'email-profiler-pro':
        return this.transformEmailProfilerProPayload(triggerType, payload)
      case 'email-enricher-pro':
        return this.transformEmailEnricherProPayload(triggerType, payload)
      default:
        return payload
    }
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
   * Execute workflow.
   *
   * PR-V2-WEBHOOK-MANAGER: routes through the unified webhook dispatcher
   * so v1/v2 dispatch + billing + dedup live in lib/webhooks/execute.ts.
   *
   * Note: the parent `processWebhook` method on this class has zero
   * callers in the codebase (verified via grep) — this entry path is
   * legacy / dead. The migration brings it to parity with the other
   * webhook entry paths so any future re-activation lands on v2 by
   * default once Phase 5 stage 3 flips.
   */
  private async executeWorkflow(workflowId: string, payload: any): Promise<void> {
    const { executeWebhookWorkflow } = await import('@/lib/webhooks/execute')
    await executeWebhookWorkflow({
      workflowId,
      userId: payload.userId || 'system',
      provider: 'webhook',
      triggerType: 'legacy_webhook_manager',
      triggerData: payload,
      metadata: {
        source: 'webhookManager.executeWorkflow',
      },
    })
  }

  /**
   * Update webhook statistics
   */
  private async updateWebhookStats(webhookId: string, success: boolean): Promise<void> {
    const updateData: any = {
      last_triggered: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    if (success) {
      updateData.error_count = 0
    } else {
      updateData.error_count = this.supabase.rpc('increment', { table_name: 'webhook_configs', column_name: 'error_count', row_id: webhookId })
    }

    await this.supabase
      .from('webhook_configs')
      .update(updateData)
      .eq('id', webhookId)
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

  // Provider-specific payload transformers
  private transformGmailPayload(triggerType: string, payload: any): any {
    switch (triggerType) {
      case 'gmail_trigger_new_email':
        return {
          id: payload.id,
          threadId: payload.threadId,
          labelIds: payload.labelIds,
          snippet: payload.snippet,
          from: payload.from,
          to: payload.to,
          subject: payload.subject,
          body: payload.body,
          attachments: payload.attachments,
          receivedAt: payload.receivedAt
        }
      case 'gmail_trigger_new_attachment':
        return {
          emailId: payload.id,
          attachmentName: payload.attachmentName,
          attachmentSize: payload.attachmentSize,
          attachmentType: payload.attachmentType,
          from: payload.from,
          subject: payload.subject
        }
      default:
        return payload
    }
  }

  private transformSlackPayload(triggerType: string, payload: any): any {
    switch (triggerType) {
      case 'slack_trigger_new_message':
      case 'slack_trigger_message_channels':
        return {
          channelId: payload.channel_id,
          channelName: payload.channel_name,
          userId: payload.user_id,
          userName: payload.user_name,
          message: payload.text,
          timestamp: payload.ts,
          threadTs: payload.thread_ts
        }
      case 'slack_trigger_reaction_added':
        return {
          channelId: payload.item.channel,
          messageTs: payload.item.ts,
          reaction: payload.reaction,
          userId: payload.user
        }
      default:
        return payload
    }
  }

  private transformGithubPayload(triggerType: string, payload: any): any {
    switch (triggerType) {
      case 'github_trigger_new_issue':
        return {
          repository: payload.repository.full_name,
          issueNumber: payload.issue.number,
          issueTitle: payload.issue.title,
          issueBody: payload.issue.body,
          author: payload.issue.user.login,
          labels: payload.issue.labels.map((l: any) => l.name),
          createdAt: payload.issue.created_at
        }
      case 'github_trigger_new_pr':
        return {
          repository: payload.repository.full_name,
          prNumber: payload.pull_request.number,
          prTitle: payload.pull_request.title,
          prBody: payload.pull_request.body,
          author: payload.pull_request.user.login,
          baseBranch: payload.pull_request.base.ref,
          headBranch: payload.pull_request.head.ref
        }
      default:
        return payload
    }
  }

  // Add more provider-specific transformers as needed...
  private transformDiscordPayload(triggerType: string, payload: any): any { return payload }
  private transformStripePayload(triggerType: string, payload: any): any { return payload }
  private transformShopifyPayload(triggerType: string, payload: any): any { return payload }
  private transformHubspotPayload(triggerType: string, payload: any): any { return payload }
  private transformNotionPayload(triggerType: string, payload: any): any { return payload }
  private transformAirtablePayload(triggerType: string, payload: any): any { return payload }
  private transformGoogleCalendarPayload(triggerType: string, payload: any): any { return payload }
  private transformGoogleSheetsPayload(triggerType: string, payload: any): any { return payload }
  private transformGoogleDrivePayload(triggerType: string, payload: any): any { return payload }
  private transformTrelloPayload(triggerType: string, payload: any): any { return payload }
  private transformFacebookPayload(triggerType: string, payload: any): any { return payload }
  private transformTwitterPayload(triggerType: string, payload: any): any { return payload }
  private transformLinkedinPayload(triggerType: string, payload: any): any { return payload }
  private transformInstagramPayload(triggerType: string, payload: any): any { return payload }
  private transformYoutubePayload(triggerType: string, payload: any): any { return payload }
  private transformTiktokPayload(triggerType: string, payload: any): any { return payload }
  private transformTwitchPayload(triggerType: string, payload: any): any { return payload }
  private transformSpotifyPayload(triggerType: string, payload: any): any { return payload }
  private transformZoomPayload(triggerType: string, payload: any): any { return payload }
  private transformTeamsPayload(triggerType: string, payload: any): any { return payload }
  private transformOutlookPayload(triggerType: string, payload: any): any { return payload }
  private transformOneDrivePayload(triggerType: string, payload: any): any { return payload }
  private transformDropboxPayload(triggerType: string, payload: any): any { return payload }
  private transformBoxPayload(triggerType: string, payload: any): any { return payload }
  private transformGitlabPayload(triggerType: string, payload: any): any { return payload }
  private transformBitbucketPayload(triggerType: string, payload: any): any { return payload }
  private transformJiraPayload(triggerType: string, payload: any): any { return payload }
  private transformAsanaPayload(triggerType: string, payload: any): any { return payload }
  private transformClickupPayload(triggerType: string, payload: any): any { return payload }
  private transformMondayPayload(triggerType: string, payload: any): any { return payload }
  private transformLinearPayload(triggerType: string, payload: any): any { return payload }
  private transformFigmaPayload(triggerType: string, payload: any): any { return payload }
  private transformCanvaPayload(triggerType: string, payload: any): any { return payload }
  private transformMailchimpPayload(triggerType: string, payload: any): any { return payload }
  private transformSendgridPayload(triggerType: string, payload: any): any { return payload }
  private transformResendPayload(triggerType: string, payload: any): any { return payload }
  private transformCalendlyPayload(triggerType: string, payload: any): any { return payload }
  private transformTypeformPayload(triggerType: string, payload: any): any { return payload }
  private transformGoogleFormsPayload(triggerType: string, payload: any): any { return payload }
  private transformMicrosoftFormsPayload(triggerType: string, payload: any): any { return payload }
  private transformSurveyMonkeyPayload(triggerType: string, payload: any): any { return payload }
  private transformQualtricsPayload(triggerType: string, payload: any): any { return payload }
  private transformZapierPayload(triggerType: string, payload: any): any { return payload }
  private transformMakePayload(triggerType: string, payload: any): any { return payload }
  private transformN8nPayload(triggerType: string, payload: any): any { return payload }
  private transformNodeRedPayload(triggerType: string, payload: any): any { return payload }
  private transformIftttPayload(triggerType: string, payload: any): any { return payload }
  private transformIntegromatPayload(triggerType: string, payload: any): any { return payload }
  private transformAutomateIoPayload(triggerType: string, payload: any): any { return payload }
  private transformWorkatoPayload(triggerType: string, payload: any): any { return payload }
  private transformTrayIoPayload(triggerType: string, payload: any): any { return payload }
  private transformElasticIoPayload(triggerType: string, payload: any): any { return payload }
  private transformPieIoPayload(triggerType: string, payload: any): any { return payload }
  private transformPhantombusterPayload(triggerType: string, payload: any): any { return payload }
  private transformApifyPayload(triggerType: string, payload: any): any { return payload }
  private transformScrapingBeePayload(triggerType: string, payload: any): any { return payload }
  private transformScraperApiPayload(triggerType: string, payload: any): any { return payload }
  private transformBrightDataPayload(triggerType: string, payload: any): any { return payload }
  private transformProxycurlPayload(triggerType: string, payload: any): any { return payload }
  private transformHunterIoPayload(triggerType: string, payload: any): any { return payload }
  private transformFindthatleadPayload(triggerType: string, payload: any): any { return payload }
  private transformSnovIoPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailFinderPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailVerifierPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailValidatorPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailCheckerPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailTesterPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailAnalyzerPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailScorerPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailProfilerPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailEnricherPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailFinderProPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailVerifierProPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailValidatorProPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailCheckerProPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailTesterProPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailAnalyzerProPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailScorerProPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailProfilerProPayload(triggerType: string, payload: any): any { return payload }
  private transformEmailEnricherProPayload(triggerType: string, payload: any): any { return payload }
}

// Export singleton instance
export const webhookManager = new WebhookManager() 