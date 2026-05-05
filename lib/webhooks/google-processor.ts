import { createSupabaseServiceClient } from '@/utils/supabase/server'
import { AdvancedExecutionEngine } from '@/lib/execution/advancedExecutionEngine'
import { executeWebhookWorkflow } from '@/lib/webhooks/execute'
import { google } from 'googleapis'
import { getDecryptedAccessToken } from '@/lib/workflows/actions/core/getDecryptedAccessToken'

import { logger } from '@/lib/utils/logger'

type ProcessedCalendarEventEntry = {
  processedAt: number
  lastUpdated?: number | null
}

const processedCalendarEvents = new Map<string, ProcessedCalendarEventEntry>()
const processedDriveChanges = new Map<string, ProcessedCalendarEventEntry>()
type ProcessedSheetChangeEntry = {
  processedAt: number
  lastUpdated?: number | null
  lastSignature?: string | null
}

const processedSheetsChanges = new Map<string, ProcessedSheetChangeEntry>()
const CALENDAR_DEDUPE_WINDOW_MS = 5 * 60 * 1000
// Dedupe noisy Drive push deliveries
const lastDriveMessageNumber = new Map<string, number>() // key: channelId → last message number
const lastDrivePageTokenProcessed = new Map<string, string>() // key: channelId → last page token

const isCalendarDebugEnabled =
  process.env.DEBUG_GOOGLE_CALENDAR === '1' || process.env.DEBUG_GOOGLE_CALENDAR === 'true'

function calendarDebug(message: string, payload?: any) {
  if (!isCalendarDebugEnabled) return
  try {
    if (payload !== undefined) {
      logger.info(`[Google Calendar] ${message}`, payload)
    } else {
      logger.info(`[Google Calendar] ${message}`)
    }
  } catch {
    logger.info(`[Google Calendar] ${message}`)
  }
}

function calendarInfo(message: string, payload?: any) {
  try {
    if (payload !== undefined) {
      logger.info(`[Google Calendar] ${message}`, payload)
    } else {
      logger.info(`[Google Calendar] ${message}`)
    }
  } catch {
    logger.info(`[Google Calendar] ${message}`)
  }
}

function buildCalendarDedupeKey(workflowId: string, eventId: string, changeType: string) {
  return `${workflowId}-${eventId}-${changeType}`
}

function buildDriveDedupeKey(workflowId: string, resourceId: string, changeType: string) {
  return `${workflowId}-${resourceId}-${changeType}`
}

function buildSheetsDedupeKey(
  workflowId: string,
  spreadsheetId: string | null,
  sheetName: string | null,
  identifier: string
) {
  return [
    workflowId,
    spreadsheetId || 'unknown-spreadsheet',
    sheetName || 'all-sheets',
    identifier
  ].join(':')
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value || typeof value !== 'string') return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.getTime()
}

function wasRecentlyProcessedDriveChange(
  workflowId: string,
  resourceId: string,
  changeType: string,
  updatedAt?: string | null
): boolean {
  const key = buildDriveDedupeKey(workflowId, resourceId, changeType)
  const entry = processedDriveChanges.get(key)
  if (!entry) return false

  const incomingUpdated = toTimestamp(updatedAt)

  if (incomingUpdated !== null) {
    if (entry.lastUpdated !== undefined && entry.lastUpdated !== null) {
      if (incomingUpdated <= entry.lastUpdated) {
        return true
      }
    }
    return false
  }

  if (Date.now() - entry.processedAt < CALENDAR_DEDUPE_WINDOW_MS) {
    return true
  }

  processedDriveChanges.delete(key)
  return false
}

function markDriveChangeProcessed(
  workflowId: string,
  resourceId: string,
  changeType: string,
  updatedAt?: string | null
) {
  const key = buildDriveDedupeKey(workflowId, resourceId, changeType)
  const incomingUpdated = toTimestamp(updatedAt)
  processedDriveChanges.set(key, {
    processedAt: Date.now(),
    lastUpdated: incomingUpdated
  })

  if (processedDriveChanges.size > 1000) {
    const now = Date.now()
    for (const [k, timestamp] of processedDriveChanges.entries()) {
      if (now - timestamp.processedAt > CALENDAR_DEDUPE_WINDOW_MS) {
        processedDriveChanges.delete(k)
      }
    }
  }
}

function wasRecentlyProcessedSheetsChange(
  key: string,
  updatedAt?: string | null,
  signature?: string | null
): boolean {
  const entry = processedSheetsChanges.get(key)
  if (!entry) return false

  if (entry.lastSignature !== undefined && entry.lastSignature !== null) {
    if (signature !== undefined && signature !== null && signature === entry.lastSignature) {
      if (Date.now() - entry.processedAt < CALENDAR_DEDUPE_WINDOW_MS) {
        logger.info('[Google Sheets] Dedupe hit (signature)', { key })
        return true
      }
    }
  }

  const incomingUpdated = toTimestamp(updatedAt)

  if (incomingUpdated !== null) {
    if (entry.lastUpdated !== undefined && entry.lastUpdated !== null) {
      if (incomingUpdated <= entry.lastUpdated) {
        logger.info('[Google Sheets] Dedupe hit (timestamp)', { key })
        return true
      }
    }
    return false
  }

  if (Date.now() - entry.processedAt < CALENDAR_DEDUPE_WINDOW_MS) {
    logger.info('[Google Sheets] Dedupe hit (window)', { key })
    return true
  }

  processedSheetsChanges.delete(key)
  return false
}

function markSheetsChangeProcessed(key: string, updatedAt?: string | null, signature?: string | null) {
  const incomingUpdated = toTimestamp(updatedAt)
  processedSheetsChanges.set(key, {
    processedAt: Date.now(),
    lastUpdated: incomingUpdated,
    lastSignature: signature ?? null
  })
  logger.info('[Google Sheets] Dedupe record stored', { key, signature })

  if (processedSheetsChanges.size > 1000) {
    const now = Date.now()
    for (const [k, timestamp] of processedSheetsChanges.entries()) {
      if (now - timestamp.processedAt > CALENDAR_DEDUPE_WINDOW_MS) {
        processedSheetsChanges.delete(k)
      }
    }
  }
}

function wasRecentlyProcessedCalendarEvent(
  workflowId: string,
  eventId: string,
  changeType: string,
  updatedAt?: string | null
): boolean {
  const key = buildCalendarDedupeKey(workflowId, eventId, changeType)
  const entry = processedCalendarEvents.get(key)
  if (!entry) return false

  const incomingUpdated = toTimestamp(updatedAt)

  if (incomingUpdated !== null) {
    if (entry.lastUpdated !== undefined && entry.lastUpdated !== null) {
      if (incomingUpdated <= entry.lastUpdated) {
        return true
      }
    }
    // Newer updated timestamp – treat as fresh change
    return false
  }

  if (Date.now() - entry.processedAt < CALENDAR_DEDUPE_WINDOW_MS) {
    return true
  }

  processedCalendarEvents.delete(key)
  return false
}

function markCalendarEventProcessed(
  workflowId: string,
  eventId: string,
  changeType: string,
  updatedAt?: string | null
) {
  const key = buildCalendarDedupeKey(workflowId, eventId, changeType)
  const incomingUpdated = toTimestamp(updatedAt)
  processedCalendarEvents.set(key, {
    processedAt: Date.now(),
    lastUpdated: incomingUpdated
  })

  if (processedCalendarEvents.size > 1000) {
    const now = Date.now()
    for (const [k, timestamp] of processedCalendarEvents.entries()) {
      if (now - timestamp.processedAt > CALENDAR_DEDUPE_WINDOW_MS) {
        processedCalendarEvents.delete(k)
      }
    }
  }
}

export interface GoogleWebhookEvent {
  service: string
  eventData: any
  requestId: string
}

async function processGmailEvent(event: GoogleWebhookEvent, metadata: any): Promise<any> {
  const { eventData } = event

  logger.info('[Gmail] Webhook notification received', {
    emailAddress: eventData.emailAddress,
    historyId: eventData.historyId
  })

  // Gmail Pub/Sub notification contains emailAddress and historyId
  // We need to find active test sessions or workflows waiting for this

  const supabase = await createSupabaseServiceClient()

  // Find active test sessions for Gmail triggers
  // Use LEFT join (no !inner) so we can also find test sessions for UNSAVED workflows
  // Unsaved workflows won't have a record in the workflows table, but they store
  // workflow data in test_mode_config
  const { data: testSessions, error: sessionError } = await supabase
    .from('workflow_test_sessions')
    .select('*, workflows(id, user_id, name)')
    .eq('trigger_type', 'gmail_trigger_new_email')
    .in('status', ['listening'])

  if (sessionError) {
    logger.error('[Gmail] Failed to fetch test sessions:', sessionError)
  }

  logger.info('[Gmail] Found test sessions', {
    count: testSessions?.length || 0
  })

  if (!testSessions || testSessions.length === 0) {
    logger.info('[Gmail] No active test sessions waiting for Gmail trigger')
    return { processed: true, eventType: 'gmail.notification', testSessions: 0 }
  }

  // Process each test session
  for (const session of testSessions) {
    try {
      // For SAVED workflows, use the joined workflows data
      // For UNSAVED workflows, use test_mode_config which contains the workflow data
      const savedWorkflow = session.workflows
      const testModeConfig = session.test_mode_config as any

      // Determine workflow data source
      let workflowId: string
      let userId: string
      let workflowNodes: any[]
      let workflowConnections: any[]
      let workflowName: string

      if (savedWorkflow) {
        // Saved workflow - load nodes/edges from normalized tables
        workflowId = savedWorkflow.id
        userId = savedWorkflow.user_id
        workflowName = savedWorkflow.name

        // Load from normalized tables
        const [nodesResult, edgesResult] = await Promise.all([
          supabase.from('workflow_nodes').select('*').eq('workflow_id', workflowId).order('display_order'),
          supabase.from('workflow_edges').select('*').eq('workflow_id', workflowId)
        ])

        workflowNodes = (nodesResult.data || []).map((node: any) => ({
          id: node.id,
          type: node.node_type,
          data: {
            type: node.node_type,
            label: node.label || node.node_type,
            config: node.config || {},
            isTrigger: node.is_trigger,
          },
          position: { x: node.position_x, y: node.position_y }
        }))
        workflowConnections = (edgesResult.data || []).map((edge: any) => ({
          id: edge.id,
          source: edge.source_node_id,
          target: edge.target_node_id,
          sourceHandle: edge.source_port_id || 'source',
          targetHandle: edge.target_port_id || 'target'
        }))

        logger.info('[Gmail] Using saved workflow data', { workflowId, workflowName })
      } else if (testModeConfig?.nodes && testModeConfig?.triggerNode) {
        // Unsaved workflow - use test_mode_config
        workflowId = session.workflow_id
        userId = session.user_id
        workflowNodes = testModeConfig.nodes
        workflowConnections = testModeConfig.connections || []
        workflowName = testModeConfig.workflowName || 'Unsaved Workflow'
        logger.info('[Gmail] Using unsaved workflow data from test_mode_config', {
          workflowId,
          workflowName,
          nodeCount: workflowNodes.length
        })
      } else {
        logger.warn(`[Gmail] No workflow data available for test session ${session.id}`)
        continue
      }

      logger.info('[Gmail] Starting workflow execution for test session', {
        sessionId: session.id,
        workflowId,
        workflowName,
        isUnsavedWorkflow: !savedWorkflow
      })

      // Fetch actual email content before executing workflow
      let emailDetails = null
      try {
        const accessToken = await getDecryptedAccessToken(userId, 'gmail')
        if (accessToken) {
          // Get the stored historyId from when the watch was created
          // Gmail history API returns changes AFTER the startHistoryId
          let triggerResource = null
          const { data: testTriggerResource } = await supabase
            .from('trigger_resources')
            .select('config')
            .eq('workflow_id', workflowId)
            .eq('trigger_type', 'gmail_trigger_new_email')
            .eq('test_session_id', session.id)
            .eq('status', 'active')
            .maybeSingle()

          if (testTriggerResource) {
            triggerResource = testTriggerResource
          } else {
            // Fallback: get most recent trigger_resource
            const { data: fallbackResource } = await supabase
              .from('trigger_resources')
              .select('config')
              .eq('workflow_id', workflowId)
              .eq('trigger_type', 'gmail_trigger_new_email')
              .eq('status', 'active')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            triggerResource = fallbackResource
          }

          const storedHistoryId = triggerResource?.config?.resourceId
          const historyIdToUse = storedHistoryId || eventData.historyId

          logger.info('[Gmail] Fetching email details', {
            storedHistoryId,
            notificationHistoryId: eventData.historyId,
            usingHistoryId: historyIdToUse
          })

          const oauth2Client = new google.auth.OAuth2()
          oauth2Client.setCredentials({ access_token: accessToken })
          const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

          // Fetch history to find new messages
          const history = await gmail.users.history.list({
            userId: 'me',
            historyTypes: ['messageAdded'],
            startHistoryId: String(historyIdToUse)
          })

          if (history.data.history && history.data.history.length > 0) {
            const messageId = history.data.history
              ?.flatMap(entry => entry.messagesAdded || entry.messages || [])
              ?.map(entry => (entry as any).message || entry)
              ?.find((msg: any) => msg?.id)?.id

            if (messageId) {
              const message = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full'
              })

              const headers = message.data.payload?.headers || []
              emailDetails = {
                id: message.data.id,
                messageId: message.data.id,
                threadId: message.data.threadId,
                labelIds: message.data.labelIds,
                snippet: message.data.snippet,
                from: '',
                to: '',
                subject: '',
                date: '',
                body: '',
                hasAttachments: false
              }

              headers.forEach((header: any) => {
                const name = header.name.toLowerCase()
                if (name === 'from') emailDetails!.from = header.value
                if (name === 'to') emailDetails!.to = header.value
                if (name === 'subject') emailDetails!.subject = header.value
                if (name === 'date') emailDetails!.date = header.value
              })

              // Extract body
              let body = ''
              if (message.data.payload?.parts) {
                for (const part of message.data.payload.parts) {
                  if (part.mimeType === 'text/plain' && part.body?.data) {
                    body += Buffer.from(part.body.data, 'base64').toString('utf-8')
                  }
                }
                emailDetails.hasAttachments = message.data.payload.parts.some(
                  (part: any) => part.filename && part.filename.length > 0
                )
              } else if (message.data.payload?.body?.data) {
                body = Buffer.from(message.data.payload.body.data, 'base64').toString('utf-8')
              }
              emailDetails.body = body

              logger.info('[Gmail] Email details fetched successfully', {
                hasFrom: !!emailDetails.from,
                subjectLength: emailDetails.subject?.length || 0,
                bodyLength: emailDetails.body?.length || 0
              })
            }
          }
        }
      } catch (fetchError) {
        logger.error('[Gmail] Failed to fetch email details:', fetchError)
      }

      // Build flattened trigger data for variable resolution
      const flattenedEmailData = emailDetails || {
        from: eventData.emailAddress,
        subject: 'New Email',
        body: '',
        to: '',
        date: new Date().toISOString(),
        hasAttachments: false
      }

      // Build the trigger data that will be passed to the workflow
      const triggerData = {
        provider: 'gmail',
        emailAddress: eventData.emailAddress,
        historyId: eventData.historyId,
        timestamp: new Date().toISOString(),
        trigger: {
          type: 'gmail_trigger_new_email',
          from: flattenedEmailData.from,
          subject: flattenedEmailData.subject,
          body: flattenedEmailData.body,
          to: flattenedEmailData.to,
          date: flattenedEmailData.date,
          hasAttachments: flattenedEmailData.hasAttachments,
          data: flattenedEmailData
        },
        emailDetails
      }

      // For test sessions, DON'T execute the workflow here.
      // Instead, just store the trigger data and let the frontend handle execution
      // via the SSE endpoint for real-time updates.
      // Update test session with trigger data (status='trigger_received')
      await supabase
        .from('workflow_test_sessions')
        .update({
          status: 'trigger_received',
          trigger_data: triggerData
        })
        .eq('id', session.id)

      logger.info('[Gmail] Test session trigger data stored (execution deferred to frontend SSE)', {
        sessionId: session.id,
        workflowId,
        hasEmailDetails: !!emailDetails
      })

    } catch (workflowError) {
      logger.error(`[Gmail] Failed to execute workflow for session ${session.id}:`, workflowError)
    }
  }

  return { processed: true, eventType: 'gmail.notification', testSessions: testSessions.length }
}

