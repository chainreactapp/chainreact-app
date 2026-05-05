/**
 * ⚠️ PARTIALLY DEPRECATED FILE (2025-10-03)
 *
 * IMPORTANT: This file is PARTIALLY deprecated as of the trigger lifecycle refactoring.
 *
 * DEPRECATED PROVIDERS (now managed by TriggerLifecycleManager):
 * - Microsoft (Outlook, Teams, OneDrive, OneNote) - see MicrosoftGraphTriggerLifecycle
 * - Google (Gmail, Calendar, Drive, Sheets, Docs) - see GoogleApisTriggerLifecycle
 * - Airtable - see AirtableTriggerLifecycle
 * - Discord - see DiscordTriggerLifecycle
 * - Slack - see SlackTriggerLifecycle
 * - Stripe - see StripeTriggerLifecycle
 * - Shopify - see ShopifyTriggerLifecycle
 *
 * STILL ACTIVE PROVIDERS (not yet migrated):
 * - Trello
 * - Dropbox
 * - GitHub
 * - Notion
 * - HubSpot
 *
 * MIGRATION STATUS:
 * - registerWithExternalService() now skips lifecycle-managed providers
 * - unregisterFromExternalService() still handles cleanup for both old and new systems
 * - This file will be fully deprecated once all providers are migrated
 *
 * SEE: /learning/docs/trigger-lifecycle-audit.md
 */

import { createClient } from '@supabase/supabase-js'
import { ALL_NODE_COMPONENTS } from '@/lib/workflows/nodes'
import { getWebhookBaseUrl, getWebhookUrl } from '@/lib/utils/getBaseUrl'
import { safeDecrypt } from '@/lib/security/encryption'
import { flagIntegrationWorkflows, clearIntegrationWorkflowFlags } from '@/lib/integrations/integrationWorkflowManager'

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

interface WebhookTriggerConfig {
  workflowId: string
  userId: string
  triggerType: string
  providerId: string
  config: Record<string, any>
  webhookUrl: string
  secret?: string
}

interface WebhookPayload {
  workflowId: string
  triggerType: string
  providerId: string
  data: any
  timestamp: string
  signature?: string
}

export class TriggerWebhookManager {
  private supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  /**
   * Get all triggers that support webhooks
   */
  getWebhookSupportedTriggers() {
    return ALL_NODE_COMPONENTS.filter(node => 
      node.isTrigger && this.supportsWebhooks(node)
    )
  }

  /**
   * Check if a trigger supports webhooks
   */
  supportsWebhooks(trigger: any): boolean {
    const webhookSupportedTriggers = [
      'gmail_trigger_new_email',
      'gmail_trigger_new_attachment',
      'gmail_trigger_new_label',
      'google_calendar_trigger_new_event',
      'google_calendar_trigger_event_updated',
      'google_calendar_trigger_event_canceled',
      'google-drive:new_file_in_folder',
      'google-drive:new_folder_in_folder',
      'google-drive:file_updated',
      'google_sheets_trigger_new_row',
      'google_sheets_trigger_new_worksheet',
      'google_sheets_trigger_updated_row',
      'microsoft-outlook_trigger_new_email',
      'microsoft-outlook_trigger_email_sent',
      'microsoft-teams_trigger_new_message',
      'microsoft-teams_trigger_channel_created',
      'microsoft-onenote_trigger_new_note',
      'microsoft-onenote_trigger_note_modified',
      'slack_trigger_new_message',
      'slack_trigger_message_channels',
      'slack_trigger_channel_created',
      'slack_trigger_user_joined',
      'slack_trigger_reaction_added',
      'slack_trigger_reaction_removed',
      'trello_trigger_new_card',
      'trello_trigger_card_updated',
      'trello_trigger_card_moved',
      'trello_trigger_comment_added',
      'trello_trigger_member_changed',
      'github_trigger_new_issue',
      'github_trigger_issue_updated',
      'github_trigger_new_pr',
      'github_trigger_pr_updated',
      'notion_trigger_database_item_created',
      'notion_trigger_database_item_updated',
      'hubspot_trigger_new_contact',
      'hubspot_trigger_contact_updated',
      'airtable_trigger_new_record',
      'airtable_trigger_record_updated',
      'airtable_trigger_table_deleted',
      'discord_trigger_new_message',
      'discord_trigger_member_join',
      'discord_trigger_slash_command',
      'discord_trigger_reaction_added',
      'dropbox_trigger_new_file',
      'onedrive_trigger_new_file',
      'onedrive_trigger_file_modified'
    ]

    return webhookSupportedTriggers.includes(trigger.type)
  }

  /**
   * Register a webhook for a workflow trigger
   */
  async registerWebhook(config: WebhookTriggerConfig): Promise<string> {
    try {
      // Generate webhook secret if not provided
      const secret = config.secret || this.generateWebhookSecret()
      
      // Create webhook configuration
      const { data: webhookConfig, error } = await this.supabase
        .from('webhook_configs')
        .insert({
          workflow_id: config.workflowId,
          user_id: config.userId,
          trigger_type: config.triggerType,
          provider_id: config.providerId,
          webhook_url: config.webhookUrl,
          secret: secret,
          status: 'active',
          config: config.config
        })
        .select()
        .single()

      if (error) throw error

      // Register with external service if needed
      await this.registerWithExternalService(config, webhookConfig.id)

      return webhookConfig.id
    } catch (error) {
      logger.error('Error registering webhook:', error)
      throw error
    }
  }

  /**
   * Unregister all webhooks for a workflow
   */
  async unregisterWorkflowWebhooks(workflowId: string): Promise<void> {
    try {
      logger.info(`🔗 Unregistering all webhooks for workflow ${workflowId}`)

      // Get all webhook configs for this workflow
      const { data: webhookConfigs, error } = await this.supabase
        .from('webhook_configs')
        .select('*')
        .eq('workflow_id', workflowId)

      if (error) {
        logger.error('Failed to fetch webhook configs:', error)
        return
      }

      if (!webhookConfigs || webhookConfigs.length === 0) {
        logger.info('No webhooks found for this workflow')
        return
      }

      // Unregister each webhook
      for (const config of webhookConfigs) {
        await this.unregisterWebhook(config.id)
      }

      logger.info(`✅ Unregistered ${webhookConfigs.length} webhook(s) for workflow ${workflowId}`)
    } catch (error) {
      logger.error('Failed to unregister workflow webhooks:', error)
      // Don't throw - best effort cleanup
    }
  }

  async cleanupUnusedWebhooks(workflowId?: string): Promise<void> {
    try {
      let query = this.supabase
        .from('webhook_configs')
        .select('id, workflow_id, trigger_type, provider_id')

      if (workflowId) {
        query = query.eq('workflow_id', workflowId)
      }

      const { data: configs, error } = await query

      if (error) {
        logger.error('Failed to fetch webhook configs for cleanup:', error)
        return
      }

      if (!configs || configs.length === 0) {
        return
      }

      for (const config of configs) {
        if (!config.workflow_id) {
          await this.unregisterWebhook(config.id)
          continue
        }

        // Check if workflow exists
        const { data: workflow } = await this.supabase
          .from('workflows')
          .select('id, status')
          .eq('id', config.workflow_id)
          .single()

        if (!workflow) {
          await this.unregisterWebhook(config.id)
          continue
        }

        // Load nodes from normalized table
        const { data: nodes } = await this.supabase
          .from('workflow_nodes')
          .select('id, node_type, is_trigger')
          .eq('workflow_id', config.workflow_id)

        const hasMatchingTrigger = (nodes || []).some((node: any) => {
          return Boolean(node.is_trigger && node.node_type === config.trigger_type)
        })

        if (!hasMatchingTrigger) {
          logger.info('🧹 Cleaning up unused webhook config', {
            workflowId: config.workflow_id,
            webhookId: config.id,
            triggerType: config.trigger_type
          })
          await this.unregisterWebhook(config.id)
        }
      }
    } catch (cleanupError) {
      logger.error('Failed to cleanup unused webhooks:', cleanupError)
    }
  }

  /**
   * Unregister a webhook
   */
  async unregisterWebhook(webhookId: string): Promise<void> {
    try {
      // Get webhook config
      const { data: webhookConfig } = await this.supabase
        .from('webhook_configs')
        .select('*')
        .eq('id', webhookId)
        .single()

      if (webhookConfig) {
        // Unregister from external service
        await this.unregisterFromExternalService(webhookConfig)

        // Delete webhook execution history
        logger.info('🗑️ Cleaning up webhook execution history for webhook:', webhookId)
        const { error: executionDeleteError } = await this.supabase
          .from('webhook_executions')
          .delete()
          .eq('webhook_id', webhookId)

        if (executionDeleteError) {
          logger.warn('Failed to delete webhook execution history:', executionDeleteError)
          // Don't throw - continue with webhook deletion
        }

        // Delete webhook config from database
        await this.supabase
          .from('webhook_configs')
          .delete()
          .eq('id', webhookId)

        logger.info('✅ Webhook unregistered and cleaned up successfully')
      }
    } catch (error) {
      logger.error('Error unregistering webhook:', error)
      throw error
    }
  }

  /**
   * Process incoming webhook payload
   */
  async processWebhookPayload(webhookId: string, payload: any, headers: any): Promise<void> {
    try {
      // Get webhook configuration
      const { data: webhookConfig } = await this.supabase
        .from('webhook_configs')
        .select('*')
        .eq('id', webhookId)
        .single()

      if (!webhookConfig) {
        throw new Error('Webhook configuration not found')
      }

      // Validate payload signature if secret exists
      if (webhookConfig.secret && !this.validateSignature(payload, headers, webhookConfig.secret)) {
        throw new Error('Invalid webhook signature')
      }

      // Transform payload based on trigger type
      const transformedPayload = this.transformPayload(webhookConfig.trigger_type, payload)

      // Log webhook execution
      const executionId = await this.logWebhookExecution(webhookConfig, transformedPayload, headers)

      // Execute workflow
      await this.executeWorkflow(webhookConfig.workflow_id, transformedPayload, executionId)

      // Update last triggered timestamp
      await this.supabase
        .from('webhook_configs')
        .update({ last_triggered: new Date().toISOString() })
        .eq('id', webhookId)

    } catch (error) {
      logger.error('Error processing webhook payload:', error)
      
      // Log error
      await this.logWebhookError(webhookId, error)
      
      throw error
    }
  }