export async function processGoogleEvent(event: GoogleWebhookEvent): Promise<any> {
  try {
    const supabase = await createSupabaseServiceClient()

    // Store the webhook event in the database
    const { data: storedEvent, error: storeError } = await supabase
      .from('webhook_events')
      .insert({
        provider: 'google',
        service: event.service,
        event_data: event.eventData,
        request_id: event.requestId,
        status: 'received',
        timestamp: new Date().toISOString()
      })
      .select()
      .single()

    if (storeError) {
      logger.error('Failed to store Google webhook event:', storeError)
    }

    // Extract token metadata if present (contains userId, integrationId, etc.)
    let metadata: any = {}
    if (event.eventData.token) {
      try {
        metadata = JSON.parse(event.eventData.token)
      } catch (e) {
        logger.info('Could not parse token metadata')
      }
    }

    // Process based on service
    console.log(`[Google Webhook] Routing to service: ${event.service}, hasMetadata: userId=${metadata?.userId ? 'yes' : 'no'}, integrationId=${metadata?.integrationId ? 'yes' : 'no'}`)
    switch (event.service) {
      case 'gmail':
        return await processGmailEvent(event, metadata)
      case 'drive':
        return await processGoogleDriveEvent(event, metadata)
      case 'calendar':
        return await processGoogleCalendarEvent(event, metadata)
      case 'docs':
        return await processGoogleDocsEvent(event, metadata)
      case 'sheets':
        return await processGoogleSheetsEvent(event, metadata)
      default:
        return await processGenericGoogleEvent(event)
    }
  } catch (error) {
    console.error('[Google Webhook] Error processing event:', error)
    logger.error('Error processing Google webhook event:', error)
    throw error
  }
}

async function processGoogleDriveEvent(event: GoogleWebhookEvent, metadata: any): Promise<any> {

  // Fallback: if token metadata missing, look up subscription by channelId
  if (!metadata.userId || !metadata.integrationId) {
    try {
      const channelId: string | null = (event.eventData?.channelId) 
        || (event.eventData?.headers?.['x-goog-channel-id'])
        || null
      if (channelId) {
        logger.info('[Google Drive] Webhook received', {
          channelId,
          hasToken: Boolean(event.eventData?.token)
        })
        // Dedupe by message number if provided
        const msgRaw = event.eventData?.headers?.['x-goog-message-number']
        const msgNum = typeof msgRaw === 'string' ? Number(msgRaw) : NaN
        if (!Number.isNaN(msgNum)) {
          const lastNum = lastDriveMessageNumber.get(channelId)
          if (lastNum !== undefined && msgNum <= lastNum) {
            return { processed: true, deduped: true, reason: 'messageNumber' }
          }
          lastDriveMessageNumber.set(channelId, msgNum)
        }
        const supabaseLookup = await createSupabaseServiceClient()
        const { data: sub } = await supabaseLookup
          .from('google_watch_subscriptions')
          .select('user_id, integration_id, provider, page_token, updated_at')
          .eq('channel_id', channelId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (sub) {
          metadata = {
            ...metadata,
            userId: sub.user_id,
            integrationId: sub.integration_id,
            provider: sub.provider || metadata?.provider,
            contextProvider: sub.provider || metadata?.contextProvider
          }
          logger.info('[Google Drive] Subscription metadata resolved from channel', {
            userId: metadata.userId,
            integrationId: metadata.integrationId
          })
        }

        // Fallback: try trigger_resources table (modern lifecycle stores subscriptions here)
        if (!sub) {
          const { data: triggerResource } = await supabaseLookup
            .from('trigger_resources')
            .select('user_id, provider_id, config')
            .eq('external_id', channelId)
            .eq('status', 'active')
            .maybeSingle()

          if (triggerResource) {
            metadata = {
              ...metadata,
              userId: triggerResource.user_id,
              integrationId: triggerResource.config?.integrationId,
              provider: triggerResource.provider_id || metadata?.provider,
              contextProvider: triggerResource.provider_id || metadata?.contextProvider
            }
            logger.info('[Google Drive] Subscription metadata resolved from trigger_resources', {
              userId: metadata.userId,
              integrationId: metadata.integrationId
            })
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (!metadata.userId || !metadata.integrationId) {
    logger.info('Google Drive webhook received, but missing metadata for processing', {
      hasUserId: Boolean(metadata?.userId),
      hasIntegrationId: Boolean(metadata?.integrationId)
    })
    return { processed: true, eventType: 'drive.notification' }
  }

  // Skip sync notifications - these are initial handshakes sent immediately after files.watch()
  // Processing them pollutes the in-memory dedup Map and wastes a changes.list call
  const resourceState = event.eventData?.resourceState
    || event.eventData?.headers?.['x-goog-resource-state']
  console.log(`[Google Drive] Processing webhook: resourceState=${resourceState}, userId=${metadata.userId}, channelId=${event.eventData?.channelId || event.eventData?.headers?.['x-goog-channel-id']}`)
  if (resourceState === 'sync') {
    console.log('[Google Drive] Sync notification acknowledged (initial handshake)')
    return { processed: true, eventType: 'drive.sync' }
  }

  const { getGoogleDriveChanges } = await import('./google-drive-watch-setup')
  const supabase = await createSupabaseServiceClient()
  const providerContext: string | null = metadata?.provider || metadata?.contextProvider || null
  const isSheetsWatch = providerContext === 'google-sheets'
  const subscriptionProviderFilter = isSheetsWatch ? 'google-sheets' : 'google-drive'

  // Subscription lookup: try trigger_resources FIRST (modern), then legacy google_watch_subscriptions
  let subscription: any = null
  let subscriptionSource: 'google_watch_subscriptions' | 'trigger_resources' | 'none' = 'none'
  const channelId: string | null = (event.eventData?.channelId)
    || (event.eventData?.headers?.['x-goog-channel-id'])
    || null
  let subscriptionMetadata: any = null

  // Step 1: Try trigger_resources FIRST (modern source of truth, channel-scoped)
  console.log(`[Google Drive] Subscription lookup: channelId=${channelId}, isSheetsWatch=${isSheetsWatch}`)
  if (channelId) {
    const providerFilter = isSheetsWatch ? 'google-sheets' : 'google-drive'
    const { data: triggerResource, error: trError } = await supabase
      .from('trigger_resources')
      .select('id, config, updated_at')
      .eq('provider_id', providerFilter)
      .eq('external_id', channelId)
      .eq('status', 'active')
      .maybeSingle()

    if (trError) {
      console.log(`[Google Drive] trigger_resources query error:`, trError.message)
    }

    if (triggerResource?.config) {
      subscription = {
        page_token: triggerResource.config?.pageToken,
        updated_at: triggerResource.updated_at,
        metadata: triggerResource.config
      }
      subscriptionSource = 'trigger_resources'
      subscriptionMetadata = triggerResource.config
      console.log(`[Google Drive] Subscription found in trigger_resources, hasPageToken=${!!subscription.page_token}`)
    } else {
      console.log(`[Google Drive] No subscription in trigger_resources for channelId=${channelId}`)
    }
  }

  // Step 2: Fall back to google_watch_subscriptions by channel_id (legacy, channel-scoped)
  if (!subscription && channelId) {
    const { data: byChannel } = await supabase
      .from('google_watch_subscriptions')
      .select('page_token, updated_at, provider, metadata')
      .eq('channel_id', channelId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    subscription = byChannel
    if (byChannel) {
      subscriptionSource = 'google_watch_subscriptions'
    }
    if (byChannel?.provider && !metadata?.provider) {
      metadata = {
        ...metadata,
        provider: byChannel.provider,
        contextProvider: byChannel.provider
      }
    }
    if (byChannel?.metadata) {
      if (typeof byChannel.metadata === 'object') {
        subscriptionMetadata = byChannel.metadata
      } else {
        try {
          subscriptionMetadata = JSON.parse(byChannel.metadata)
        } catch {
          subscriptionMetadata = null
        }
      }
    }
  }

  // Step 3: Fall back to google_watch_subscriptions by user+integration (legacy, broad)
  if (!subscription) {
    const { data: latest } = await supabase
      .from('google_watch_subscriptions')
      .select('page_token, updated_at, channel_id, metadata')
      .eq('user_id', metadata.userId)
      .eq('integration_id', metadata.integrationId)
      .eq('provider', subscriptionProviderFilter)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    subscription = latest
    if (latest) {
      subscriptionSource = 'google_watch_subscriptions'
    }
    if (latest?.metadata) {
      if (typeof latest.metadata === 'object') {
        subscriptionMetadata = latest.metadata
      } else {
        try {
          subscriptionMetadata = JSON.parse(latest.metadata)
        } catch {
          subscriptionMetadata = null
        }
      }
    }
  }

  if (isSheetsWatch) {
    const mergedMetadata: Record<string, any> = { ...metadata }

    const normalizedSubscriptionMeta = subscriptionMetadata && typeof subscriptionMetadata === 'object'
      ? subscriptionMetadata
      : {}

    if (normalizedSubscriptionMeta) {
      for (const [key, value] of Object.entries(normalizedSubscriptionMeta)) {
        const existing = mergedMetadata[key]
        if ((existing === undefined || existing === null) && value !== undefined && value !== null) {
          mergedMetadata[key] = value
        }
      }
    }

    const normalizedSpreadsheetId = mergedMetadata.spreadsheetId
      || mergedMetadata.spreadsheet_id
      || normalizedSubscriptionMeta?.spreadsheetId
      || normalizedSubscriptionMeta?.spreadsheet_id
      || null

    const normalizedSheetName = mergedMetadata.sheetName
      || mergedMetadata.sheet_name
      || normalizedSubscriptionMeta?.sheetName
      || normalizedSubscriptionMeta?.sheet_name
      || null

    const normalizedSheetId = mergedMetadata.sheetId
      || mergedMetadata.sheet_id
      || normalizedSubscriptionMeta?.sheetId
      || normalizedSubscriptionMeta?.sheet_id
      || null

    const normalizedTriggerType = mergedMetadata.triggerType
      || mergedMetadata.trigger_type
      || normalizedSubscriptionMeta?.triggerType
      || normalizedSubscriptionMeta?.trigger_type
      || 'new_row'

    mergedMetadata.spreadsheetId = normalizedSpreadsheetId
    mergedMetadata.sheetName = normalizedSheetName
    mergedMetadata.sheetId = normalizedSheetId
    mergedMetadata.triggerType = normalizedTriggerType

    metadata = mergedMetadata

    logger.info('[Google Sheets] Normalized metadata', {
      userId: metadata.userId,
      integrationId: metadata.integrationId,
      spreadsheetId: metadata.spreadsheetId,
      sheetName: metadata.sheetName,
      triggerType: metadata.triggerType
    })
  }

  // If this delivery belongs to an older channel than the latest, ignore it
  // Skip this check when subscription came from trigger_resources (modern source of truth)
  if (channelId && subscriptionSource !== 'trigger_resources') {
    const { data: latestForOwner } = await supabase
      .from('google_watch_subscriptions')
      .select('channel_id, updated_at')
      .eq('user_id', metadata.userId)
      .eq('integration_id', metadata.integrationId)
      .eq('provider', subscriptionProviderFilter)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestForOwner?.channel_id && latestForOwner.channel_id !== channelId) {
      logger.info('[Google Drive] Ignoring stale channel delivery', { channelId, latestChannel: latestForOwner.channel_id })
      return { processed: true, ignored: true, reason: 'stale_channel' }
    }
  }

  if (isSheetsWatch) {
    try {
      const sheetsEvent: GoogleWebhookEvent = {
        service: 'sheets',
        eventData: event.eventData,
        requestId: event.requestId
      }
      return await processGoogleSheetsEvent(sheetsEvent, metadata)
    } catch (sheetsError) {
      logger.error('[Google Sheets] Failed to process Sheets change via Drive handler:', sheetsError)
      throw sheetsError
    }
  }

  if (!subscription?.page_token) {
    console.log(`[Google Drive] No page token found, subscriptionSource=${subscriptionSource}, skipping change fetch`)
    logger.info('Google Drive subscription missing page token, skipping change fetch', {
      userId: metadata.userId,
      integrationId: metadata.integrationId
    })
    return { processed: true, eventType: 'drive.notification' }
  }

  if (channelId) {
    const lastToken = lastDrivePageTokenProcessed.get(channelId)
    if (lastToken && lastToken === subscription.page_token) {
      console.log(`[Google Drive] Dedup: same page token as last processed, skipping`)
      return { processed: true, ignored: true, reason: 'duplicate_page_token' }
    }
    // Don't set here - set AFTER processing with the NEW token to avoid
    // incorrectly deduping the first real event after a sync notification
  }
  console.log(`[Google Drive] Fetching changes with pageToken, subscriptionSource=${subscriptionSource}`)
  const fetchLogLabel = isSheetsWatch ? '[Google Sheets] Fetching changes' : '[Google Drive] Fetching changes'
  logger.info(fetchLogLabel, { hasPageToken: !!subscription.page_token, updatedAt: subscription?.updated_at })
  const integrationProvider = isSheetsWatch ? 'google-sheets' : 'google-drive'
  let changes: any
  try {
    changes = await getGoogleDriveChanges(
      metadata.userId,
      metadata.integrationId,
      subscription.page_token,
      integrationProvider
    )
  } catch (changesError: any) {
    console.error(`[Google Drive] Failed to fetch changes: ${changesError.message}`)
    throw changesError
  }
  const changesCount = Array.isArray(changes.changes) ? changes.changes.length : 0
  console.log(`[Google Drive] Changes fetched: count=${changesCount}, nextPageToken=${changes.nextPageToken ? 'yes' : 'no'}`)
  const watchStartTs = subscription?.updated_at ? new Date(subscription.updated_at).getTime() : null
  const fetchedLogLabel = isSheetsWatch ? '[Google Sheets] Changes fetched' : '[Google Drive] Changes fetched'
  logger.info(fetchedLogLabel, {
    count: changesCount,
    nextPageToken: (changes.nextPageToken ? `${String(changes.nextPageToken).slice(0, 8) }...` : null)
  })
  let processedChanges = 0
  const changeTypeCounts = { file_created: 0, file_updated: 0, folder_created: 0 }
  const sheetChangeCounts = isSheetsWatch
    ? {
        sheet_file_created: 0,
        sheet_updated: 0,
        sheet_folder_created: 0,
        sheet_folder_updated: 0
      }
    : null

  for (const change of changes.changes || []) {
    processedChanges += 1

    const parentIds = Array.isArray(change.file?.parents) ? change.file.parents : []

    if (!change.file) {
      if (change.removed && change.fileId) {
        await handleDriveFileDeleted({
          fileId: change.fileId,
          file: null,
          metadata,
          parentIds
        })
      }
      continue
    }

    if (change.removed) {
      await handleDriveFileDeleted({
        fileId: change.fileId,
        file: change.file,
        metadata,
        parentIds
      })
      continue
    }

    const mimeType = change.file.mimeType || ''
    const isFolder = mimeType === 'application/vnd.google-apps.folder'

    const createdTime = change.file.createdTime ? new Date(change.file.createdTime) : null
    const nowTs = Date.now()
    // Prefer watch start time to classify true creations after watch registration
    const isNewItem = createdTime
      ? (watchStartTs !== null
          ? createdTime.getTime() >= watchStartTs
          : (nowTs - createdTime.getTime() < 120000))
      : false
    const changeLogLabel = isSheetsWatch ? '[Google Sheets] Change' : '[Google Drive] Change'
    logger.info(changeLogLabel, {
      id: change.fileId || change.file?.id,
      mimeType,
      parents: parentIds,
      createdTime: change.file.createdTime,
      isFolder,
      isNewItem
    })

    let classifiedAs: 'file_created' | 'file_updated' | 'folder_created' | null = null

    if (isSheetsWatch) {
      let sheetChangeType: 'sheet_file_created' | 'sheet_updated' | 'sheet_folder_created' | 'sheet_folder_updated'
        = 'sheet_updated'

      if (isFolder) {
        sheetChangeType = isNewItem ? 'sheet_folder_created' : 'sheet_folder_updated'
      } else if (isNewItem) {
        sheetChangeType = 'sheet_file_created'
      }

      if (sheetChangeCounts) {
        sheetChangeCounts[sheetChangeType] += 1
      }

      logger.info('[Google Sheets] Change detected via Drive watch', {
        id: change.fileId || change.file?.id,
        changeType: sheetChangeType,
        isNewItem,
        isFolder,
        parents: parentIds
      })

      continue
    }

    if (isFolder) {
      if (isNewItem) {
        await handleDriveFolderCreated({
          folderId: change.fileId,
          folder: change.file,
          metadata,
          parentIds
        })
        classifiedAs = 'folder_created'
        changeTypeCounts.folder_created += 1
      }
    } else {
      if (isNewItem) {
        await handleDriveFileCreated({
          fileId: change.fileId,
          file: change.file,
          metadata,
          parentIds,
          webhookHeaders: event.eventData?.headers
        })
        classifiedAs = 'file_created'
        changeTypeCounts.file_created += 1
      } else {
        await handleDriveFileUpdated({
          fileId: change.fileId,
          file: change.file,
          metadata,
          parentIds,
          webhookHeaders: event.eventData?.headers
        })
        classifiedAs = 'file_updated'
        changeTypeCounts.file_updated += 1
      }
    }

    if (classifiedAs) {
      logger.info('[Google Drive] Change classified', {
        id: change.fileId || change.file?.id,
        changeType: classifiedAs
      })
    }

    const isGoogleDoc = mimeType === 'application/vnd.google-apps.document'
    if (isGoogleDoc) {
      await triggerDocsWorkflowsFromDriveChange(change.file, metadata, isNewItem, parentIds)
    }
  }

  const nextPageToken = changes.nextPageToken
  if (nextPageToken && nextPageToken !== subscription.page_token) {
    if (subscriptionSource === 'google_watch_subscriptions') {
      await supabase
        .from('google_watch_subscriptions')
        .update({
          page_token: nextPageToken,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', metadata.userId)
        .eq('integration_id', metadata.integrationId)
        .eq('provider', subscriptionProviderFilter)
    } else if (subscriptionSource === 'trigger_resources' && channelId) {
      const { data: existing } = await supabase
        .from('trigger_resources')
        .select('config')
        .eq('provider_id', subscriptionProviderFilter)
        .eq('external_id', channelId)
        .eq('status', 'active')
        .maybeSingle()

      const updatedConfig = {
        ...(existing?.config || {}),
        pageToken: nextPageToken
      }

      await supabase
        .from('trigger_resources')
        .update({
          config: updatedConfig,
          updated_at: new Date().toISOString()
        })
        .eq('provider_id', subscriptionProviderFilter)
        .eq('external_id', channelId)
    }
  }

  // Only update dedup map when token actually advanced (changes were found and consumed).
  // When changes.list returns no changes, nextPageToken equals the input token.
  // Updating the map in that case would cause the NEXT legitimate webhook to be falsely deduped.
  if (channelId) {
    if (nextPageToken && nextPageToken !== subscription.page_token) {
      lastDrivePageTokenProcessed.set(channelId, nextPageToken)
    } else {
      console.log(`[Google Drive] Token unchanged (${changesCount} changes), not updating dedup map`)
    }
  }

  if (isSheetsWatch) {
    try {
      await processGoogleSheetsEvent(
        {
          service: 'sheets',
          eventData: event.eventData,
          requestId: event.requestId
        },
        metadata
      )
    } catch (sheetsError) {
      logger.error('[Google Drive] Failed to process Google Sheets change:', sheetsError)
    }
  }

  if (isSheetsWatch) {
    logger.info('[Google Sheets] Processed change batch', {
      changesCount: processedChanges,
      sheetChangeCounts
    })
  } else {
    logger.info('[Google Drive] Processed change batch', { changesCount: processedChanges, changeTypeCounts })
  }
  return { processed: true, changesCount: processedChanges }
}


async function processGoogleCalendarEvent(event: GoogleWebhookEvent, metadata: any): Promise<any> {
  const { eventData } = event

  // Resolve calendarId from trigger_resources if missing from channel token metadata.
  // The onActivate lifecycle sets channelToken with userId/integrationId/provider but
  // omits calendarId — resolve it from the trigger config or the resource URL.
  if (!metadata.calendarId) {
    const channelId = eventData?.channelId || eventData?.headers?.['x-goog-channel-id']
    if (channelId) {
      const supabaseLookup = await createSupabaseServiceClient()
      const { data: triggerResource } = await supabaseLookup
        .from('trigger_resources')
        .select('config')
        .eq('external_id', channelId)
        .eq('status', 'active')
        .maybeSingle()

      if (triggerResource?.config) {
        // Calendar config stores calendars array (e.g., ['primary', 'user@gmail.com'])
        const calendars = triggerResource.config.calendars
        if (Array.isArray(calendars) && calendars.length > 0) {
          metadata.calendarId = calendars[0]
          logger.info('[Google Calendar] Resolved calendarId from trigger_resources', {
            calendarId: metadata.calendarId,
            channelId
          })
        }
      }
    }

    // Fallback: extract from resource URL (e.g., .../calendars/primary/events)
    if (!metadata.calendarId && eventData?.resource) {
      const calMatch = eventData.resource.match(/calendars\/([^/]+)\/events/)
      if (calMatch) {
        metadata.calendarId = decodeURIComponent(calMatch[1])
        logger.info('[Google Calendar] Resolved calendarId from resource URL', {
          calendarId: metadata.calendarId
        })
      }
    }
  }

  // Google Calendar sends a notification that changes occurred
  // We need to fetch the actual changes using the Calendar API
  if (metadata.userId && metadata.integrationId && metadata.calendarId) {
    const { getGoogleCalendarChanges } = await import('./google-calendar-watch-setup')

    // Get the sync token — try google_watch_subscriptions first (legacy), then trigger_resources
    const supabase = await createSupabaseServiceClient()
    let subscription = (await supabase
      .from('google_watch_subscriptions')
      .select('sync_token, metadata, updated_at')
      .eq('user_id', metadata.userId)
      .eq('integration_id', metadata.integrationId)
      .eq('provider', 'google-calendar')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()).data

    // Fallback: read sync token from trigger_resources.config (set during onActivate)
    if (!subscription?.sync_token) {
      const channelId = eventData?.channelId || eventData?.headers?.['x-goog-channel-id']
      if (channelId) {
        const { data: triggerResource } = await supabase
          .from('trigger_resources')
          .select('config')
          .eq('external_id', channelId)
          .eq('status', 'active')
          .maybeSingle()

        if (triggerResource?.config?.syncToken) {
          subscription = {
            sync_token: triggerResource.config.syncToken,
            metadata: triggerResource.config,
            updated_at: null,
          }
          logger.info('[Google Calendar] Using sync token from trigger_resources', {
            channelId,
            hasSyncToken: true
          })
        }
      }
    }

    // Fetch the actual changes
    let subscriptionMetadata: any = null
    if (subscription?.metadata) {
      if (typeof subscription.metadata === 'object') {
        subscriptionMetadata = subscription.metadata
      } else if (typeof subscription.metadata === 'string') {
        try {
          subscriptionMetadata = JSON.parse(subscription.metadata)
        } catch {
          subscriptionMetadata = null
        }
      }
    }

    const storedStartTime: string | null = subscriptionMetadata?.startTime || null
    const storedLastFetchTime: string | null = subscriptionMetadata?.lastFetchTime || null
    const isFirstSync = !subscription?.sync_token
    const effectiveWatchStartTime: string | null = isFirstSync
      ? (metadata.watchStartTime || storedStartTime || storedLastFetchTime || new Date().toISOString())
      : (metadata.watchStartTime || storedStartTime || storedLastFetchTime || null)

    calendarDebug('Metadata resolved for processing', {
      userId: metadata.userId,
      integrationId: metadata.integrationId,
      calendarId: metadata.calendarId,
      hasSyncToken: Boolean(subscription?.sync_token),
      isFirstSync,
      watchStartTime: effectiveWatchStartTime
    })

    const enrichedMetadata = {
      ...metadata,
      watchStartTime: effectiveWatchStartTime
    }

    calendarDebug('Fetching changes', {
      mode: subscription?.sync_token ? 'syncToken' : 'updatedMin',
      syncTokenPreview: subscription?.sync_token ? `${String(subscription.sync_token).slice(0, 12) }...` : null,
      updatedMin: subscription?.sync_token ? null : (effectiveWatchStartTime || 'now')
    })

    const changes = await getGoogleCalendarChanges(
      metadata.userId,
      metadata.integrationId,
      metadata.calendarId,
      subscription?.sync_token,
      {
        // Only consider events after watch start on first fetch when no sync token exists
        timeMin: subscription?.sync_token ? null : (enrichedMetadata.watchStartTime || undefined)
      }
    )

    calendarDebug('Change fetch complete', {
      eventsCount: changes.events?.length || 0,
      hasNextSyncToken: Boolean(changes.nextSyncToken)
    })

    const changeStats = {
      created: 0,
      updated: 0,
      deleted: 0
    }

    // Process each event change
    for (const event of changes.events || []) {
      try {
        calendarDebug('Inspecting event change', {
          id: event.id,
          status: event.status,
          created: event.created,
          updated: event.updated
        })
      } catch {}
      if (event.status === 'cancelled') {
        changeStats.deleted += 1
        await handleCalendarEventDeleted({
          eventId: event.id,
          event,
          metadata: enrichedMetadata
        })
      } else if (event.created && event.updated) {
        // Classify by timestamp proximity: Google Calendar often sets 'updated' to a
        // slightly later time than 'created' even for brand-new events (e.g., 1-2s drift
        // from server-side indexing). Use a 5-second tolerance to catch these.
        const createdTime = new Date(event.created)
        const updatedTime = new Date(event.updated)
        const diffMs = Math.abs(updatedTime.getTime() - createdTime.getTime())
        const isNewlyCreated = diffMs <= 5000

        if (isNewlyCreated) {
          changeStats.created += 1
          await handleCalendarEventCreated({
            eventId: event.id,
            event,
            metadata: enrichedMetadata
          })
        } else {
          changeStats.updated += 1
          await handleCalendarEventUpdated({
            eventId: event.id,
            event,
            metadata: enrichedMetadata
          })
        }
      } else {
        // Fallback: if we lack timestamps but not cancelled, treat as updated to avoid missing changes
        changeStats.updated += 1
        await handleCalendarEventUpdated({
          eventId: event.id,
          event,
          metadata: enrichedMetadata
        })
      }
    }

    const processedEvents = changeStats.created + changeStats.updated + changeStats.deleted
    if (processedEvents > 0) {
      calendarInfo('Processed calendar changes', {
        calendarId: metadata.calendarId,
        processedEvents,
        changeStats
      })
    } else {
      calendarDebug('No calendar changes detected for subscription', {
        calendarId: metadata.calendarId
      })
    }

    // Update the sync token for next time (after pagination completes)
    if (changes.nextSyncToken) {
      await supabase
        .from('google_watch_subscriptions')
        .update({ sync_token: changes.nextSyncToken, updated_at: new Date().toISOString() })
        .eq('user_id', metadata.userId)
        .eq('integration_id', metadata.integrationId)
        .eq('provider', 'google-calendar')
      calendarDebug('Persisted nextSyncToken for subscription', {
        calendarId: metadata.calendarId
      })
    } else {
      // Persist lastFetchTime fallback so subsequent runs can use updatedMin reliably
      const newMetadata = {
        ...(subscriptionMetadata || {}),
        lastFetchTime: new Date().toISOString()
      }
      await supabase
        .from('google_watch_subscriptions')
        .update({ metadata: newMetadata, updated_at: new Date().toISOString() })
        .eq('user_id', metadata.userId)
        .eq('integration_id', metadata.integrationId)
        .eq('provider', 'google-calendar')
      calendarDebug('Persisted lastFetchTime metadata for subscription', {
        calendarId: metadata.calendarId
      })
    }

    return { processed: true, eventsCount: changes.events?.length || 0 }
  }

  // Fallback to generic processing
  calendarDebug('Google Calendar webhook received, but missing metadata for processing', {
    hasUserId: Boolean(metadata?.userId),
    hasIntegrationId: Boolean(metadata?.integrationId),
    hasCalendarId: Boolean(metadata?.calendarId)
  })
  return { processed: true, eventType: 'calendar.notification' }
}

type CalendarChangeType = 'created' | 'updated' | 'deleted'
type DriveChangeType = 'file_created' | 'file_updated' | 'folder_created'
type SheetsChangeType = 'new_row' | 'updated_row' | 'new_worksheet'

/**
 * Check if a Google Drive file passes the configured filters
 */
function doesFilePassFilters(file: any, filters: any, parentIds: string[], configuredFolderId: string | null): boolean {
  if (!filters || !file) return true

  // Filter by file type
  if (filters.fileTypes && Array.isArray(filters.fileTypes) && filters.fileTypes.length > 0) {
    const fileMimeType = file.mimeType || file.mime_type || ''

    const matchesType = filters.fileTypes.some((filterType: string) => {
      // Handle wildcards like "image/*", "video/*", "audio/*"
      if (filterType.endsWith('/*')) {
        const prefix = filterType.replace('/*', '/')
        return fileMimeType.startsWith(prefix)
      }
      // Exact match
      return fileMimeType === filterType
    })

    if (!matchesType) {
      logger.info('[Google Drive] File type does not match filter', {
        fileMimeType,
        allowedTypes: filters.fileTypes
      })
      return false
    }
  }

  // Filter by name pattern (case-insensitive)
  if (filters.namePattern && typeof filters.namePattern === 'string' && filters.namePattern.trim() !== '') {
    const fileName = file.name || ''
    const pattern = filters.namePattern.toLowerCase()

    if (!fileName.toLowerCase().includes(pattern)) {
      logger.info('[Google Drive] File name does not match pattern', {
        fileName,
        pattern: filters.namePattern
      })
      return false
    }
  }

  // Filter by subfolder exclusion
  if (filters.excludeSubfolders === true && configuredFolderId) {
    // Check if file is in a subfolder (has parent other than configured folder)
    const isInConfiguredFolder = parentIds.includes(configuredFolderId)
    const isDirectChild = parentIds.length === 1 && isInConfiguredFolder

    if (!isDirectChild) {
      logger.info('[Google Drive] File is in subfolder, skipping due to excludeSubfolders filter', {
        fileId: file.id || file.fileId,
        parentIds,
        configuredFolderId
      })
      return false
    }
  }

  // Filter by minimum file size
  if (filters.minFileSize && typeof filters.minFileSize === 'number') {
    const fileSizeBytes = parseInt(file.size || '0', 10)
    const minSizeBytes = filters.minFileSize * 1024 * 1024 // Convert MB to bytes

    if (fileSizeBytes < minSizeBytes) {
      logger.info('[Google Drive] File size below minimum', {
        fileId: file.id || file.fileId,
        fileSizeMB: (fileSizeBytes / (1024 * 1024)).toFixed(2),
        minSizeMB: filters.minFileSize
      })
      return false
    }
  }

  // Filter by maximum file size
  if (filters.maxFileSize && typeof filters.maxFileSize === 'number') {
    const fileSizeBytes = parseInt(file.size || '0', 10)
    const maxSizeBytes = filters.maxFileSize * 1024 * 1024 // Convert MB to bytes

    if (fileSizeBytes > maxSizeBytes) {
      logger.info('[Google Drive] File size exceeds maximum', {
        fileId: file.id || file.fileId,
        fileSizeMB: (fileSizeBytes / (1024 * 1024)).toFixed(2),
        maxSizeMB: filters.maxFileSize
      })
      return false
    }
  }

  // Filter by creator email
  if (filters.createdByEmail && typeof filters.createdByEmail === 'string' && filters.createdByEmail.trim() !== '') {
    const ownerEmail = file.owners?.[0]?.emailAddress || file.owners?.[0]?.email || ''
    const expectedEmail = filters.createdByEmail.trim().toLowerCase()

    if (ownerEmail.toLowerCase() !== expectedEmail) {
      logger.info('[Google Drive] File creator does not match filter', {
        fileId: file.id || file.fileId,
        ownerEmail,
        expectedEmail: filters.createdByEmail
      })
      return false
    }
  }

  return true
}

/**
 * Check if a calendar event passes the configured filters
 */
function doesEventPassFilters(event: any, filters: any): boolean {
  if (!filters || !event) return true

  // Filter by event type
  const eventTypes = filters.eventTypes || 'all'
  if (eventTypes && eventTypes !== 'all') {
    const isAllDay = event.start?.date && !event.start?.dateTime
    const isRecurring = !!event.recurringEventId || !!event.recurrence

    switch (eventTypes) {
      case 'all_day':
        if (!isAllDay) return false
        break
      case 'regular':
        if (isAllDay) return false
        break
      case 'recurring':
        if (!isRecurring) return false
        break
      case 'non_recurring':
        if (isRecurring) return false
        break
    }
  }

  // Filter by required properties
  const includeEventsWith = filters.includeEventsWith
  if (includeEventsWith && Array.isArray(includeEventsWith) && includeEventsWith.length > 0) {
    for (const requirement of includeEventsWith) {
      switch (requirement) {
        case 'attendees':
          if (!event.attendees || event.attendees.length === 0) return false
          break
        case 'location':
          if (!event.location || event.location.trim() === '') return false
          break
        case 'meet_link':
          if (!event.hangoutLink && !event.conferenceData?.entryPoints?.length) return false
          break
        case 'attachments':
          if (!event.attachments || event.attachments.length === 0) return false
          break
        case 'description':
          if (!event.description || event.description.trim() === '') return false
          break
      }
    }
  }

  // Filter by time range
  const timeRange = filters.timeRange || 'any'
  if (timeRange && timeRange !== 'any') {
    // Get start time from event
    const startDateTime = event.start?.dateTime || event.start?.date
    if (!startDateTime) return true // If no start time, allow event

    const startDate = new Date(startDateTime)
    if (isNaN(startDate.getTime())) return true // Invalid date, allow event

    const dayOfWeek = startDate.getDay() // 0 = Sunday, 6 = Saturday
    const hour = startDate.getHours()

    switch (timeRange) {
      case 'work_hours':
        // 9am-5pm (9-17)
        if (hour < 9 || hour >= 17) return false
        break
      case 'after_hours':
        // Before 9am or after 5pm
        if (hour >= 9 && hour < 17) return false
        break
      case 'weekdays':
        // Mon-Fri (1-5)
        if (dayOfWeek === 0 || dayOfWeek === 6) return false
        break
      case 'weekends':
        // Sat-Sun (0, 6)
        if (dayOfWeek !== 0 && dayOfWeek !== 6) return false
        break
    }
  }

  return true
}

async function triggerMatchingCalendarWorkflows(changeType: CalendarChangeType, calendarEvent: any, metadata: any, options?: { watchStartTime?: string | null }) {
  if (!calendarEvent) {
    calendarDebug('Event payload missing event details, skipping', {
      changeType
    })
    return
  }

  const userId = metadata?.userId
  if (!userId) {
    calendarDebug('Missing userId in metadata, skipping workflow trigger', {
      changeType
    })
    return
  }

  let watchStartTime: Date | null = null
  const metadataStart = metadata?.watchStartTime || options?.watchStartTime
  if (typeof metadataStart === 'string' && metadataStart.trim().length > 0) {
    const parsed = new Date(metadataStart)
    if (!Number.isNaN(parsed.getTime())) {
      watchStartTime = parsed
    }
  }

  const triggerTypeMap: Record<CalendarChangeType, string> = {
    created: 'google_calendar_trigger_new_event',
    updated: 'google_calendar_trigger_event_updated',
    deleted: 'google_calendar_trigger_event_canceled'
  }

  const triggerType = triggerTypeMap[changeType]
  const eventId: string | undefined = calendarEvent.id || calendarEvent.eventId || calendarEvent.event_id
  const calendarId = metadata?.calendarId || 'primary'

  try {
    const supabase = await createSupabaseServiceClient()

    // Note: Use trigger_resources as source of truth (webhook_configs has different schema)
    let query = supabase
      .from('trigger_resources')
      .select('id, workflow_id, config, status, provider_id, trigger_type')
      .eq('trigger_type', triggerType)
      .eq('status', 'active')
      .eq('provider_id', 'google-calendar')
      .or('is_test.is.null,is_test.eq.false')

    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data: triggerResources, error: triggerError } = await query

    if (triggerError) {
      logger.error('[Google Calendar] Failed to fetch trigger resources:', triggerError)
      return
    }

    if (!triggerResources || triggerResources.length === 0) {
      return
    }

    const workflowIds = triggerResources
      .map((config) => config.workflow_id)
      .filter((id): id is string => Boolean(id))

    if (workflowIds.length === 0) {
      calendarDebug('No workflow IDs associated with trigger resources, skipping', {
        changeType
      })
      return
    }

    const { data: workflows, error: workflowsError } = await supabase
      .from('workflows')
      .select('id, user_id, name, status')
      .in('id', workflowIds)
      .eq('status', 'active')

    if (workflowsError) {
      logger.error('[Google Calendar] Failed to fetch workflows:', workflowsError)
      return
    }

    if (!workflows || workflows.length === 0) {
      return
    }

    // Load nodes and edges for all workflows in batch
    const [allNodesResult, allEdgesResult] = await Promise.all([
      supabase.from('workflow_nodes').select('*').in('workflow_id', workflowIds).order('display_order'),
      supabase.from('workflow_edges').select('*').in('workflow_id', workflowIds)
    ])

    const nodesByWorkflow = new Map<string, any[]>()
    const edgesByWorkflow = new Map<string, any[]>()

    for (const node of allNodesResult.data || []) {
      if (!nodesByWorkflow.has(node.workflow_id)) {
        nodesByWorkflow.set(node.workflow_id, [])
      }
      nodesByWorkflow.get(node.workflow_id)!.push({
        id: node.id,
        type: node.node_type,
        data: {
          type: node.node_type,
          label: node.label || node.node_type,
          config: node.config || {},
          isTrigger: node.is_trigger,
        },
        position: { x: node.position_x, y: node.position_y }
      })
    }

    for (const edge of allEdgesResult.data || []) {
      if (!edgesByWorkflow.has(edge.workflow_id)) {
        edgesByWorkflow.set(edge.workflow_id, [])
      }
      edgesByWorkflow.get(edge.workflow_id)!.push({
        id: edge.id,
        source: edge.source_node_id,
        target: edge.target_node_id,
        sourceHandle: edge.source_port_id || 'source',
        targetHandle: edge.target_port_id || 'target'
      })
    }

    for (const triggerResource of triggerResources) {
      if (!triggerResource.workflow_id) continue

      const workflow = workflows.find((w) => w.id === triggerResource.workflow_id)
      if (!workflow) {
        calendarDebug('Workflow not found for trigger resource, skipping', {
          workflowId: triggerResource.workflow_id
        })
        continue
      }

      // Attach nodes and connections from normalized tables
      const workflowWithGraph = {
        ...workflow,
        nodes: nodesByWorkflow.get(workflow.id) || [],
        connections: edgesByWorkflow.get(workflow.id) || []
      }

      const configData = (triggerResource.config || {}) as any
      const watchConfig = configData.watch || {}

      const configuredCalendars: string[] | null = Array.isArray(configData.calendars) ? configData.calendars : null
      const configuredCalendarId =
        watchConfig.calendarId ||
        configData.calendarId ||
        (configuredCalendars ? configuredCalendars[0] : undefined) ||
        'primary'

      const watchStartTime = watchConfig.startTime ? new Date(watchConfig.startTime) : null

      if (calendarId) {
        if (configuredCalendars && configuredCalendars.length > 0) {
          if (!configuredCalendars.includes(calendarId)) {
            continue
          }
        } else if (configuredCalendarId && configuredCalendarId !== calendarId) {
          continue
        }
      }

      // Nodes already loaded from normalized tables in workflowWithGraph
      const nodes = workflowWithGraph.nodes || []

      const matchingTriggers = nodes.filter((node: any) => {
        const nodeType = node?.data?.type || node?.type || node?.data?.nodeType
        if (nodeType !== triggerType) return false
        if (!node?.data?.isTrigger) return false

        const nodeCalendars: string[] | null = Array.isArray(node?.data?.config?.calendars) ? node.data.config.calendars : null
        const nodeCalendarId = node?.data?.config?.calendarId || node?.data?.config?.calendar?.id || null

        if (nodeCalendars && nodeCalendars.length > 0) {
          if (calendarId && !nodeCalendars.includes(calendarId)) return false
        } else if (nodeCalendarId) {
          if (calendarId && nodeCalendarId !== calendarId) return false
        } else {
          // No calendar configured on node; default to allow when workflow-level config matched
        }

        // Apply filter criteria from node config
        const nodeConfig = node?.data?.config || {}
        if (!doesEventPassFilters(calendarEvent, nodeConfig)) {
          calendarDebug('Event does not pass filter criteria', {
            workflowId: workflow.id,
            eventId,
            filters: {
              eventTypes: nodeConfig.eventTypes,
              includeEventsWith: nodeConfig.includeEventsWith,
              timeRange: nodeConfig.timeRange
            }
          })
          return false
        }

        return true
      })

      if (matchingTriggers.length === 0) {
        calendarDebug('No matching calendar triggers for workflow', {
          workflowId: workflow.id,
          triggerType,
          calendarId
        })
        continue
      }

      calendarInfo('Calendar trigger matched workflow', {
        workflowId: workflow.id,
        changeType,
        triggerType,
        calendarId,
        eventId,
        triggerCount: matchingTriggers.length
      })

      if (watchStartTime) {
        const eventTimestamp = resolveCalendarEventTimestamp(calendarEvent)
        if (eventTimestamp && eventTimestamp.getTime() < watchStartTime.getTime()) {
          calendarDebug('Skipping event older than watch start', {
            workflowId: workflow.id,
            changeType,
            eventTimestamp: eventTimestamp.toISOString(),
            watchStartTime: watchStartTime.toISOString()
          })
          continue
        }
      }

      const calendarUpdatedAt = typeof calendarEvent?.updated === 'string' ? calendarEvent.updated : null
      const dedupeHit = eventId && wasRecentlyProcessedCalendarEvent(workflow.id, eventId, changeType, calendarUpdatedAt)
      if (dedupeHit) {
        calendarDebug('Skipping duplicate calendar event within dedupe window', {
          workflowId: workflow.id,
          changeType,
          eventId
        })
        continue
      }

      const triggerPayload = {
        provider: 'google-calendar',
        changeType,
        calendarId,
        eventId,
        event: calendarEvent,
        metadata
      }

      try {
        // Mark as processed BEFORE starting execution to avoid concurrent duplicates
        if (eventId) {
          markCalendarEventProcessed(workflow.id, eventId, changeType, calendarUpdatedAt)
        }

        // PR-V2-WEBHOOK-GOOGLE: route through unified webhook dispatcher.
        // Local processedCalendarEvents map preserved for rollback-on-error
        // semantic (catch block deletes the key); pass `skipDedup: true`
        // so the dispatcher cache doesn't interfere.
        const nodeCount = workflowWithGraph.nodes.length
        const connectionCount = workflowWithGraph.connections.length
        calendarInfo('Dispatching workflow execution', {
          workflowId: workflow.id,
          changeType,
          nodeCount,
          connectionCount
        })
        calendarDebug('Execution input payload snapshot', {
          workflowId: workflow.id,
          eventId,
          payloadKeys: Object.keys(triggerPayload || {})
        })
        const dispatchResult = await executeWebhookWorkflow({
          workflowId: workflow.id,
          userId: workflow.user_id,
          provider: 'google-calendar',
          triggerType: `google_calendar_trigger_${changeType}`,
          triggerData: triggerPayload,
          metadata: {
            changeType,
            eventId,
            ...metadata,
          },
          skipDedup: true,
        })
        if (!dispatchResult.success) {
          throw new Error(dispatchResult.error || 'calendar dispatch failed')
        }
        calendarInfo('Workflow execution started', {
          workflowId: workflow.id,
          executionSessionId: dispatchResult.sessionId
        })

      } catch (workflowError) {
        logger.error(`[Google Calendar] Failed to execute workflow ${workflow.id}:`, workflowError)
        calendarDebug('Workflow execution error details', {
          workflowId: workflow.id,
          message: workflowError instanceof Error ? workflowError.message : String(workflowError)
        })
        if (eventId) {
          processedCalendarEvents.delete(buildCalendarDedupeKey(workflow.id, eventId, changeType))
        }
      }
    }
  } catch (error) {
    logger.error('[Google Calendar] Error triggering workflows for calendar event:', error)
  }
}

async function triggerMatchingDriveWorkflows(changeType: DriveChangeType, driveItem: any, metadata: any, options?: { parentIds?: string[]; isFolder?: boolean; webhookHeaders?: Record<string, string> }) {
  console.log(`[Google Drive] triggerMatchingDriveWorkflows: changeType=${changeType}, itemId=${driveItem?.id}, userId=${metadata?.userId}`)
  if (!driveItem) {
    console.debug('[Google Drive] Change payload missing drive item details, skipping')
    return
  }

  const userId = metadata?.userId
  if (!userId) {
    console.debug('[Google Drive] Missing userId in metadata, skipping workflow trigger')
    return
  }

  const parentIds = Array.isArray(options?.parentIds) ? options!.parentIds! : (Array.isArray(driveItem.parents) ? driveItem.parents : [])
  const parentId = parentIds.length > 0 ? parentIds[0] : null
  const drivePayload = { ...driveItem, parents: parentIds }
  const resourceId: string | undefined = drivePayload.id || drivePayload.fileId
  if (!resourceId) {
    console.debug('[Google Drive] Missing resource id for change, skipping')
    return
  }

  // For Google Sheets, only skip if NOT a real content change
  // x-goog-changed header includes "content" when file content was actually modified
  const mime = String(drivePayload.mimeType || '')
  if (changeType === 'file_updated' && mime === 'application/vnd.google-apps.spreadsheet') {
    const changedHeader = String(options?.webhookHeaders?.['x-goog-changed'] || '')
    if (!changedHeader.includes('content')) {
      logger.debug('[Google Drive] Skipping spreadsheet open/metadata-only event', { resourceId, changedHeader })
      return
    }
    logger.debug('[Google Drive] Spreadsheet content change detected, proceeding', { resourceId, changedHeader })
  }

  const triggerTypeMap: Record<DriveChangeType, string> = {
    file_created: 'google-drive:new_file_in_folder',
    folder_created: 'google-drive:new_folder_in_folder',
    file_updated: 'google-drive:file_updated'
  }

  const triggerType = triggerTypeMap[changeType]

  try {
    const supabase = await createSupabaseServiceClient()

    // Note: Use trigger_resources as source of truth (webhook_configs has different schema)
    const { data: triggerResources, error: triggerError } = await supabase
      .from('trigger_resources')
      .select('id, workflow_id, config, status, provider_id, trigger_type')
      .eq('trigger_type', triggerType)
      .eq('status', 'active')
      .eq('provider_id', 'google-drive')
      .eq('user_id', userId)
      .or('is_test.is.null,is_test.eq.false')

    if (triggerError) {
      logger.error('[Google Drive] Failed to fetch trigger resources:', triggerError)
      return
    }

    if (!triggerResources || triggerResources.length === 0) {
      console.log(`[Google Drive] No matching trigger resources: triggerType=${triggerType}, userId=${userId}, changeType=${changeType}`)
      return
    }

    console.log(`[Google Drive] Found ${triggerResources.length} trigger resources for ${triggerType}`)

    const workflowIds = triggerResources
      .map((config) => config.workflow_id)
      .filter((id): id is string => Boolean(id))

    if (workflowIds.length === 0) {
      return
    }

    const { data: workflows, error: workflowsError } = await supabase
      .from('workflows')
      .select('id, user_id, name, status')
      .in('id', workflowIds)
      .eq('status', 'active')

    if (workflowsError) {
      console.error('[Google Drive] Failed to fetch workflows:', workflowsError.message)
      return
    }

    if (!workflows || workflows.length === 0) {
      console.log(`[Google Drive] No active workflows found for workflowIds=${workflowIds.join(',')}`)
      return
    }

    console.log(`[Google Drive] Found ${workflows.length} active workflows to check`)

    // Load nodes and edges for all workflows in batch
    const [driveNodesResult, driveEdgesResult] = await Promise.all([
      supabase.from('workflow_nodes').select('*').in('workflow_id', workflowIds).order('display_order'),
      supabase.from('workflow_edges').select('*').in('workflow_id', workflowIds)
    ])

    const driveNodesByWorkflow = new Map<string, any[]>()
    for (const node of driveNodesResult.data || []) {
      if (!driveNodesByWorkflow.has(node.workflow_id)) {
        driveNodesByWorkflow.set(node.workflow_id, [])
      }
      driveNodesByWorkflow.get(node.workflow_id)!.push({
        id: node.id,
        type: node.node_type,
        data: {
          type: node.node_type,
          label: node.label || node.node_type,
          config: node.config || {},
          isTrigger: node.is_trigger,
        },
        position: { x: node.position_x, y: node.position_y }
      })
    }

    for (const triggerResource of triggerResources) {
      if (!triggerResource.workflow_id) continue

      const workflow = workflows.find((w) => w.id === triggerResource.workflow_id)
      if (!workflow) {
        continue
      }

      const configData = (triggerResource.config || {}) as any
      const nodes = driveNodesByWorkflow.get(workflow.id) || []

      const matchingTriggers = nodes.filter((node: any) => {
        const nodeType = node?.data?.type || node?.type || node?.data?.nodeType
        if (nodeType !== triggerType) return false
        if (!node?.data?.isTrigger) return false

        let nodeConfig: Record<string, any> = {}
        if (node?.data?.config) {
          if (typeof node.data.config === 'string') {
            try {
              nodeConfig = JSON.parse(node.data.config)
            } catch {
              nodeConfig = {}
            }
          } else if (typeof node.data.config === 'object') {
            nodeConfig = node.data.config as Record<string, any>
          }
        }

        // Check folder matching first
        let folderMatches = false
        let configuredFolderId: string | null = null

        switch (changeType) {
          case 'file_created': {
            configuredFolderId = configData?.folderId || nodeConfig?.folderId || null
            if (configuredFolderId) {
              folderMatches = parentIds.includes(configuredFolderId)
            } else {
              folderMatches = true
            }
            break
          }
          case 'folder_created': {
            configuredFolderId = configData?.folderId || configData?.parentFolderId || nodeConfig?.folderId || nodeConfig?.parentFolderId || null
            if (configuredFolderId) {
              folderMatches = parentIds.includes(configuredFolderId)
            } else {
              folderMatches = true
            }
            break
          }
          case 'file_updated': {
            // Match by explicit fileId, otherwise by folderId containment, otherwise allow
            const explicitFileId = configData?.fileId || nodeConfig?.fileId || null
            if (explicitFileId) {
              folderMatches = explicitFileId === resourceId
            } else {
              configuredFolderId = configData?.folderId || nodeConfig?.folderId || null
              if (configuredFolderId) {
                folderMatches = parentIds.includes(configuredFolderId)
              } else {
                folderMatches = true
              }
            }
            break
          }
          default:
            return false
        }

        if (!folderMatches) return false

        // Apply filter criteria from node config (for file_created triggers)
        if (changeType === 'file_created' && !doesFilePassFilters(drivePayload, nodeConfig, parentIds, configuredFolderId)) {
          logger.info('[Google Drive] File does not pass filter criteria', {
            workflowId: workflow.id,
            resourceId,
            filters: {
              fileTypes: nodeConfig.fileTypes,
              namePattern: nodeConfig.namePattern,
              excludeSubfolders: nodeConfig.excludeSubfolders,
              minFileSize: nodeConfig.minFileSize,
              maxFileSize: nodeConfig.maxFileSize,
              createdByEmail: nodeConfig.createdByEmail
            }
          })
          return false
        }

        return true
      })

      if (matchingTriggers.length === 0) {
        logger.debug(`[Google Drive] No matching trigger nodes in workflow ${workflow.id}: triggerType=${triggerType}, parentIdCount=${parentIds?.length || 0}, totalNodes=${nodes.length}`)
        continue
      }

      const lastUpdated = drivePayload.modifiedTime || drivePayload.createdTime || null
      if (wasRecentlyProcessedDriveChange(workflow.id, resourceId, changeType, lastUpdated)) {
        continue
      }

      const triggerPayload: any = {
        provider: 'google-drive',
        changeType,
        resourceId,
        parentId,
        parentIds,
        item: drivePayload,
        file: options?.isFolder ? undefined : drivePayload,
        folder: options?.isFolder ? drivePayload : undefined,
        metadata
      }

      try {
        console.log(`[Google Drive] Executing workflow ${workflow.id} for ${changeType} on ${resourceId}`)
        markDriveChangeProcessed(workflow.id, resourceId, changeType, lastUpdated)

        // PR-V2-WEBHOOK-GOOGLE: route through unified dispatcher; local
        // processedDriveChanges preserved for rollback-on-error.
        const dispatchResult = await executeWebhookWorkflow({
          workflowId: workflow.id,
          userId: workflow.user_id,
          provider: 'google-drive',
          triggerType: `google_drive_trigger_${changeType}`,
          triggerData: triggerPayload,
          metadata: {
            changeType,
            resourceId,
            ...metadata,
          },
          skipDedup: true,
        })
        if (!dispatchResult.success) {
          throw new Error(dispatchResult.error || 'drive dispatch failed')
        }
        logger.info('[Google Drive] Workflow execution started', {
          workflowId: workflow.id,
          executionSessionId: dispatchResult.sessionId,
          changeType
        })

      } catch (workflowError) {
        logger.error(`[Google Drive] Failed to execute workflow ${workflow.id}:`, workflowError)
        processedDriveChanges.delete(buildDriveDedupeKey(workflow.id, resourceId, changeType))
      }
    }
  } catch (error) {
    logger.error('[Google Drive] Error triggering workflows for drive change:', error)
  }
}

async function triggerMatchingSheetsWorkflows(changeType: SheetsChangeType, changePayload: any, metadata: any) {
  const userId = metadata?.userId
  if (!userId) {
    console.debug('[Google Sheets] Missing userId in metadata, skipping workflow trigger')
    return
  }

  const spreadsheetId: string | null = changePayload?.spreadsheetId || metadata?.spreadsheetId || null
  if (!spreadsheetId) {
    console.debug('[Google Sheets] Missing spreadsheetId in payload, skipping workflow trigger')
    return
  }

  const changeSheetName: string | null = changePayload?.sheetName || metadata?.sheetName || null
  const changeSheetId: string | null = changePayload?.sheetId || metadata?.sheetId || null
  const triggerTypeMap: Record<SheetsChangeType, string> = {
    new_row: 'google_sheets_trigger_new_row',
    updated_row: 'google_sheets_trigger_updated_row',
    new_worksheet: 'google_sheets_trigger_new_worksheet'
  }

  const triggerType = triggerTypeMap[changeType]

  try {
    const supabase = await createSupabaseServiceClient()

    const { data: triggerResources, error: triggerError } = await supabase
      .from('trigger_resources')
      .select('id, workflow_id, config, status, provider_id, trigger_type')
      .eq('trigger_type', triggerType)
      .eq('status', 'active')
      .eq('provider_id', 'google-sheets')
      .eq('user_id', userId)
      .or('is_test.is.null,is_test.eq.false')

    if (triggerError) {
      logger.error('[Google Sheets] Failed to fetch trigger resources:', triggerError)
      return
    }

    // Note: webhook_configs table has different schema (no config/provider_id/trigger_type columns)
    // trigger_resources is the source of truth for Google Sheets triggers
    // We only use trigger_resources now - the webhook_configs query was legacy code
    const mergedConfigs = [...(triggerResources || [])]

    logger.info('[Google Sheets] Evaluating sheet workflows', {
      changeType,
      triggerType,
      spreadsheetId,
      sheetName: changeSheetName,
      sheetId: changeSheetId,
      configs: mergedConfigs.length,
      configMetadata: mergedConfigs.map((c) => ({
        id: c.id,
        workflowId: c.workflow_id,
        hasConfig: !!c.config,
        configType: typeof c.config,
        configKeys: c.config && typeof c.config === 'object' ? Object.keys(c.config) : [],
        providerId: c.provider_id,
        triggerType: c.trigger_type
      }))
    })

    if (mergedConfigs.length === 0) {
      return
    }

    const workflowIds = mergedConfigs
      .map((config) => config.workflow_id)
      .filter((id): id is string => Boolean(id))

    if (workflowIds.length === 0) {
      return
    }

    const { data: workflows, error: workflowsError } = await supabase
      .from('workflows')
      .select('id, user_id, name, status')
      .in('id', workflowIds)
      .eq('status', 'active')

    if (workflowsError) {
      logger.error('[Google Sheets] Failed to fetch workflows:', workflowsError)
      return
    }

    if (!workflows || workflows.length === 0) {
      return
    }

    // Load nodes for all workflows in batch
    const { data: sheetsNodesData } = await supabase
      .from('workflow_nodes')
      .select('*')
      .in('workflow_id', workflowIds)
      .order('display_order')

    const sheetsNodesByWorkflow = new Map<string, any[]>()
    for (const node of sheetsNodesData || []) {
      if (!sheetsNodesByWorkflow.has(node.workflow_id)) {
        sheetsNodesByWorkflow.set(node.workflow_id, [])
      }
      sheetsNodesByWorkflow.get(node.workflow_id)!.push({
        id: node.id,
        type: node.node_type,
        data: {
          type: node.node_type,
          label: node.label || node.node_type,
          config: node.config || {},
          isTrigger: node.is_trigger,
        },
        position: { x: node.position_x, y: node.position_y }
      })
    }

    for (const webhookConfig of mergedConfigs) {
      if (!webhookConfig.workflow_id) continue

      const workflow = workflows.find((w) => w.id === webhookConfig.workflow_id)
      if (!workflow) {
        continue
      }

      const nodes = sheetsNodesByWorkflow.get(workflow.id) || []
      let configData: Record<string, any> = {}
      if (webhookConfig.config) {
        if (typeof webhookConfig.config === 'string') {
          try {
            configData = JSON.parse(webhookConfig.config)
          } catch {
            configData = {}
          }
        } else if (typeof webhookConfig.config === 'object') {
          configData = webhookConfig.config as Record<string, any>
        }
      }

      const matchingTriggers = nodes.filter((node: any) => {
        const nodeType = node?.data?.type || node?.type || node?.data?.nodeType
        if (nodeType !== triggerType) return false
        if (!node?.data?.isTrigger) return false

        let nodeConfig: Record<string, any> = {}
        if (node?.data?.config) {
          if (typeof node.data.config === 'string') {
            try {
              nodeConfig = JSON.parse(node.data.config)
            } catch {
              nodeConfig = {}
            }
          } else if (typeof node.data.config === 'object') {
            nodeConfig = node.data.config as Record<string, any>
          }
        }

        const configSpreadsheetId = configData?.spreadsheetId || nodeConfig?.spreadsheetId || null
        if (configSpreadsheetId && configSpreadsheetId !== spreadsheetId) {
          return false
        }

        if (changeType !== 'new_worksheet') {
          const configSheetName = configData?.sheetName || nodeConfig?.sheetName || null
          if (configSheetName && changeSheetName && configSheetName !== changeSheetName) {
            logger.info('[Google Sheets] Sheet name mismatch', {
              workflowId: workflow.id,
              configSheetName,
              changeSheetName
            })
            return false
          }
          if (configSheetName && !changeSheetName) {
            return false
          }
        }

        // Apply filtering for new_row and updated_row triggers
        if (changeType === 'new_row' || changeType === 'updated_row') {
          const rowValues = Array.isArray(changePayload?.values)
            ? changePayload.values
            : (Array.isArray(changePayload?.data) ? changePayload.data : [])

          // Filter 1: Skip empty rows (default: true)
          const skipEmptyRows = configData?.skipEmptyRows ?? nodeConfig?.skipEmptyRows ?? true
          if (skipEmptyRows) {
            const hasAnyValue = rowValues.some((val: any) => val !== null && val !== undefined && String(val).trim() !== '')
            if (!hasAnyValue) {
              logger.info('[Google Sheets] Skipping empty row', {
                workflowId: workflow.id,
                rowNumber: changePayload?.rowNumber,
                changeType,
                skipEmptyRows
              })
              return false
            }
          }

          // Filter 2: Required columns
          const requiredColumns = configData?.requiredColumns || nodeConfig?.requiredColumns
          if (requiredColumns && Array.isArray(requiredColumns) && requiredColumns.length > 0) {
            // Get headers from changePayload metadata if available
            const headers = changePayload?.headers || metadata?.headers

            if (headers && Array.isArray(headers)) {
              // Check if required columns have values
              const missingRequiredColumns = requiredColumns.filter((columnName: string) => {
                const columnIndex = headers.findIndex((h: string) => h === columnName)
                if (columnIndex === -1) return true // Column not found in headers

                const value = rowValues[columnIndex]
                return value === null || value === undefined || String(value).trim() === ''
              })

              if (missingRequiredColumns.length > 0) {
                logger.info('[Google Sheets] Skipping row - required columns missing values', {
                  workflowId: workflow.id,
                  rowNumber: changePayload?.rowNumber,
                  changeType,
                  requiredColumns,
                  missingRequiredColumns
                })
                return false
              }
            } else {
              logger.warn('[Google Sheets] Required columns configured but headers not available in webhook payload', {
                workflowId: workflow.id,
                changeType,
                requiredColumns
              })
            }
          }
        }

        return true
      })

      logger.info('[Google Sheets] Matching triggers found', {
        workflowId: workflow.id,
        matchingCount: matchingTriggers.length
      })

      if (matchingTriggers.length === 0) {
        continue
      }

      const eventTimestamp: string = changePayload?.timestamp || metadata?.timestamp || new Date().toISOString()
      const rowNumber: number | null = typeof changePayload?.rowNumber === 'number'
        ? changePayload.rowNumber
        : null
      const rowIndex: number | null = typeof changePayload?.rowIndex === 'number'
        ? changePayload.rowIndex
        : (rowNumber !== null ? rowNumber - 1 : null)
      const values: any[] = Array.isArray(changePayload?.values)
        ? changePayload.values
        : (Array.isArray(changePayload?.data) ? changePayload.data : [])
      const dedupeSignature = values.length > 0 ? JSON.stringify(values) : null
      const changeIdentifier = (() => {
        switch (changeType) {
          case 'new_row':
            return `row-${rowNumber ?? rowIndex ?? 'unknown'}`
          case 'updated_row':
            return `updated-${rowNumber ?? changeSheetName ?? 'unknown'}`
          case 'new_worksheet':
            return `worksheet-${changeSheetId || changeSheetName || 'unknown'}`
          default:
            return `${changeType}`
        }
      })()

      const dedupeSheetScope = changeSheetName
        || configData?.sheetName
        || (matchingTriggers[0]?.data?.config?.sheetName ?? null)

     const dedupeKey = buildSheetsDedupeKey(
        workflow.id,
        spreadsheetId,
        dedupeSheetScope,
        `${changeType}-${changeIdentifier}`
      )

      logger.info('[Google Sheets] Dedupe check', {
        workflowId: workflow.id,
        dedupeKey,
        signature: dedupeSignature,
        eventTimestamp
      })

      if (wasRecentlyProcessedSheetsChange(dedupeKey, eventTimestamp, dedupeSignature)) {
        continue
      }

      const triggerPayload: any = {
        provider: 'google-sheets',
        changeType,
        spreadsheetId,
        sheetId: changeSheetId,
        sheetName: changeSheetName || dedupeSheetScope,
        timestamp: eventTimestamp,
        metadata,
        rowNumber,
        rowIndex,
        values,
        data: changePayload?.data ?? values,
        message: changePayload?.message ?? null,
        raw: changePayload,
        row: {
          rowIndex,
          rowNumber,
          values,
          sheetName: changeSheetName || dedupeSheetScope,
          spreadsheetId,
          timestamp: eventTimestamp
        }
      }

      try {
        markSheetsChangeProcessed(dedupeKey, eventTimestamp, dedupeSignature)

        // PR-V2-WEBHOOK-GOOGLE: route through unified dispatcher; local
        // processedSheetsChanges preserved for rollback-on-error.
        const dispatchResult = await executeWebhookWorkflow({
          workflowId: workflow.id,
          userId: workflow.user_id,
          provider: 'google-sheets',
          triggerType: `google_sheets_trigger_${changeType}`,
          triggerData: triggerPayload,
          metadata: {
            changeType,
            spreadsheetId,
            ...metadata,
          },
          skipDedup: true,
        })
        if (!dispatchResult.success) {
          throw new Error(dispatchResult.error || 'sheets dispatch failed')
        }
        logger.info('[Google Sheets] Workflow execution started', {
          workflowId: workflow.id,
          executionSessionId: dispatchResult.sessionId,
          changeType
        })

      } catch (workflowError) {
        logger.error(`[Google Sheets] Failed to execute workflow ${workflow.id}:`, workflowError)
        processedSheetsChanges.delete(dedupeKey)
      }
    }
  } catch (error) {
    logger.error('[Google Sheets] Error triggering workflows for sheet change:', error)
  }
}

async function triggerDocsWorkflowsFromDriveChange(driveFile: any, metadata: any, isNewItem: boolean, parentIds: string[]) {
  if (!driveFile || !driveFile.id) return

  const docEventPayload = {
    id: driveFile.id,
    title: driveFile.name,
    properties: {},
    parent: parentIds[0],
    created_time: driveFile.createdTime,
    last_edited_time: driveFile.modifiedTime,
    url: driveFile.webViewLink
  }

  try {
    const supabase = await createSupabaseServiceClient()

    // First get all active workflows for this user
    const { data: docWorkflows, error } = await supabase
      .from('workflows')
      .select('id, user_id, status')
      .eq('status', 'active')
      .eq('user_id', metadata?.userId)

    if (error) {
      logger.error('[Google Drive] Failed to fetch Google Docs workflows:', error)
    } else if (docWorkflows && docWorkflows.length > 0) {
      // Load nodes for all workflows in one query
      const workflowIds = docWorkflows.map(w => w.id)
      const { data: allNodes } = await supabase
        .from('workflow_nodes')
        .select('id, workflow_id, node_type, label, config, is_trigger, provider_id, position_x, position_y')
        .in('workflow_id', workflowIds)

      // Group nodes by workflow
      const nodesByWorkflow = new Map<string, any[]>()
      for (const node of allNodes || []) {
        const list = nodesByWorkflow.get(node.workflow_id) || []
        list.push({
          id: node.id,
          type: node.node_type,
          data: {
            type: node.node_type,
            label: node.label,
            config: node.config || {},
            isTrigger: node.is_trigger,
            providerId: node.provider_id
          },
          position: { x: node.position_x, y: node.position_y }
        })
        nodesByWorkflow.set(node.workflow_id, list)
      }

      for (const wf of docWorkflows) {
        const nodes = nodesByWorkflow.get(wf.id) || []
        const matchingNewDocTriggers = nodes.filter((n: any) => n?.data?.isTrigger && n?.data?.type === 'google_docs_trigger_new_document')
        for (const trig of matchingNewDocTriggers) {
          const cfg = trig?.data?.config || {}
          if (cfg.folderId && parentIds.length > 0 && !parentIds.includes(cfg.folderId)) {
            continue
          }
          if (cfg.mimeType && driveFile.mimeType && cfg.mimeType !== driveFile.mimeType) {
            continue
          }

          // PR-V2-WEBHOOK-GOOGLE: route through unified dispatcher.
          // No local dedup at this site — let the dispatcher's auto-
          // derivation pick up document.id / driveFile.id when present.
          const docsChangeType = isNewItem ? 'document_created' : 'document_updated'
          const docsTriggerData = {
            provider: 'google-docs',
            changeType: docsChangeType,
            document: docEventPayload,
            metadata,
          }
          await executeWebhookWorkflow({
            workflowId: wf.id,
            userId: wf.user_id,
            provider: 'google-docs',
            triggerType: `google_docs_trigger_${docsChangeType}`,
            triggerData: docsTriggerData,
            metadata: {
              changeType: docsChangeType,
              documentId: driveFile?.id,
              ...metadata,
            },
            dedupeKey: driveFile?.id ? `${driveFile.id}:${docsChangeType}` : undefined,
          })
        }
      }
    }
  } catch (docError) {
    logger.error('Failed to trigger Google Docs workflow from Drive change:', docError)
  }

  if (isNewItem) {
    await handleDocsDocumentCreated({ document_id: driveFile.id, ...docEventPayload })
  } else {
    await handleDocsDocumentUpdated({ document_id: driveFile.id, ...docEventPayload })
  }
}

function resolveCalendarEventTimestamp(calendarEvent: any): Date | null {
  const candidates = [
    calendarEvent?.updated,
    calendarEvent?.created,
    calendarEvent?.start?.dateTime,
    calendarEvent?.start?.date
  ]

  for (const value of candidates) {
    if (typeof value !== 'string' || value.trim().length === 0) continue

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T00:00:00Z`)
    }

    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return null
}

async function processGoogleDocsEvent(event: GoogleWebhookEvent): Promise<any> {
  const { eventData } = event
  
  // Handle different Google Docs event types
  switch (eventData.type) {
    case 'document.created':
      return await handleDocsDocumentCreated(eventData)
    case 'document.updated':
      return await handleDocsDocumentUpdated(eventData)
    case 'document.deleted':
      return await handleDocsDocumentDeleted(eventData)
    case 'comment.added':
      return await handleDocsCommentAdded(eventData)
    default:
      logger.info('Unhandled Google Docs event type:', eventData.type)
      return { processed: true, eventType: eventData.type }
  }
}

async function processGoogleSheetsEvent(event: GoogleWebhookEvent, metadata: any): Promise<any> {
  const { eventData } = event

  // Google Sheets uses Drive API for webhooks
  // We need to check what changed in the spreadsheet
  if (metadata.userId && metadata.integrationId && metadata.spreadsheetId) {
    const { checkGoogleSheetsChanges } = await import('./google-sheets-watch-setup')

    // Get the previous metadata from the subscription
    const supabase = await createSupabaseServiceClient()
    const { data: subscription } = await supabase
      .from('google_watch_subscriptions')
      .select('metadata, updated_at')
      .eq('user_id', metadata.userId)
      .eq('integration_id', metadata.integrationId)
      .eq('provider', 'google-sheets')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let subscriptionMetadata = subscription?.metadata
    if (subscriptionMetadata && typeof subscriptionMetadata === 'string') {
      try {
        subscriptionMetadata = JSON.parse(subscriptionMetadata)
      } catch {
        subscriptionMetadata = null
      }
    }

    logger.info('[Google Sheets] Loaded subscription metadata', {
      hasMetadata: Boolean(subscriptionMetadata),
      updatedAt: subscription?.updated_at
    })

    if (subscriptionMetadata) {
      // Check for changes
      const result = await checkGoogleSheetsChanges(
        metadata.userId,
        metadata.integrationId,
        metadata.spreadsheetId,
        subscriptionMetadata
      )

      logger.info('[Google Sheets] Detected sheet changes', {
        totalChanges: result.changes?.length || 0,
        changeTypes: (result.changes || []).map(c => c.type)
      })

      // Process each change
      for (const change of result.changes || []) {
        switch (change.type) {
          case 'new_row':
            await handleSheetsRowCreated({
              spreadsheetId: change.spreadsheetId || metadata.spreadsheetId,
              sheetName: change.sheetName,
              rowNumber: change.rowNumber,
              rowIndex: change.rowIndex,
              data: change.data,
              values: change.values,
              headers: change.headers, // Pass headers for filtering
              sheetId: change.sheetId,
              timestamp: change.timestamp,
              metadata
            })
            break
          case 'updated_row':
            await handleSheetsRowUpdated({
              spreadsheetId: change.spreadsheetId || metadata.spreadsheetId,
              sheetName: change.sheetName,
              message: change.message,
              rowNumber: change.rowNumber,
              rowIndex: change.rowIndex,
              data: change.data,
              values: change.values,
              headers: change.headers, // Pass headers for filtering
              timestamp: change.timestamp,
              metadata
            })
            break
          case 'new_worksheet':
            await handleSheetsSheetCreated({
              spreadsheetId: change.spreadsheetId || metadata.spreadsheetId,
              sheetName: change.sheetName,
              sheetId: change.sheetId,
              timestamp: change.timestamp,
              metadata
            })
            break
        }
      }

      // Update the metadata for next comparison
      if (result.updatedMetadata) {
        await supabase
          .from('google_watch_subscriptions')
          .update({ metadata: result.updatedMetadata })
          .eq('user_id', metadata.userId)
          .eq('integration_id', metadata.integrationId)
          .eq('provider', 'google-sheets')
      }

      return { processed: true, changesCount: result.changes?.length || 0 }
    }
  }

  // Fallback to generic processing
  logger.info('Google Sheets webhook received, but missing metadata for processing')
  return { processed: true, eventType: 'sheets.notification' }
}

async function processGenericGoogleEvent(event: GoogleWebhookEvent): Promise<any> {
  // Generic Google event processing
  logger.info('Processing generic Google webhook event:', event.service)
  return { processed: true, service: event.service }
}

// Google Drive event handlers
async function handleDriveFileCreated(eventData: any): Promise<any> {
  const parentIds: string[] = Array.isArray(eventData.parentIds) ? eventData.parentIds : []
  const driveItem = {
    ...(eventData.file || {}),
    id: eventData.file?.id || eventData.fileId,
    parents: parentIds
  }
  await triggerMatchingDriveWorkflows('file_created', driveItem, eventData.metadata || {}, {
    parentIds,
    isFolder: false,
    webhookHeaders: eventData.webhookHeaders
  })
  return { processed: true, type: 'drive_file_created', fileId: eventData.fileId || eventData.file?.id }
}

async function handleDriveFileUpdated(eventData: any): Promise<any> {
  const parentIds: string[] = Array.isArray(eventData.parentIds) ? eventData.parentIds : []
  const driveItem = {
    ...(eventData.file || {}),
    id: eventData.file?.id || eventData.fileId,
    parents: parentIds
  }
  await triggerMatchingDriveWorkflows('file_updated', driveItem, eventData.metadata || {}, {
    parentIds,
    isFolder: false,
    webhookHeaders: eventData.webhookHeaders
  })
  return { processed: true, type: 'drive_file_updated', fileId: eventData.fileId || eventData.file?.id }
}

async function handleDriveFileDeleted(eventData: any): Promise<any> {
  const targetId = eventData.fileId || eventData.file?.id
  logger.info('Processing Google Drive file deleted:', targetId)
  return { processed: true, type: 'drive_file_deleted', fileId: targetId }
}

async function handleDriveFolderCreated(eventData: any): Promise<any> {
  const parentIds: string[] = Array.isArray(eventData.parentIds) ? eventData.parentIds : []
  const driveItem = {
    ...(eventData.folder || {}),
    id: eventData.folder?.id || eventData.folderId,
    parents: parentIds
  }
  await triggerMatchingDriveWorkflows('folder_created', driveItem, eventData.metadata || {}, {
    parentIds,
    isFolder: true
  })
  return { processed: true, type: 'drive_folder_created', folderId: eventData.folderId || eventData.folder?.id }
}

// Google Calendar event handlers
async function handleCalendarEventCreated(eventData: any): Promise<any> {
  const eventId: string | undefined = eventData.eventId || eventData.event_id || eventData.event?.id
  await triggerMatchingCalendarWorkflows('created', eventData.event, eventData.metadata, {
    watchStartTime: eventData.metadata?.watchStartTime || null
  })
  return { processed: true, type: 'calendar_event_created', eventId }
}

async function handleCalendarEventUpdated(eventData: any): Promise<any> {
  const eventId: string | undefined = eventData.eventId || eventData.event_id || eventData.event?.id
  await triggerMatchingCalendarWorkflows('updated', eventData.event, eventData.metadata, {
    watchStartTime: eventData.metadata?.watchStartTime || null
  })
  return { processed: true, type: 'calendar_event_updated', eventId }
}

async function handleCalendarEventDeleted(eventData: any): Promise<any> {
  const eventId: string | undefined = eventData.eventId || eventData.event_id || eventData.event?.id
  await triggerMatchingCalendarWorkflows('deleted', eventData.event, eventData.metadata, {
    watchStartTime: eventData.metadata?.watchStartTime || null
  })
  return { processed: true, type: 'calendar_event_deleted', eventId }
}

async function handleCalendarCreated(eventData: any): Promise<any> {
  logger.info('Processing Google Calendar created:', eventData.calendar_id)
  return { processed: true, type: 'calendar_created', calendarId: eventData.calendar_id }
}

// Google Docs event handlers
async function handleDocsDocumentCreated(eventData: any): Promise<any> {
  logger.info('Processing Google Docs document created:', eventData.document_id)
  return { processed: true, type: 'docs_document_created', documentId: eventData.document_id }
}

async function handleDocsDocumentUpdated(eventData: any): Promise<any> {
  logger.info('Processing Google Docs document updated:', eventData.document_id)
  return { processed: true, type: 'docs_document_updated', documentId: eventData.document_id }
}

async function handleDocsDocumentDeleted(eventData: any): Promise<any> {
  logger.info('Processing Google Docs document deleted:', eventData.document_id)
  return { processed: true, type: 'docs_document_deleted', documentId: eventData.document_id }
}

async function handleDocsCommentAdded(eventData: any): Promise<any> {
  logger.info('Processing Google Docs comment added:', eventData.comment_id)
  return { processed: true, type: 'docs_comment_added', commentId: eventData.comment_id }
}

// Google Sheets event handlers
async function handleSheetsSpreadsheetCreated(eventData: any): Promise<any> {
  logger.info('Processing Google Sheets spreadsheet created:', eventData.spreadsheet_id)
  return { processed: true, type: 'sheets_spreadsheet_created', spreadsheetId: eventData.spreadsheet_id }
}

async function handleSheetsSpreadsheetUpdated(eventData: any): Promise<any> {
  logger.info('Processing Google Sheets spreadsheet updated:', eventData.spreadsheet_id)
  return { processed: true, type: 'sheets_spreadsheet_updated', spreadsheetId: eventData.spreadsheet_id }
}

async function handleSheetsCellUpdated(eventData: any): Promise<any> {
  logger.info('Processing Google Sheets cell updated:', eventData.cell_range)
  return { processed: true, type: 'sheets_cell_updated', cellRange: eventData.cell_range }
}

async function handleSheetsSheetCreated(eventData: any): Promise<any> {
  logger.info('Processing Google Sheets sheet created:', eventData.sheetName || eventData.sheet_id)

  const metadata = eventData.metadata || {}
  const timestamp = eventData.timestamp || new Date().toISOString()

  await triggerMatchingSheetsWorkflows('new_worksheet', {
    spreadsheetId: eventData.spreadsheetId || metadata.spreadsheetId || null,
    sheetName: eventData.sheetName || eventData.sheet_name || null,
    sheetId: eventData.sheetId || eventData.sheet_id || null,
    timestamp
  }, metadata)

  return {
    processed: true,
    type: 'sheets_sheet_created',
    sheetId: eventData.sheetId || eventData.sheet_id,
    timestamp
  }
}

async function handleSheetsRowCreated(eventData: any): Promise<any> {
  logger.info('Processing Google Sheets new row:', eventData.sheetName, eventData.rowNumber)

  const metadata = eventData.metadata || {}
  const timestamp = eventData.timestamp || new Date().toISOString()
  const rowNumber = typeof eventData.rowNumber === 'number' ? eventData.rowNumber : null
  const rowIndex = typeof eventData.rowIndex === 'number'
    ? eventData.rowIndex
    : (rowNumber !== null ? rowNumber - 1 : null)
  const values = Array.isArray(eventData.values)
    ? eventData.values
    : (Array.isArray(eventData.data) ? eventData.data : [])
  const headers = Array.isArray(eventData.headers) ? eventData.headers : []

  await triggerMatchingSheetsWorkflows('new_row', {
    spreadsheetId: eventData.spreadsheetId || metadata.spreadsheetId || null,
    sheetName: eventData.sheetName || metadata.sheetName || null,
    sheetId: eventData.sheetId || metadata.sheetId || null,
    rowNumber,
    rowIndex,
    values,
    data: values,
    headers, // Pass headers for filtering
    timestamp
  }, metadata)

  return {
    processed: true,
    type: 'sheets_row_created',
    rowData: values,
    rowNumber,
    timestamp
  }
}

async function handleSheetsRowUpdated(eventData: any): Promise<any> {
  logger.info('Processing Google Sheets row updated:', eventData.sheetName)

  const metadata = eventData.metadata || {}
  const timestamp = eventData.timestamp || new Date().toISOString()
  const rowNumber = typeof eventData.rowNumber === 'number' ? eventData.rowNumber : null
  const headers = Array.isArray(eventData.headers) ? eventData.headers : []

  await triggerMatchingSheetsWorkflows('updated_row', {
    spreadsheetId: eventData.spreadsheetId || metadata.spreadsheetId || null,
    sheetName: eventData.sheetName || metadata.sheetName || null,
    sheetId: eventData.sheetId || metadata.sheetId || null,
    rowNumber,
    rowIndex: typeof eventData.rowIndex === 'number' ? eventData.rowIndex : null,
    values: Array.isArray(eventData.values)
      ? eventData.values
      : (Array.isArray(eventData.data) ? eventData.data : []),
    data: Array.isArray(eventData.values)
      ? eventData.values
      : (Array.isArray(eventData.data) ? eventData.data : []),
    headers, // Pass headers for filtering
    message: eventData.message || null,
    timestamp
  }, metadata)

  return {
    processed: true,
    type: 'sheets_row_updated',
    message: eventData.message,
    timestamp
  }
}

/**
 * Process Google event for a specific TEST SESSION only.
 *
 * This function is called from the test webhook endpoint (/api/webhooks/google/test/[sessionId])
 * and will ONLY process the event for the specified test session.
 *
 * It will NOT trigger any production workflows.
 *
 * @param event - The Google webhook event with test session info
 */
export async function processGoogleEventForTestSession(event: {
  service: string
  eventData: any
  requestId: string
  testSessionId: string
  testSession: any
}): Promise<any> {
  const { service, eventData, requestId, testSessionId, testSession } = event

  logger.info('[Test Session] Google test webhook received', {
    requestId,
    testSessionId,
    service,
    hasEventData: !!eventData,
    eventKeys: eventData ? Object.keys(eventData).slice(0, 12) : []
  })

  logger.info(`🧪 [Test Session] Processing ${service} event for session ${testSessionId}`)

  try {
    const supabase = await createSupabaseServiceClient()

    // Store the webhook event with test session reference
    await supabase
      .from('webhook_events')
      .insert({
        provider: 'google-test',
        service,
        event_data: eventData,
        request_id: requestId,
        status: 'received',
        timestamp: new Date().toISOString()
      })

    // Get workflow data from test_mode_config
    const testConfig = testSession.test_mode_config as any
    if (!testConfig?.nodes) {
      logger.error(`🧪 [Test Session] No workflow nodes in test_mode_config for session ${testSessionId}`)
      return { processed: false, error: 'No workflow configuration in test session' }
    }

    const workflow = {
      id: testSession.workflow_id,
      user_id: testSession.user_id,
      nodes: testConfig.nodes,
      connections: testConfig.connections || [],
      name: testConfig.workflowName || 'Test Workflow'
    }

    // Update test session status to executing
    await supabase
      .from('workflow_test_sessions')
      .update({ status: 'executing' })
      .eq('id', testSessionId)

    // Create execution session using the advanced execution engine
    const executionEngine = new AdvancedExecutionEngine()
    const executionSession = await executionEngine.createExecutionSession(
      workflow.id,
      testSession.user_id,
      'webhook',
      {
        triggerData: eventData,
        source: 'google_test_webhook',
        testSessionId,
        isTestExecution: true
      }
    )

    // Update test session with execution ID
    await supabase
      .from('workflow_test_sessions')
      .update({
        execution_id: executionSession.id,
        status: 'executing'
      })
      .eq('id', testSessionId)

    // Execute the workflow with test data
    logger.info(`🧪 [Test Session] Starting workflow execution`, {
      workflowId: workflow.id,
      executionId: executionSession.id,
      testSessionId
    })

    // Execute workflow (this is similar to how production triggers work)
    await executionEngine.executeWorkflow(
      executionSession.id,
      workflow.nodes,
      workflow.connections,
      { triggerOutput: eventData }
    )

    logger.info(`🧪 [Test Session] Workflow execution complete for session ${testSessionId}`)

    return {
      processed: true,
      testSessionId,
      executionId: executionSession.id,
      service,
      isTestExecution: true
    }

  } catch (error) {
    logger.error(`🧪 [Test Session] Error processing event for session ${testSessionId}:`, error)

    // Update test session status to failed
    const supabase = await createSupabaseServiceClient()
    await supabase
      .from('workflow_test_sessions')
      .update({
        status: 'failed',
        ended_at: new Date().toISOString()
      })
      .eq('id', testSessionId)

    throw error
  }
} 