  /**
   * Transform payload based on trigger type
   */
  private transformPayload(triggerType: string, payload: any): any {
    switch (triggerType) {
      case 'gmail_trigger_new_email':
        return this.transformGmailEmailPayload(payload)
      
      case 'gmail_trigger_new_attachment':
        return this.transformGmailAttachmentPayload(payload)
      
      case 'google_calendar_trigger_new_event':
        return this.transformGoogleCalendarEventPayload(payload)
      
      case 'google-drive:new_file_in_folder':
        return this.transformGoogleDriveFilePayload(payload)
      
      case 'google_sheets_trigger_new_row':
        return this.transformGoogleSheetsRowPayload(payload)
      
      case 'slack_trigger_new_message':
      case 'slack_trigger_message_channels':
        return this.transformSlackMessagePayload(payload)
      
      case 'github_trigger_new_issue':
        return this.transformGithubIssuePayload(payload)
      
      case 'notion_trigger_database_item_created':
        return this.transformNotionPagePayload(payload)
      
      case 'hubspot_trigger_new_contact':
        return this.transformHubspotContactPayload(payload)
      
      case 'airtable_trigger_new_record':
      case 'airtable_trigger_record_updated':
      case 'airtable_trigger_table_deleted':
        return this.transformAirtableRecordPayload(payload)
      
      case 'discord_trigger_new_message':
        return this.transformDiscordMessagePayload(payload)
      
      default:
        return payload
    }
  }

  /**
   * Transform Gmail email payload
   */
  private transformGmailEmailPayload(payload: any): any {
    return {
      email: {
        id: payload.id,
        threadId: payload.threadId,
        labelIds: payload.labelIds,
        snippet: payload.snippet,
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        body: payload.body,
        attachments: payload.attachments || [],
        receivedAt: payload.receivedAt || new Date().toISOString()
      }
    }
  }

  /**
   * Transform Gmail attachment payload
   */
  private transformGmailAttachmentPayload(payload: any): any {
    return {
      email: {
        id: payload.emailId,
        threadId: payload.threadId,
        from: payload.from,
        subject: payload.subject,
        attachment: {
          id: payload.attachmentId,
          name: payload.attachmentName,
          size: payload.attachmentSize,
          mimeType: payload.attachmentMimeType
        }
      }
    }
  }

  /**
   * Transform Google Calendar event payload
   */
  private transformGoogleCalendarEventPayload(payload: any): any {
    return {
      event: {
        id: payload.id,
        summary: payload.summary,
        description: payload.description,
        start: payload.start,
        end: payload.end,
        location: payload.location,
        attendees: payload.attendees || [],
        organizer: payload.organizer,
        created: payload.created,
        updated: payload.updated
      }
    }
  }

  /**
   * Transform Google Drive file payload
   */
  private transformGoogleDriveFilePayload(payload: any): any {
    return {
      file: {
        id: payload.id,
        name: payload.name,
        mimeType: payload.mimeType,
        size: payload.size,
        parents: payload.parents || [],
        created: payload.created,
        modified: payload.modified,
        webViewLink: payload.webViewLink
      }
    }
  }

  /**
   * Transform Google Sheets row payload
   */
  private transformGoogleSheetsRowPayload(payload: any): any {
    return {
      row: {
        rowIndex: payload.rowIndex,
        values: payload.values,
        spreadsheetId: payload.spreadsheetId,
        sheetName: payload.sheetName,
        timestamp: payload.timestamp || new Date().toISOString()
      }
    }
  }

  /**
   * Transform Slack message payload
   */
  private transformSlackMessagePayload(payload: any): any {
    return {
      message: {
        id: payload.ts,
        text: payload.text,
        user: payload.user,
        channel: payload.channel,
        team: payload.team,
        timestamp: payload.ts,
        attachments: payload.attachments || []
      }
    }
  }

  /**
   * Transform GitHub issue payload
   */
  private transformGithubIssuePayload(payload: any): any {
    return {
      issue: {
        id: payload.id,
        number: payload.number,
        title: payload.title,
        body: payload.body,
        state: payload.state,
        user: payload.user,
        assignees: payload.assignees || [],
        labels: payload.labels || [],
        created_at: payload.created_at,
        updated_at: payload.updated_at
      }
    }
  }

  /**
   * Transform Notion page payload
   */
  private transformNotionPagePayload(payload: any): any {
    return {
      page: {
        id: payload.id,
        title: payload.title,
        properties: payload.properties,
        parent: payload.parent,
        created_time: payload.created_time,
        last_edited_time: payload.last_edited_time,
        url: payload.url
      }
    }
  }

  /**
   * Transform HubSpot contact payload
   */
  private transformHubspotContactPayload(payload: any): any {
    return {
      contact: {
        id: payload.id,
        properties: payload.properties,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt
      }
    }
  }

  /**
   * Transform Airtable record payload
   */
  private transformAirtableRecordPayload(payload: any): any {
    return {
      record: {
        id: payload.id,
        fields: payload.fields,
        createdTime: payload.createdTime,
        commentCount: payload.commentCount
      }
    }
  }

  /**
   * Transform Discord message payload
   */
  private transformDiscordMessagePayload(payload: any): any {
    return {
      message: {
        id: payload.id,
        content: payload.content,
        author: payload.author,
        channel_id: payload.channel_id,
        guild_id: payload.guild_id,
        timestamp: payload.timestamp,
        attachments: payload.attachments || []
      }
    }
  }

  /**
   * Register Discord webhook via Discord API
   */
  private async registerDiscordWebhook(config: WebhookTriggerConfig): Promise<void> {
    try {
      const { registerDiscordWebhook } = await import('./registration')
      
      const registration = {
        provider: 'discord',
        webhookUrl: config.webhookUrl,
        events: ['message_create'], // Discord event types
        secret: this.generateWebhookSecret(),
        config: config.config,
        userId: config.userId
      }
      
      await registerDiscordWebhook(registration)
      logger.info('✅ Discord webhook registered successfully via API')
    } catch (error) {
      logger.error('Failed to register Discord webhook:', error)
      throw error
    }
  }

  /**
   * Register Gmail watch for push notifications
   */
  private async registerGmailWatch(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      // Get user's Gmail integration
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .eq('provider', 'gmail')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      if (!integration) {
        throw new Error('Gmail integration not found or not connected')
      }

      // Import Gmail watch setup function
      const { setupGmailWatch } = await import('./gmail-watch-setup')

      // Google Cloud Pub/Sub topic name
      const topicName = process.env.GMAIL_PUBSUB_TOPIC

      if (!topicName || topicName.includes('YOUR_PROJECT_ID')) {
        throw new Error('GMAIL_PUBSUB_TOPIC environment variable not configured. Please set it to your Google Cloud Pub/Sub topic.')
      }

      // Set up the watch
      const watchResult = await setupGmailWatch({
        userId: config.userId,
        integrationId: integration.id,
        topicName: topicName,
        labelIds: config.config?.labelIds || ['INBOX']
      })

      // Store the history ID and expiration in webhook config
      const expiration = watchResult.expiration ? new Date(watchResult.expiration) : (() => {
        const date = new Date()
        date.setDate(date.getDate() + 7)
        return date
      })()

      await this.supabase
        .from('webhook_configs')
        .update({
          config: {
            watch: {
              historyId: watchResult.historyId,
              emailAddress: watchResult.emailAddress,
              expiration: expiration.toISOString(),
              topicName: topicName
            }
          }
        })
        .eq('id', webhookId)

      logger.info('✅ Gmail watch registered successfully, expires:', expiration.toISOString())
    } catch (error) {
      logger.error('Failed to register Gmail watch:', error)
      throw error
    }
  }

  /**
   * Register Google Calendar watch
   */
  private async registerGoogleCalendarWatch(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      // Get user's Google Calendar integration
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .eq('provider', 'google-calendar')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      if (!integration) {
        throw new Error('Google Calendar integration not found or not connected')
      }

      // Import Calendar watch setup function
      const { setupGoogleCalendarWatch } = await import('./google-calendar-watch-setup')

      // Extract calendar configuration (support multiple calendars or single)
      const calendars: string[] | null = Array.isArray(config.config?.calendars)
        ? (config.config?.calendars as string[])
        : null
      const calendarId = config.config?.calendarId || 'primary'
      const eventTypes = config.config?.eventTypes || []

      const targets = calendars && calendars.length > 0 ? calendars : [calendarId]

      const results: Array<{ calendarId: string; startTime: string; expiration: string }> = []
      for (const cal of targets) {
        const result = await setupGoogleCalendarWatch({
          userId: config.userId,
          integrationId: integration.id,
          calendarId: cal,
          eventTypes: eventTypes
        })
        results.push({ calendarId: cal, startTime: result.startTime, expiration: result.expiration })
      }

      const existingConfig = config.config || {}
      const firstStartTime = results[0]?.startTime || existingConfig.watch?.startTime || new Date().toISOString()

      const updatedConfig = {
        ...existingConfig,
        calendars: calendars && calendars.length > 0 ? calendars : undefined,
        calendarId: calendars && calendars.length > 0 ? undefined : calendarId,
        eventTypes,
        watch: {
          ...(existingConfig.watch || {}),
          // Keep a single watch metadata object for compatibility
          startTime: firstStartTime
        }
      }

      await this.supabase
        .from('webhook_configs')
        .update({ config: updatedConfig })
        .eq('id', webhookId)

      logger.info('✅ Google Calendar watch registered successfully for', targets.length, 'calendar(s)')
    } catch (error) {
      logger.error('Failed to register Google Calendar watch:', error)
      throw error
    }
  }

  /**
   * Register Google Drive watch
   */
  private async registerGoogleDriveWatch(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      // Get user's Google Drive integration
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .eq('provider', 'google-drive')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      if (!integration) {
        throw new Error('Google Drive integration not found or not connected')
      }

      // Import Drive watch setup function
      const { setupGoogleDriveWatch } = await import('./google-drive-watch-setup')

      // Extract drive configuration
      const folderId = config.config?.folderId
      const includeRemoved = config.config?.includeRemoved || false

      // Set up the watch
      const result = await setupGoogleDriveWatch({
        userId: config.userId,
        integrationId: integration.id,
        folderId: folderId,
        includeRemoved: includeRemoved
      })

      // Store the watch details in webhook config
      await this.supabase
        .from('webhook_configs')
        .update({
          metadata: {
            channelId: result.channelId,
            resourceId: result.resourceId,
            expiration: result.expiration,
            folderId: folderId
          }
        })
        .eq('id', webhookId)

      logger.info('✅ Google Drive watch registered successfully, expires:', result.expiration)
    } catch (error) {
      logger.error('Failed to register Google Drive watch:', error)
      throw error
    }
  }

  /**
   * Register Google Sheets watch (using Drive API)
   */
  private async registerGoogleSheetsWatch(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      // Get user's Google Sheets integration
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .in('provider', ['google-sheets', 'google_sheets'])
        .in('status', CONNECTED_STATUSES_LIST)
        .maybeSingle()

      if (!integration) {
        throw new Error('Google Sheets integration not found or not connected')
      }

      // Import Sheets watch setup function
      const { setupGoogleSheetsWatch, stopGoogleSheetsWatch } = await import('./google-sheets-watch-setup')

      // Extract sheets configuration
      const spreadsheetId = config.config?.spreadsheetId
      const sheetName = config.config?.sheetName
      const triggerType = config.triggerType.includes('new_row') ? 'new_row' :
                          config.triggerType.includes('updated_row') ? 'updated_row' : 'new_worksheet'

      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required for Google Sheets webhook registration')
      }

      // Best-effort cleanup of existing watch subscriptions for this sheet to prevent duplicate notifications
      try {
        const { data: existingSubscriptions } = await this.supabase
          .from('google_watch_subscriptions')
          .select('channel_id, resource_id, metadata, integration_id')
          .eq('provider', 'google-sheets')
          .eq('user_id', config.userId)
          .eq('integration_id', integration.id)

        if (Array.isArray(existingSubscriptions)) {
          for (const sub of existingSubscriptions) {
            if (!sub?.channel_id || !sub?.resource_id) continue

            let subscriptionMetadata: any = sub.metadata || {}
            if (typeof subscriptionMetadata === 'string') {
              try {
                subscriptionMetadata = JSON.parse(subscriptionMetadata)
              } catch {
                subscriptionMetadata = {}
              }
            }

            const metadataSpreadsheetId = subscriptionMetadata?.spreadsheetId || subscriptionMetadata?.spreadsheet_id || null
            const metadataSheetName = subscriptionMetadata?.sheetName || subscriptionMetadata?.sheet_name || null

            const spreadsheetMatches = metadataSpreadsheetId === spreadsheetId
            const sheetMatches = !sheetName || !metadataSheetName || metadataSheetName === sheetName

            if (spreadsheetMatches && sheetMatches) {
              await stopGoogleSheetsWatch(
                config.userId,
                sub.integration_id || integration.id,
                sub.channel_id,
                sub.resource_id
              )
            }
          }
        }
      } catch (cleanupError) {
        logger.warn('Failed to clean up existing Google Sheets watches before registration:', cleanupError)
      }

      // Set up the watch
      const result = await setupGoogleSheetsWatch({
        userId: config.userId,
        integrationId: integration.id,
        spreadsheetId: spreadsheetId,
        sheetName: sheetName,
        triggerType: triggerType as any
      })

      // Store the watch details in webhook config
      await this.supabase
        .from('webhook_configs')
        .update({
          metadata: {
            channelId: result.channelId,
            resourceId: result.resourceId,
            expiration: result.expiration,
            spreadsheetId: spreadsheetId,
            sheetName: sheetName,
            lastRowCount: result.lastRowCount,
            integrationId: integration.id
          }
        })
        .eq('id', webhookId)

      logger.info('✅ Google Sheets watch registered successfully, expires:', result.expiration)
    } catch (error) {
      logger.error('Failed to register Google Sheets watch:', error)
      throw error
    }
  }

  /**
   * Register webhook with external service
   *
   * NOTE: Many providers are now managed by TriggerLifecycleManager and are skipped here.
   * See file header for list of deprecated providers.
   */
  private async registerWithExternalService(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    // List of providers now managed by TriggerLifecycleManager (skip registration here)
    const lifecycleManagedProviders = [
      'microsoft-outlook',
      'teams', // NOTE: Teams uses 'teams' not 'microsoft-teams'
      'microsoft-onenote',
      'onedrive',
      'gmail',
      'google-calendar',
      'google-drive',
      'google-sheets',
      'google_sheets',
      'google-docs',
      'airtable',
      'discord',
      'slack',
      'stripe',
      'shopify'
    ]

    if (lifecycleManagedProviders.includes(config.providerId)) {
      logger.info(`⏭️ Skipping webhook registration for ${config.providerId} - now managed by TriggerLifecycleManager`)
      return
    }

    // This integrates with external APIs to register webhooks
    logger.info('🔗 registerWithExternalService called for provider:', config.providerId)

    switch (config.providerId) {
      case 'discord':
        // Discord webhooks are automatically created via Discord API
        logger.info('🎯 Calling registerDiscordWebhook for config:', config)
        await this.registerDiscordWebhook(config)
        logger.info('✅ registerDiscordWebhook completed')
        break
      
      case 'google-docs':
        // Google Docs changes arrive via Google Drive change notifications
        // Reuse Drive watch to detect document changes
        logger.info('🔗 Setting up Google Docs watch via Drive change notifications')
        await this.registerGoogleDriveWatch({ ...config, providerId: 'google-drive', config: { ...(config.config || {}) }, contextProvider: 'google-docs' } as any, webhookId)
        break
        
      case 'gmail':
        // Gmail uses push notifications via Google Cloud Pub/Sub
        logger.info('🔗 Setting up Gmail watch for webhook notifications')
        await this.registerGmailWatch(config, webhookId)
        break
      
      case 'google-calendar':
        // Google Calendar uses watch API
        logger.info('🔗 Setting up Google Calendar watch for webhook notifications')
        await this.registerGoogleCalendarWatch(config, webhookId)
        break

      case 'google-drive':
        // Google Drive uses watch API
        logger.info('🔗 Setting up Google Drive watch for webhook notifications')
        await this.registerGoogleDriveWatch(config, webhookId)
        break

      case 'google-sheets':
      case 'google_sheets':
        // Google Sheets uses Drive watch API
        logger.info('🔗 Setting up Google Sheets watch for webhook notifications')
        await this.registerGoogleSheetsWatch(config, webhookId)
        break

      case 'airtable':
        // Register Airtable webhook for the base
        logger.info('🔗 Setting up Airtable webhook for base monitoring')
        await this.registerAirtableWebhook(config, webhookId)
        break

      case 'dropbox':
        logger.info('🔗 Preparing Dropbox webhook cursor state')
        await this.registerDropboxWebhook(config, webhookId)
        break

      case 'trello':
        logger.info('🔗 Setting up Trello webhook for board monitoring')
        await this.registerTrelloWebhook(config, webhookId)
        break

      case 'onedrive': {
        logger.info('🔗 Setting up OneDrive watch via Microsoft Graph subscriptions')
        await this.registerOneDriveWebhook(config, webhookId)
        break
      }

      case 'microsoft-outlook': {
        logger.info('🔗 Setting up Outlook email watch via Microsoft Graph subscriptions')
        await this.registerOutlookWebhook(config, webhookId)
        break
      }

      case 'microsoft-teams': {
        logger.info('🔗 Setting up Teams watch via Microsoft Graph subscriptions')
        await this.registerTeamsWebhook(config, webhookId)
        break
      }

      case 'microsoft-onenote': {
        logger.info('🔗 Setting up OneNote watch via Microsoft Graph subscriptions')
        await this.registerOneNoteWebhook(config, webhookId)
        break
      }

      case 'slack':
        // Slack uses Event Subscriptions configured at app level
        // We store the configuration for filtering events
        logger.info('🔗 Setting up Slack event subscription configuration')
        await this.registerSlackWebhook(config, webhookId)
        break

      case 'github':
        // GitHub webhooks are configured through repository API
        logger.info('🔗 Setting up GitHub webhook for repository monitoring')
        await this.registerGithubWebhook(config, webhookId)
        break

      default:
        logger.info(`Webhook registration for ${config.providerId} not yet implemented`)
    }
  }

  /**
   * Register Slack webhook (Event Subscriptions)
   */
  private async registerSlackWebhook(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      // Slack Event Subscriptions are configured at the app level in Slack's dashboard
      // We store the configuration here for filtering events when they arrive
      const channelId = config.config?.channelId || config.config?.channel
      const eventTypes = config.config?.eventTypes || []

      // Store the webhook configuration details for event filtering
      await this.supabase
        .from('webhook_configs')
        .update({
          metadata: {
            channelId: channelId || null,
            eventTypes: eventTypes,
            triggerType: config.triggerType,
          }
        })
        .eq('id', webhookId)

      logger.info('✅ Slack event subscription configuration stored', {
        channelId: channelId || 'all channels',
        eventTypes: eventTypes.length > 0 ? eventTypes : 'all events'
      })
    } catch (error) {
      logger.error('Failed to register Slack webhook configuration:', error)
      throw error
    }
  }

  /**
   * Register GitHub webhook for repository
   */
  private async registerGithubWebhook(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      // Get user's GitHub integration
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .eq('provider', 'github')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      if (!integration) {
        throw new Error('GitHub integration not found or not connected')
      }

      const accessToken = integration.access_token ? safeDecrypt(integration.access_token) : null
      if (!accessToken) {
        throw new Error('GitHub access token missing for webhook registration')
      }

      const repository = config.config?.repository || config.config?.repo
      if (!repository) {
        throw new Error('GitHub repository is required for webhook registration')
      }

      // Parse repository (format: "owner/repo")
      const [owner, repo] = repository.split('/')
      if (!owner || !repo) {
        throw new Error('Invalid repository format. Expected "owner/repo"')
      }

      // Determine which events to subscribe to based on trigger type
      let events: string[] = []
      switch (config.triggerType) {
        case 'github_trigger_new_issue':
        case 'github_trigger_issue_updated':
          events = ['issues']
          break
        case 'github_trigger_new_pr':
        case 'github_trigger_pr_updated':
          events = ['pull_request']
          break
        default:
          events = ['push', 'issues', 'pull_request']
      }

      const webhookUrl = getWebhookUrl('github')

      // Create webhook via GitHub API
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/hooks`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28'
          },
          body: JSON.stringify({
            name: 'web',
            active: true,
            events: events,
            config: {
              url: webhookUrl,
              content_type: 'json',
              insecure_ssl: '0'
            }
          })
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`GitHub webhook creation failed: ${errorText}`)
      }

      const webhookData = await response.json()

      // Store webhook metadata
      await this.supabase
        .from('webhook_configs')
        .update({
          external_id: webhookData.id.toString(),
          metadata: {
            githubWebhookId: webhookData.id,
            repository: repository,
            owner: owner,
            repo: repo,
            events: events,
            url: webhookData.url
          }
        })
        .eq('id', webhookId)

      logger.info('✅ GitHub webhook registered successfully', {
        repository,
        webhookId: webhookData.id,
        events
      })
    } catch (error) {
      logger.error('Failed to register GitHub webhook:', error)
      throw error
    }
  }

  /**
   * Register Microsoft Teams webhook (Microsoft Graph subscription)
   */
  private async registerTeamsWebhook(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      // Load user's Teams integration
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .eq('provider', 'microsoft-teams')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      if (!integration) {
        throw new Error('Microsoft Teams integration not found or not connected')
      }

      const accessToken: string | null = (typeof integration.access_token === 'string'
        ? safeDecrypt(integration.access_token)
        : null)
      if (!accessToken) {
        throw new Error('Teams access token missing for webhook registration')
      }

      // Compute notification URL (use Microsoft webhook receiver)
      const baseUrl = getWebhookBaseUrl()
      const notificationUrl = `${baseUrl}/api/webhooks/microsoft`

      // Determine resource to subscribe to based on trigger type
      let resource = '/teams/getAllMessages'
      let changeType = 'created'

      const teamId = config.config?.teamId
      const channelId = config.config?.channelId

      if (teamId && channelId) {
        resource = `/teams/${teamId}/channels/${channelId}/messages`
      } else if (teamId) {
        resource = `/teams/${teamId}/channels/getAllMessages`
      }

      if (config.triggerType === 'microsoft-teams_trigger_channel_created') {
        resource = '/teams/getAllChannels'
        changeType = 'created'
      }

      // Create subscription via Microsoft Graph
      const { MicrosoftGraphSubscriptionManager } = await import('@/lib/microsoft-graph/subscriptionManager')
      const mgr = new MicrosoftGraphSubscriptionManager()
      const sub = await mgr.createSubscription({
        resource,
        changeType,
        userId: config.userId,
        accessToken,
        notificationUrl,
      })

      // Persist metadata on our webhook config
      const metadata = {
        subscriptionId: sub.id,
        expirationDateTime: sub.expirationDateTime,
        resource,
        changeType,
        teamId: teamId || null,
        channelId: channelId || null,
      }

      await this.supabase
        .from('webhook_configs')
        .update({ external_id: sub.id, metadata })
        .eq('id', webhookId)

      logger.info('✅ Teams subscription registered', metadata)
    } catch (error) {
      if (error instanceof Error && error.message.includes('401')) {
        try {
          await flagIntegrationWorkflows({
            integrationId: integration?.id,
            provider: 'microsoft-teams',
            userId: integration?.user_id,
            reason: 'Microsoft authentication expired while registering Teams webhook'
          })
        } catch (flagErr) {
          logger.warn('Failed to flag Teams integration workflows for reconnection:', flagErr)
        }
      }
      logger.error('Failed to register Teams webhook:', error)
      throw error
    }
  }

  /**
   * Register Microsoft OneNote webhook (Microsoft Graph subscription)
   */
  private async registerOneNoteWebhook(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      // Load user's OneNote integration
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .eq('provider', 'microsoft-onenote')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      if (!integration) {
        throw new Error('Microsoft OneNote integration not found or not connected')
      }

      const accessToken: string | null = (typeof integration.access_token === 'string'
        ? safeDecrypt(integration.access_token)
        : null)
      if (!accessToken) {
        throw new Error('OneNote access token missing for webhook registration')
      }

      // Compute notification URL (use Microsoft webhook receiver)
      const baseUrl = getWebhookBaseUrl()
      const notificationUrl = `${baseUrl}/api/webhooks/microsoft`

      // Determine resource to subscribe to based on trigger type
      let resource = '/me/onenote/pages'
      let changeType = 'created,updated'

      const notebookId = config.config?.notebookId
      const sectionId = config.config?.sectionId

      if (sectionId) {
        resource = `/me/onenote/sections/${sectionId}/pages`
      } else if (notebookId) {
        resource = `/me/onenote/notebooks/${notebookId}/sections/pages`
      }

      if (config.triggerType === 'microsoft-onenote_trigger_new_note') {
        changeType = 'created'
      } else if (config.triggerType === 'microsoft-onenote_trigger_note_modified') {
        changeType = 'updated'
      }

      // Create subscription via Microsoft Graph
      const { MicrosoftGraphSubscriptionManager } = await import('@/lib/microsoft-graph/subscriptionManager')
      const mgr = new MicrosoftGraphSubscriptionManager()
      const sub = await mgr.createSubscription({
        resource,
        changeType,
        userId: config.userId,
        accessToken,
        notificationUrl,
      })

      // Persist metadata on our webhook config
      const metadata = {
        subscriptionId: sub.id,
        expirationDateTime: sub.expirationDateTime,
        resource,
        changeType,
        notebookId: notebookId || null,
        sectionId: sectionId || null,
      }

      await this.supabase
        .from('webhook_configs')
        .update({ external_id: sub.id, metadata })
        .eq('id', webhookId)

      logger.info('✅ OneNote subscription registered', metadata)
    } catch (error) {
      if (error instanceof Error && error.message.includes('401')) {
        try {
          await flagIntegrationWorkflows({
            integrationId: integration?.id,
            provider: 'microsoft-onenote',
            userId: integration?.user_id,
            reason: 'Microsoft authentication expired while registering OneNote webhook'
          })
        } catch (flagErr) {
          logger.warn('Failed to flag OneNote integration workflows for reconnection:', flagErr)
        }
      }
      logger.error('Failed to register OneNote webhook:', error)
      throw error
    }
  }

  /**
   * Register OneDrive webhook (Microsoft Graph subscription)
   */
  private async registerOneDriveWebhook(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      // Load user's OneDrive integration
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .eq('provider', 'onedrive')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      if (!integration) {
        throw new Error('OneDrive integration not found or not connected')
      }

      const accessToken: string | null = (typeof integration.access_token === 'string'
        ? safeDecrypt(integration.access_token)
        : null)
      if (!accessToken) {
        throw new Error('OneDrive access token missing for webhook registration')
      }

      // Compute notification URL (use Microsoft webhook receiver)
      const baseUrl = getWebhookBaseUrl()
      const notificationUrl = `${baseUrl}/api/webhooks/microsoft`

      // Determine resource to subscribe to
      const folderId: string | undefined = config.config?.folderId
      const includeSubfolders: boolean = config.config?.includeSubfolders !== false
      const watchType: string = config.config?.watchType || 'any'

      // For OneDrive driveItem subscriptions, Microsoft Graph only supports 'updated'
      // Creation events are detected via delta processing after updates
      const changeType = 'updated'
      // Microsoft Graph does not support per-item driveItem subscriptions.
      // Subscribe at drive root and filter to the configured folder during processing.
      const resource = '/me/drive/root'

      // Create subscription via Microsoft Graph
      const { MicrosoftGraphSubscriptionManager } = await import('@/lib/microsoft-graph/subscriptionManager')
      const mgr = new MicrosoftGraphSubscriptionManager()
      const sub = await mgr.createSubscription({
        resource,
        changeType,
        userId: config.userId,
        accessToken,
        notificationUrl,
      })

      // Persist metadata on our webhook config for fast unregister/diagnostics
      const metadata = {
        subscriptionId: sub.id,
        expirationDateTime: sub.expirationDateTime,
        resource,
        changeType,
        folderId: folderId || null,
        includeSubfolders,
      }

      await this.supabase
        .from('webhook_configs')
        .update({ metadata })
        .eq('id', webhookId)

      logger.info('✅ OneDrive subscription registered', metadata)
    } catch (error) {
      // Mark workflows if auth expired
      if (error instanceof Error && error.message.includes('401')) {
        try {
          await flagIntegrationWorkflows({
            integrationId: integration?.id,
            provider: 'onedrive',
            userId: integration?.user_id,
            reason: 'Microsoft authentication expired while registering OneDrive webhook'
          })
        } catch (flagErr) {
          logger.warn('Failed to flag OneDrive integration workflows for reconnection:', flagErr)
        }
      }
      logger.error('Failed to register OneDrive webhook:', error)
      throw error
    }
  }

  /**
   * Register Microsoft Outlook webhook (Microsoft Graph subscription)
   */
  private async registerOutlookWebhook(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      // Load user's Outlook integration
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .eq('provider', 'microsoft-outlook')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      if (!integration) {
        throw new Error('Microsoft Outlook integration not found or not connected')
      }

      const accessToken: string | null = (typeof integration.access_token === 'string'
        ? safeDecrypt(integration.access_token)
        : null)
      if (!accessToken) {
        throw new Error('Outlook access token missing for webhook registration')
      }

      // Compute notification URL (use Microsoft webhook receiver)
      const baseUrl = getWebhookBaseUrl()
      const notificationUrl = `${baseUrl}/api/webhooks/microsoft`

      // Determine resource to subscribe to based on trigger type
      let resource = '/me/messages'
      let changeType = 'created,updated'

      if (config.triggerType === 'microsoft-outlook_trigger_email_sent') {
        resource = '/me/mailFolders/sentitems/messages'
        changeType = 'created'
      }

      // Apply folder filter if specified
      const folder = config.config?.folder
      if (folder && folder !== 'inbox' && config.triggerType === 'microsoft-outlook_trigger_new_email') {
        resource = `/me/mailFolders/${folder}/messages`
      }

      // Create subscription via Microsoft Graph
      const { MicrosoftGraphSubscriptionManager } = await import('@/lib/microsoft-graph/subscriptionManager')
      const mgr = new MicrosoftGraphSubscriptionManager()
      const sub = await mgr.createSubscription({
        resource,
        changeType,
        userId: config.userId,
        accessToken,
        notificationUrl,
      })

      // Persist metadata on our webhook config
      const metadata = {
        subscriptionId: sub.id,
        expirationDateTime: sub.expirationDateTime,
        resource,
        changeType,
        folder: folder || 'inbox',
      }

      await this.supabase
        .from('webhook_configs')
        .update({ external_id: sub.id, metadata })
        .eq('id', webhookId)

      logger.info('✅ Outlook email subscription registered', metadata)
    } catch (error) {
      // Mark workflows if auth expired
      if (error instanceof Error && error.message.includes('401')) {
        try {
          await flagIntegrationWorkflows({
            integrationId: integration?.id,
            provider: 'microsoft-outlook',
            userId: integration?.user_id,
            reason: 'Microsoft authentication expired while registering Outlook webhook'
          })
        } catch (flagErr) {
          logger.warn('Failed to flag Outlook integration workflows for reconnection:', flagErr)
        }
      }
      logger.error('Failed to register Outlook webhook:', error)
      throw error
    }
  }

  /**
   * Register Microsoft Teams webhook (Microsoft Graph subscription)
   */
  private async registerTeamsWebhook(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    // Similar implementation for Teams
    logger.info('Teams webhook registration not yet implemented')
  }

  /**
   * Register Microsoft OneNote webhook (Microsoft Graph subscription)
   */
  private async registerOneNoteWebhook(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    // Similar implementation for OneNote
    logger.info('OneNote webhook registration not yet implemented')
  }

  /**
   * Register Airtable webhook for base monitoring
   */
  private async registerAirtableWebhook(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      // Get user's Airtable integration
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .eq('provider', 'airtable')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      if (!integration) {
        throw new Error('Airtable integration not found or not connected')
      }

      // Import Airtable webhook setup function
      const { ensureAirtableWebhookForBase } = await import('@/lib/integrations/airtable/webhooks')

      // Extract baseId and tableName from config
      const baseId = config.config?.baseId
      const tableName = config.config?.tableName

      if (!baseId) {
        throw new Error('Base ID is required for Airtable webhook registration')
      }

      logger.info(`🔧 Registering Airtable webhook for base: ${baseId}, table: ${tableName || 'all tables'}`)

      // Get the webhook URL for Airtable (uses HTTPS in development via ngrok if configured)
      const webhookUrl = getWebhookUrl('airtable')
      logger.info(`📢 Using webhook URL: ${webhookUrl}`)

      // Register webhook with Airtable (this handles creating or reusing existing webhook)
      await ensureAirtableWebhookForBase(config.userId, baseId, webhookUrl, tableName)

      const { data: airtableWebhook } = await this.supabase
        .from('airtable_webhooks')
        .select('metadata')
        .eq('user_id', config.userId)
        .eq('base_id', baseId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const tableId = config.config?.tableId || airtableWebhook?.metadata?.tableId || airtableWebhook?.metadata?.table_id || null

      // Store webhook configuration details
      await this.supabase
        .from('webhook_configs')
        .update({
          metadata: {
            baseId,
            tableName: config.config?.tableName || tableName || null,
            tableId,
            triggerType: config.triggerType,
          },
          config: {
            ...config.config,
            tableId
          }
        })
        .eq('id', webhookId)

      logger.info('✅ Airtable webhook registered successfully for base:', baseId)
    } catch (error) {
      logger.error('Failed to register Airtable webhook:', error)
      throw error
    }
  }

  /**
   * Initialize Dropbox webhook state by storing a cursor for the selected folder.
   * Dropbox webhooks are configured at the app level, so here we make sure we have
   * per-workflow cursor metadata that allows us to fetch changes when Dropbox notifies us.
   */
  private async registerDropboxWebhook(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .eq('provider', 'dropbox')
        .in('status', CONNECTED_STATUSES_LIST)
        .maybeSingle()

      if (!integration) {
        throw new Error('Dropbox integration not found or not connected')
      }

      const accessToken = safeDecrypt(integration.access_token)
      if (!accessToken) {
        throw new Error('Dropbox access token missing for webhook registration')
      }

      const normalizedPath = this.normalizeDropboxPath(config.config?.path)
      const includeSubfolders = config.config?.includeSubfolders !== false
      const fileType = config.config?.fileType || 'any'

      // Request the latest cursor for the configured folder so we can continue from it later
      const cursorResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder/get_latest_cursor', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          path: normalizedPath,
          recursive: includeSubfolders,
          include_media_info: false,
          include_deleted: false,
          include_has_explicit_shared_members: false,
          include_mounted_folders: true,
          include_non_downloadable_files: false
        })
      })

      if (!cursorResponse.ok) {
        const errorBody = await cursorResponse.text().catch(() => '')
        logger.error('❌ Failed to fetch Dropbox cursor:', {
          status: cursorResponse.status,
          statusText: cursorResponse.statusText,
          body: errorBody
        })

        if (cursorResponse.status === 401) {
          await flagIntegrationWorkflows({
            integrationId: integration.id,
            provider: 'dropbox',
            userId: integration.user_id,
            reason: 'Dropbox authentication expired while registering webhook'
          })
        }
        throw new Error(`Failed to initialize Dropbox webhook cursor (HTTP ${cursorResponse.status})`)
      }

      const cursorJson = await cursorResponse.json()
      const cursor: string | undefined = cursorJson?.cursor

      if (!cursor) {
        throw new Error('Dropbox cursor missing in response')
      }

      // Attempt to capture the account ID for easier filtering later
      let accountId: string | null = null
      const rawMetadata = integration.metadata
      if (rawMetadata) {
        try {
          const parsed = typeof rawMetadata === 'string' ? JSON.parse(rawMetadata) : rawMetadata
          accountId = parsed?.account_id || parsed?.accountId || null
        } catch {
          // ignore metadata parse errors
        }
      }

      if (!accountId) {
        try {
          const accountResponse = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          })

          if (accountResponse.ok) {
            const accountJson = await accountResponse.json()
            accountId = accountJson?.account_id || null
          }
        } catch (accountError) {
          logger.warn('⚠️ Unable to fetch Dropbox account information:', accountError)
        }
      }

      const webhookUrl = getWebhookUrl('dropbox')

      let existingConfig: any = config.config || {}
      if (typeof existingConfig === 'string') {
        try {
          existingConfig = JSON.parse(existingConfig)
        } catch {
          existingConfig = {}
        }
      }

      const dropboxState = {
        cursor,
        path: normalizedPath,
        includeSubfolders,
        fileType,
        accountId,
        lastCursorSync: new Date().toISOString()
      }

      const updatedConfig = {
        ...existingConfig,
        path: normalizedPath,
        includeSubfolders,
        fileType,
        dropbox_state: dropboxState
      }

      await this.supabase
        .from('webhook_configs')
        .update({
          webhook_url: webhookUrl,
          config: updatedConfig
        })
        .eq('id', webhookId)

      logger.info('✅ Dropbox webhook cursor stored successfully', {
        webhookId,
        path: normalizedPath || 'root',
        includeSubfolders,
        hasAccountId: Boolean(accountId)
      })
    } catch (error) {
      logger.error('Failed to register Dropbox webhook:', error)
      throw error
    }
  }


  /**
   * Register Trello webhook for a specific board
   */
  private async registerTrelloWebhook(config: WebhookTriggerConfig, webhookId: string): Promise<void> {
    try {
      const boardId: string | undefined = config.config?.boardId || config.config?.board_id

      if (!boardId) {
        logger.info('ℹ️ Skipping Trello webhook registration - board not selected', {
          workflowId: config.workflowId,
          triggerType: config.triggerType
        })

        await this.supabase
          .from('webhook_configs')
          .update({
            metadata: {
              boardId: null,
              skipped: true,
              reason: 'missing_board',
              updatedAt: new Date().toISOString(),
              provider: 'trello',
              workflowId: config.workflowId
            },
            config: {
              ...config.config
            }
          })
          .eq('id', webhookId)

        return
      }

      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', config.userId)
        .eq('provider', 'trello')
        .in('status', CONNECTED_STATUSES_LIST)
        .maybeSingle()

      if (!integration) {
        throw new Error('Trello integration not found or not connected')
      }

      const accessToken = integration.access_token ? safeDecrypt(integration.access_token) : null

      // Handle API key extraction - check external_key first (encrypted), then metadata, then env
      let trelloKey: string | null = null

      // Try external_key (encrypted)
      if (integration.external_key) {
        const decrypted = safeDecrypt(integration.external_key)
        if (decrypted && decrypted !== 'null' && decrypted !== 'undefined') {
          trelloKey = decrypted
        }
      }

      // Try metadata.client_key (plain text)
      if (!trelloKey && integration.metadata?.client_key) {
        const metadataKey = integration.metadata.client_key
        if (typeof metadataKey === 'string' && metadataKey !== 'null' && metadataKey !== 'undefined') {
          trelloKey = metadataKey
        }
      }

      // Fallback to environment variable
      if (!trelloKey && process.env.TRELLO_CLIENT_ID) {
        trelloKey = process.env.TRELLO_CLIENT_ID
      }

      logger.info('🔐 Trello credentials check:', {
        hasAccessToken: !!accessToken,
        tokenLength: accessToken?.length,
        tokenPrefix: accessToken ? `${accessToken.substring(0, 8) }...` : 'none',
        hasApiKey: !!trelloKey,
        keySource: integration.external_key ? 'external_key' :
                  integration.metadata?.client_key ? 'metadata' :
                  process.env.TRELLO_CLIENT_ID ? 'env' : 'none',
        keyPrefix: trelloKey ? `${trelloKey.substring(0, 8) }...` : 'none'
      })

      if (!trelloKey) {
        throw new Error('Trello API key not configured - check TRELLO_CLIENT_ID environment variable')
      }

      if (!accessToken) {
        throw new Error('Missing Trello access token - reconnect your Trello integration')
      }

      const callbackURL = getWebhookUrl('trello')
            const description = `ChainReact workflow ${config.workflowId} - board ${boardId}`

      // First, verify the board is accessible
      logger.info('🔍 Verifying Trello board access before webhook creation', { boardId })
      const boardCheckUrl = new URL(`https://api.trello.com/1/boards/${boardId}`)
      boardCheckUrl.searchParams.set('key', trelloKey)
      boardCheckUrl.searchParams.set('token', accessToken)
      boardCheckUrl.searchParams.set('fields', 'id,name')

      logger.info('📡 Trello board check URL:', {
        url: boardCheckUrl.toString().replace(accessToken, 'TOKEN_HIDDEN').replace(trelloKey, 'KEY_HIDDEN'),
        hasKey: boardCheckUrl.searchParams.has('key'),
        hasToken: boardCheckUrl.searchParams.has('token'),
        boardId
      })

      const boardCheckResponse = await fetch(boardCheckUrl.toString())
      if (!boardCheckResponse.ok) {
        const boardError = await boardCheckResponse.text().catch(() => '')
        logger.error('❌ Cannot access Trello board', {
          boardId,
          status: boardCheckResponse.status,
          error: boardError
        })
        if (boardCheckResponse.status === 401) {
          throw new Error('Trello authentication failed - token may be expired or invalid')
        } else if (boardCheckResponse.status === 404) {
          throw new Error(`Trello board ${boardId} not found or not accessible`)
        } else {
          throw new Error(`Cannot access Trello board: ${boardError}`)
        }
      }

      const boardInfo = await boardCheckResponse.json()
      logger.info('✅ Trello board verified', { boardId, boardName: boardInfo.name })

      const webhookCreateUrl = new URL('https://api.trello.com/1/webhooks')
      webhookCreateUrl.searchParams.set('key', trelloKey)
      webhookCreateUrl.searchParams.set('token', accessToken)

      const formBody = new URLSearchParams({
        callbackURL,
        idModel: boardId,
        description,
        active: 'true'
      })

      logger.info('📤 Creating Trello webhook', {
        boardId,
        callbackURL,
        description
      })

      let createdWebhook: any = null

      try {
        const createResponse = await fetch(webhookCreateUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formBody.toString()
        })

        if (createResponse.ok) {
          createdWebhook = await createResponse.json()
          logger.info('✅ Trello webhook created successfully', { webhookId: createdWebhook.id })
        } else {
          const responseBody = await createResponse.text().catch(() => '')
          const isDuplicate = createResponse.status === 400 && responseBody.toLowerCase().includes('already exists')

          if (!isDuplicate) {
            logger.error('❌ Trello webhook creation failed', {
              status: createResponse.status,
              responseBody,
              boardId,
              callbackURL
            })

            if (createResponse.status === 401) {
              try {
                await flagIntegrationWorkflows({
                  integrationId: integration.id,
                  provider: 'trello',
                  userId: integration.user_id,
                  reason: 'Trello authentication failed during webhook registration'
                })
              } catch (flagError) {
                logger.warn('⚠️ Failed to flag Trello integration for reconnection:', flagError)
              }
              throw new Error(`Trello webhook creation unauthorized - token may lack required permissions or be invalid`)
            }
            throw new Error(`Trello webhook create failed (${createResponse.status}): ${responseBody}`)
          }
        }
      } catch (error) {
        if (!createdWebhook) {
          logger.warn('⚠️ Trello webhook create encountered an error, attempting to find existing webhook', error)
        }
      }

      if (!createdWebhook) {
        logger.info('🔄 Webhook creation returned duplicate, searching for existing webhook...')
        createdWebhook = await this.findExistingTrelloWebhook(trelloKey, accessToken, boardId, callbackURL)

        if (!createdWebhook) {
          logger.warn('⚠️ Webhook reported as duplicate but not found in list. Creating a placeholder.')
          // If Trello says it exists but we can't find it, create a placeholder
          // This can happen if the webhook was just created by another process
          createdWebhook = {
            id: `placeholder-${Date.now()}`,
            idModel: boardId,
            callbackURL,
            description,
            active: true
          }
        } else {
          logger.info('✅ Using existing Trello webhook', { webhookId: createdWebhook.id })
        }
      }

      await this.supabase
        .from('webhook_configs')
        .update({
          metadata: {
            boardId,
            trelloWebhookId: createdWebhook.id || null,
            callbackURL,
            description,
            registeredAt: new Date().toISOString(),
            provider: 'trello',
            integrationId: integration.id,
            workflowId: config.workflowId
          },
          config: {
            ...config.config,
            boardId
          }
        })
        .eq('id', webhookId)

      logger.info('✅ Trello webhook registered', {
        workflowId: config.workflowId,
        boardId,
        trelloWebhookId: createdWebhook.id
      })

      try {
        await clearIntegrationWorkflowFlags({
          integrationId: integration.id,
          provider: 'trello',
          userId: integration.user_id
        })
      } catch (clearError) {
        logger.warn('⚠️ Failed to clear Trello integration reconnect flags:', clearError)
      }
    } catch (error) {
      logger.error('Failed to register Trello webhook:', error)
      throw error
    }
  }

  private async findExistingTrelloWebhook(trelloKey: string, accessToken: string, boardId: string, callbackURL: string): Promise<any | null> {
    try {
      // The correct endpoint to list webhooks for the current token
      const listUrl = new URL(`https://api.trello.com/1/tokens/${accessToken}/webhooks`)
      listUrl.searchParams.set('key', trelloKey)

      logger.info('🔍 Looking for existing Trello webhook', {
        boardId,
        callbackURL,
        endpoint: listUrl.toString().replace(accessToken, 'TOKEN_HIDDEN').replace(trelloKey, 'KEY_HIDDEN')
      })

      const response = await fetch(listUrl.toString())
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        logger.warn('⚠️ Failed to list Trello webhooks for dedupe', { status: response.status, text })
        return null
      }

      const webhooks = await response.json()
      logger.info(`📋 Found ${webhooks.length} existing Trello webhooks`)

      if (!Array.isArray(webhooks)) {
        return null
      }

      // Find webhook matching our board and callback URL
      const existingWebhook = webhooks.find((hook: any) => {
        const matches = hook?.idModel === boardId && hook?.callbackURL === callbackURL
        if (matches) {
          logger.info('✅ Found matching existing webhook', {
            webhookId: hook.id,
            boardId: hook.idModel,
            active: hook.active
          })
        }
        return matches
      })

      if (!existingWebhook && webhooks.length > 0) {
        logger.info('📝 Existing webhooks (none match):', webhooks.map((h: any) => ({
          id: h.id,
          boardId: h.idModel,
          callbackURL: h.callbackURL,
          active: h.active
        })))
      }

      return existingWebhook || null
    } catch (error) {
      logger.warn('⚠️ Error checking existing Trello webhooks:', error)
      return null
    }
  }

  private async unregisterTrelloWebhook(webhookConfig: any): Promise<void> {
    try {
      const boardId: string | undefined = webhookConfig.metadata?.boardId || webhookConfig.config?.boardId || webhookConfig.config?.board_id
      let trelloWebhookId: string | undefined = webhookConfig.metadata?.trelloWebhookId || webhookConfig.metadata?.trello_webhook_id

      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', webhookConfig.user_id)
        .eq('provider', 'trello')
        .in('status', CONNECTED_STATUSES_LIST)
        .maybeSingle()

      if (!integration) {
        logger.info('ℹ️ Skipping Trello webhook unregister - integration not connected')
        return
      }

      const accessToken = integration.access_token ? safeDecrypt(integration.access_token) : null
      const metadataKey = typeof integration.metadata?.client_key === 'string' ? integration.metadata.client_key : null
      const integrationKeySource = integration.external_key ? safeDecrypt(integration.external_key) : null
      const trelloKeyRaw = integrationKeySource || metadataKey || process.env.TRELLO_CLIENT_ID || null
      const trelloKey = trelloKeyRaw && trelloKeyRaw !== 'null' && trelloKeyRaw !== 'undefined' ? trelloKeyRaw : null

      if (!trelloKey || !accessToken) {
        logger.info('ℹ️ Skipping Trello webhook unregister - missing credentials')
        return
      }

      const callbackURL = getWebhookUrl('trello')

      if (!trelloWebhookId && boardId) {
        const existingWebhook = await this.findExistingTrelloWebhook(trelloKey, accessToken, boardId, callbackURL)
        trelloWebhookId = existingWebhook?.id
      }

      if (!trelloWebhookId) {
        logger.info('ℹ️ Trello webhook ID not found for unregister', { boardId })
        return
      }

      const deleteUrl = new URL(`https://api.trello.com/1/webhooks/${trelloWebhookId}`)
      deleteUrl.searchParams.set('key', trelloKey)
      deleteUrl.searchParams.set('token', accessToken)

      const response = await fetch(deleteUrl.toString(), { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        const text = await response.text().catch(() => '')
        logger.warn('⚠️ Failed to delete Trello webhook', { status: response.status, text })
      } else {
        logger.info('✅ Trello webhook unregistered', { trelloWebhookId })
      }
    } catch (error) {
      logger.error('Failed to unregister Trello webhook:', error)
    }
  }

  /**
   * Unregister Discord webhook via Discord API
   */
  private async unregisterDiscordWebhook(webhookConfig: any): Promise<void> {
    try {
      // Get the Discord webhook details from our database
      const { data: registration } = await this.supabase
        .from('webhook_registrations')
        .select('*')
        .eq('provider', 'discord')
        .eq('webhook_url', webhookConfig.webhook_url)
        .single()
      
      if (registration && registration.external_webhook_id && registration.external_webhook_token) {
        // Delete the Discord webhook using Discord API
        const deleteResponse = await fetch(
          `https://discord.com/api/v10/webhooks/${registration.external_webhook_id}/${registration.external_webhook_token}`,
          { method: 'DELETE' }
        )
        
        if (deleteResponse.ok) {
          logger.info('✅ Discord webhook deleted successfully')
        } else {
          logger.warn('Failed to delete Discord webhook, but continuing cleanup')
        }
        
        // Remove from our webhook_registrations table
        await this.supabase
          .from('webhook_registrations')
          .delete()
          .eq('id', registration.id)
      }
    } catch (error) {
      logger.error('Failed to unregister Discord webhook:', error)
      // Don't throw - continue with cleanup even if Discord API fails
    }
  }

  /**
   * Unregister Gmail webhook
   */
  private async unregisterGmailWebhook(webhookConfig: any): Promise<void> {
    try {
      // Get metadata to find integration ID
      let metadata: any = webhookConfig.metadata || webhookConfig.config || {}
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata)
        } catch {
          metadata = {}
        }
      }

      // Try to find integration ID from metadata or look it up
      let integrationId = metadata.integrationId || metadata.integration_id

      if (!integrationId) {
        // Look up the Gmail integration for this user
        const { data: integration } = await this.supabase
          .from('integrations')
          .select('id')
          .eq('user_id', webhookConfig.user_id)
          .eq('provider', 'gmail')
          .in('status', CONNECTED_STATUSES_LIST)
          .maybeSingle()

        if (integration) {
          integrationId = integration.id
        }
      }

      if (!integrationId) {
        logger.info('Gmail integration not found, watch may already be stopped')
        return
      }

      const { stopGmailWatch } = await import('./gmail-watch-setup')
      await stopGmailWatch(webhookConfig.user_id, integrationId)

      logger.info('✅ Gmail watch stopped successfully')
    } catch (error) {
      logger.error('Failed to stop Gmail watch:', error)
      // Don't throw - watch might already be stopped
    }
  }

  /**
   * Unregister Google Calendar webhook
   */
  private async unregisterGoogleCalendarWebhook(webhookConfig: any): Promise<void> {
    try {
      let metadata: any = webhookConfig.metadata || {}
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata)
        } catch {
          metadata = {}
        }
      }

      const channelId = metadata.channelId || metadata.channel_id
      const resourceId = metadata.resourceId || metadata.resource_id
      let integrationId = metadata.integrationId || metadata.integration_id

      if (!channelId || !resourceId) {
        logger.info('Google Calendar watch metadata missing, watch may already be stopped')
        return
      }

      if (!integrationId) {
        const { data: integration } = await this.supabase
          .from('integrations')
          .select('id')
          .eq('user_id', webhookConfig.user_id)
          .eq('provider', 'google-calendar')
          .in('status', CONNECTED_STATUSES_LIST)
          .maybeSingle()

        if (integration) {
          integrationId = integration.id
        }
      }

      if (!integrationId) {
        logger.info('Google Calendar integration not found, watch may already be stopped')
        return
      }

      const { stopGoogleCalendarWatch } = await import('./google-calendar-watch-setup')
      await stopGoogleCalendarWatch(webhookConfig.user_id, integrationId, channelId, resourceId)

      logger.info('✅ Google Calendar watch stopped successfully')
    } catch (error) {
      logger.error('Failed to stop Google Calendar watch:', error)
      // Don't throw - watch might already be stopped
    }
  }

  /**
   * Unregister Google Drive webhook
   */
  private async unregisterGoogleDriveWebhook(webhookConfig: any): Promise<void> {
    try {
      let metadata: any = webhookConfig.metadata || {}
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata)
        } catch {
          metadata = {}
        }
      }

      const channelId = metadata.channelId || metadata.channel_id
      const resourceId = metadata.resourceId || metadata.resource_id
      let integrationId = metadata.integrationId || metadata.integration_id

      if (!channelId || !resourceId) {
        logger.info('Google Drive watch metadata missing, watch may already be stopped')
        return
      }

      if (!integrationId) {
        const { data: integration } = await this.supabase
          .from('integrations')
          .select('id')
          .eq('user_id', webhookConfig.user_id)
          .eq('provider', 'google-drive')
          .in('status', CONNECTED_STATUSES_LIST)
          .maybeSingle()

        if (integration) {
          integrationId = integration.id
        }
      }

      if (!integrationId) {
        logger.info('Google Drive integration not found, watch may already be stopped')
        return
      }

      const { stopGoogleDriveWatch } = await import('./google-drive-watch-setup')
      await stopGoogleDriveWatch(webhookConfig.user_id, integrationId, channelId, resourceId)

      logger.info('✅ Google Drive watch stopped successfully')
    } catch (error) {
      logger.error('Failed to stop Google Drive watch:', error)
      // Don't throw - watch might already be stopped
    }
  }

  /**
   * Unregister Airtable webhook
   */
  private async unregisterAirtableWebhook(webhookConfig: any): Promise<void> {
    try {
      const baseId = webhookConfig.metadata?.baseId || webhookConfig.config?.baseId
      if (!baseId) return

      const { unregisterAirtableWebhook } = await import('@/lib/integrations/airtable/webhooks')
      await unregisterAirtableWebhook(webhookConfig.user_id, baseId)

      logger.info('✅ Airtable webhook unregistered successfully')
    } catch (error) {
      logger.error('Failed to unregister Airtable webhook:', error)
      // Don't throw - continue with cleanup even if Airtable API fails
    }
  }

  /**
   * Unregister webhook from external service
   */
  private async unregisterFromExternalService(webhookConfig: any): Promise<void> {
    // Implementation depends on the external service
    switch (webhookConfig.provider_id) {
      case 'gmail':
        await this.unregisterGmailWebhook(webhookConfig)
        break

      case 'google-calendar':
        await this.unregisterGoogleCalendarWebhook(webhookConfig)
        break

      case 'google-drive':
      case 'google-docs':
        await this.unregisterGoogleDriveWebhook(webhookConfig)
        break

      case 'discord':
        await this.unregisterDiscordWebhook(webhookConfig)
        break

      case 'airtable':
        await this.unregisterAirtableWebhook(webhookConfig)
        break

      case 'trello':
        await this.unregisterTrelloWebhook(webhookConfig)
        break

      case 'dropbox':
        await this.unregisterDropboxWebhook(webhookConfig)
        break

      case 'onedrive':
        await this.unregisterOneDriveWebhook(webhookConfig)
        break

      case 'microsoft-outlook':
        await this.unregisterOutlookWebhook(webhookConfig)
        break

      case 'slack':
        await this.unregisterSlackWebhook(webhookConfig)
        break

      case 'github':
        await this.unregisterGithubWebhook(webhookConfig)
        break

      case 'microsoft-teams':
        await this.unregisterTeamsWebhook(webhookConfig)
        break

      case 'microsoft-onenote':
        await this.unregisterOneNoteWebhook(webhookConfig)
        break

      case 'google-sheets':
      case 'google_sheets': {
        try {
          const { stopGoogleSheetsWatch } = await import('./google-sheets-watch-setup')

          let metadata: any = webhookConfig.metadata || {}
          if (typeof metadata === 'string') {
            try {
              metadata = JSON.parse(metadata)
            } catch {
              metadata = {}
            }
          }

          const channelId: string | null = metadata?.channelId || metadata?.channel_id || null
          const resourceId: string | null = metadata?.resourceId || metadata?.resource_id || null
          let integrationId: string | null = metadata?.integrationId || metadata?.integration_id || null

          if (!integrationId && channelId) {
            try {
              const { data: subscription } = await this.supabase
                .from('google_watch_subscriptions')
                .select('integration_id')
                .eq('channel_id', channelId)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle()
              integrationId = subscription?.integration_id || null
            } catch {
              // ignore lookup errors
            }
          }

          if (channelId && resourceId && integrationId) {
            await stopGoogleSheetsWatch(
              webhookConfig.user_id,
              integrationId,
              channelId,
              resourceId
            )
          } else {
            logger.info('Skipping Google Sheets watch stop due to missing identifiers', {
              hasChannelId: Boolean(channelId),
              hasResourceId: Boolean(resourceId),
              hasIntegrationId: Boolean(integrationId)
            })
          }
        } catch (sheetsStopError) {
          logger.warn('Failed to stop Google Sheets watch during unregister:', sheetsStopError)
        }
        break
      }

      default:
        logger.info(`Unregistering webhook from ${webhookConfig.provider_id} not yet implemented`)
    }
  }

  private async unregisterDropboxWebhook(webhookConfig: any): Promise<void> {
    try {
      const cursorInfo = webhookConfig?.metadata?.cursor
      logger.info('🗑️ Clearing Dropbox webhook metadata', {
        webhookId: webhookConfig.id,
        hadCursor: Boolean(cursorInfo)
      })
      // No external API call is needed since Dropbox webhooks are configured at the app level.
      // We simply rely on removing the workflow webhook configuration record.
    } catch (error) {
      logger.warn('Failed to run Dropbox webhook cleanup:', error)
    }
  }

  private async unregisterOneDriveWebhook(webhookConfig: any): Promise<void> {
    try {
      let metadata: any = webhookConfig?.metadata || {}
      if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata) } catch { metadata = {} }
      }
      const subscriptionId: string | null = metadata?.subscriptionId || null
      if (!subscriptionId) {
        logger.info('Skipping OneDrive subscription delete: no subscriptionId on webhook metadata')
        return
      }

      // Lookup OneDrive integration to get an access token for deletion
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('*')
        .eq('user_id', webhookConfig.user_id)
        .eq('provider', 'onedrive')
        .in('status', CONNECTED_STATUSES_LIST)
        .maybeSingle()

      if (!integration) {
        logger.warn('Could not find OneDrive integration to delete subscription; leaving to expire', { subscriptionId })
        return
      }

      // Decrypt the access token
      const accessToken: string | null = integration?.access_token
        ? safeDecrypt(integration.access_token)
        : null

      if (!accessToken) {
        logger.warn('Could not decrypt OneDrive access token to delete subscription; leaving to expire', { subscriptionId })
        return
      }

      const { MicrosoftGraphSubscriptionManager } = await import('@/lib/microsoft-graph/subscriptionManager')
      const mgr = new MicrosoftGraphSubscriptionManager()
      await mgr.deleteSubscription(subscriptionId, accessToken)
      logger.info('✅ OneDrive subscription deleted', { subscriptionId })
    } catch (error) {
      logger.warn('Failed to unregister OneDrive subscription (will expire automatically):', error)
    }
  }

  /**
   * Unregister Microsoft Outlook webhook
   */
  private async unregisterOutlookWebhook(webhookConfig: any): Promise<void> {
    try {
      const subscriptionId = webhookConfig.external_id || webhookConfig.metadata?.subscriptionId
      if (!subscriptionId) {
        logger.warn('No Outlook subscription ID to delete')
        return
      }

      const integration = await this.supabase
        .from('integrations')
        .select('access_token')
        .eq('user_id', webhookConfig.user_id)
        .eq('provider', 'microsoft-outlook')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      const accessToken = integration?.data?.access_token
        ? safeDecrypt(integration.data.access_token)
        : null
      if (!accessToken) {
        logger.warn('Could not decrypt Outlook access token to delete subscription; leaving to expire', { subscriptionId })
        return
      }

      const { MicrosoftGraphSubscriptionManager } = await import('@/lib/microsoft-graph/subscriptionManager')
      const mgr = new MicrosoftGraphSubscriptionManager()
      await mgr.deleteSubscription(subscriptionId, accessToken)
      logger.info('✅ Outlook subscription deleted', { subscriptionId })
    } catch (error) {
      logger.warn('Failed to unregister Outlook subscription (will expire automatically):', error)
    }
  }

  /**
   * Unregister Slack webhook
   */
  private async unregisterSlackWebhook(webhookConfig: any): Promise<void> {
    try {
      // Slack Event Subscriptions are configured at the app level
      // We just remove our configuration metadata
      logger.info('🗑️ Clearing Slack event subscription configuration')
      // The webhook_configs entry will be deleted by the calling function
      logger.info('✅ Slack event subscription configuration cleared')
    } catch (error) {
      logger.warn('Failed to unregister Slack webhook:', error)
    }
  }

  /**
   * Unregister GitHub webhook
   */
  private async unregisterGithubWebhook(webhookConfig: any): Promise<void> {
    try {
      const githubWebhookId = webhookConfig.external_id || webhookConfig.metadata?.githubWebhookId
      const repository = webhookConfig.metadata?.repository
      const owner = webhookConfig.metadata?.owner
      const repo = webhookConfig.metadata?.repo

      if (!githubWebhookId || !owner || !repo) {
        logger.info('GitHub webhook metadata missing, webhook may already be deleted')
        return
      }

      // Get GitHub integration for access token
      const { data: integration } = await this.supabase
        .from('integrations')
        .select('access_token')
        .eq('user_id', webhookConfig.user_id)
        .eq('provider', 'github')
        .in('status', CONNECTED_STATUSES_LIST)
        .maybeSingle()

      if (!integration) {
        logger.info('GitHub integration not found, webhook may already be deleted')
        return
      }

      const accessToken = integration.access_token ? safeDecrypt(integration.access_token) : null
      if (!accessToken) {
        logger.info('GitHub access token missing, cannot delete webhook')
        return
      }

      // Delete webhook via GitHub API
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/hooks/${githubWebhookId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        }
      )

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text()
        logger.warn('Failed to delete GitHub webhook:', errorText)
      } else {
        logger.info('✅ GitHub webhook deleted successfully', { repository, webhookId: githubWebhookId })
      }
    } catch (error) {
      logger.error('Failed to unregister GitHub webhook:', error)
      // Don't throw - webhook might already be deleted
    }
  }

  /**
   * Unregister Microsoft Teams webhook
   */
  private async unregisterTeamsWebhook(webhookConfig: any): Promise<void> {
    try {
      const subscriptionId = webhookConfig.external_id || webhookConfig.metadata?.subscriptionId
      if (!subscriptionId) {
        logger.warn('No Teams subscription ID to delete')
        return
      }

      const integration = await this.supabase
        .from('integrations')
        .select('access_token')
        .eq('user_id', webhookConfig.user_id)
        .eq('provider', 'microsoft-teams')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      const accessToken = integration?.data?.access_token
        ? safeDecrypt(integration.data.access_token)
        : null
      if (!accessToken) {
        logger.warn('Could not decrypt Teams access token to delete subscription; leaving to expire', { subscriptionId })
        return
      }

      const { MicrosoftGraphSubscriptionManager } = await import('@/lib/microsoft-graph/subscriptionManager')
      const mgr = new MicrosoftGraphSubscriptionManager()
      await mgr.deleteSubscription(subscriptionId, accessToken)
      logger.info('✅ Teams subscription deleted', { subscriptionId })
    } catch (error) {
      logger.warn('Failed to unregister Teams subscription (will expire automatically):', error)
    }
  }

  /**
   * Unregister Microsoft OneNote webhook
   */
  private async unregisterOneNoteWebhook(webhookConfig: any): Promise<void> {
    try {
      const subscriptionId = webhookConfig.external_id || webhookConfig.metadata?.subscriptionId
      if (!subscriptionId) {
        logger.warn('No OneNote subscription ID to delete')
        return
      }

      const integration = await this.supabase
        .from('integrations')
        .select('access_token')
        .eq('user_id', webhookConfig.user_id)
        .eq('provider', 'microsoft-onenote')
        .in('status', CONNECTED_STATUSES_LIST)
        .single()

      const accessToken = integration?.data?.access_token
        ? safeDecrypt(integration.data.access_token)
        : null
      if (!accessToken) {
        logger.warn('Could not decrypt OneNote access token to delete subscription; leaving to expire', { subscriptionId })
        return
      }

      const { MicrosoftGraphSubscriptionManager } = await import('@/lib/microsoft-graph/subscriptionManager')
      const mgr = new MicrosoftGraphSubscriptionManager()
      await mgr.deleteSubscription(subscriptionId, accessToken)
      logger.info('✅ OneNote subscription deleted', { subscriptionId })
    } catch (error) {
      logger.warn('Failed to unregister OneNote subscription (will expire automatically):', error)
    }
  }

  /**
   * Validate webhook signature
   */
  private validateSignature(payload: any, headers: any, secret: string): boolean {
    // Implementation would depend on the service's signature method
    // For now, return true (implement proper validation for production)
    return true
  }

  private normalizeDropboxPath(rawPath?: string | null): string {
    if (!rawPath || rawPath === '/' || rawPath === 'root') {
      return ''
    }

    const trimmed = rawPath.trim()
    if (!trimmed) {
      return ''
    }

    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`
    return normalized === '/' ? '' : normalized
  }

  /**
   * Generate webhook secret
   */
  private generateWebhookSecret(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }

  /**
   * Log webhook execution
   */
  private async logWebhookExecution(webhookConfig: any, payload: any, headers: any): Promise<string> {
    const { data, error } = await this.supabase
      .from('webhook_executions')
      .insert({
        webhook_id: webhookConfig.id,
        workflow_id: webhookConfig.workflow_id,
        user_id: webhookConfig.user_id,
        trigger_type: webhookConfig.trigger_type,
        provider_id: webhookConfig.provider_id,
        payload: payload,
        headers: headers,
        status: 'success',
        execution_time_ms: 0
      })
      .select()
      .single()

    if (error) throw error
    return data.id
  }

  /**
   * Log webhook error
   */
  private async logWebhookError(webhookId: string, error: any): Promise<void> {
    await this.supabase
      .from('webhook_executions')
      .insert({
        webhook_id: webhookId,
        trigger_type: 'error',
        provider_id: 'system',
        payload: {},
        status: 'error',
        error_message: error.message
      })
  }

  /**
   * Execute workflow
   */
  private async executeWorkflow(workflowId: string, payload: any, executionId: string): Promise<void> {
    // This would trigger the workflow execution engine
    // For now, we'll make a call to the execution API
    try {
      const response = await fetch(`/api/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          triggerData: payload,
          executionId: executionId,
          source: 'webhook'
        })
      })

      if (!response.ok) {
        throw new Error(`Workflow execution failed: ${response.statusText}`)
      }
    } catch (error) {
      logger.error('Error executing workflow:', error)
      throw error
    }
  }

  /**
   * Get webhook URL for a workflow
   */
  getWebhookUrl(workflowId: string, providerId?: string): string {
    const baseUrl = getWebhookBaseUrl()
    if (providerId) {
      return `${baseUrl}/api/webhooks/${providerId}`
    }
    return `${baseUrl}/api/webhooks/${workflowId}`
  }

  /**
   * Get webhook configurations for a user
   */
  async getUserWebhooks(userId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('webhook_configs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  }

  /**
   * Get webhook executions for a webhook
   */
  async getWebhookExecutions(webhookId: string, limit: number = 50): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('webhook_executions')
      .select('*')
      .eq('webhook_id', webhookId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return data || []
  }
} 
