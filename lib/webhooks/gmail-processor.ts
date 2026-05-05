import { createSupabaseServiceClient } from '@/utils/supabase/server'
import { executeWebhookWorkflow } from '@/lib/webhooks/execute'
import { google } from 'googleapis'
import { getDecryptedAccessToken } from '@/lib/workflows/actions/core/getDecryptedAccessToken'
import { logInfo, logError, logSuccess, logWarning } from '@/lib/logging/backendLogger'
import { getAnthropicClient } from '@/lib/ai/anthropic-client'

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

interface GmailNotification {
  emailAddress: string
  historyId: string | number
}

export interface GmailWebhookEvent {
  eventData: any
  requestId: string
}

const processedGmailEvents = new Map<string, number>()
const GMAIL_DEDUPE_WINDOW_MS = 5 * 60 * 1000

type GmailTriggerFilters = {
  from: string[]
  subject: string
  subjectExactMatch?: boolean
  hasAttachment: 'any' | 'yes' | 'no'
  labelIds?: string[]
  aiContentFilter?: string
  aiFilterConfidence?: 'low' | 'medium' | 'high'
}

type TriggerResourcesConfig = {
  resourceId?: string
  emailAddress?: string
}

type WebhookConfigsConfig = {
  watch?: {
    historyId?: string
    emailAddress?: string
  }
}

type GmailConfigSource =
  | { source: 'trigger_resources'; configId: string; workflowId: string; workflowName: string; config: TriggerResourcesConfig & Record<string, unknown> }
  | { source: 'webhook_configs'; configId: string; workflowId: string; workflowName: string; config: WebhookConfigsConfig & Record<string, unknown> }

function buildGmailDedupeKey(workflowId: string, dedupeId: string) {
  return `${workflowId}-${dedupeId}`
}

function wasRecentlyProcessedGmail(workflowId: string, dedupeId: string): boolean {
  const key = buildGmailDedupeKey(workflowId, dedupeId)
  const processedAt = processedGmailEvents.get(key)
  if (!processedAt) return false

  if (Date.now() - processedAt < GMAIL_DEDUPE_WINDOW_MS) {
    return true
  }

  processedGmailEvents.delete(key)
  return false
}

function markGmailEventProcessed(workflowId: string, dedupeId: string) {
  const key = buildGmailDedupeKey(workflowId, dedupeId)
  processedGmailEvents.set(key, Date.now())

  if (processedGmailEvents.size > 1000) {
    const now = Date.now()
    for (const [k, timestamp] of processedGmailEvents.entries()) {
      if (now - timestamp > GMAIL_DEDUPE_WINDOW_MS) {
        processedGmailEvents.delete(k)
      }
    }
  }
}

function normalizeEmailString(value: string) {
  return value.trim().toLowerCase()
}

function normalizeFromFilters(rawConfig: any, savedOptions: any): string[] {
  const candidates: string[] = []

  const rawFrom = rawConfig?.from ?? rawConfig?.filters?.from ?? rawConfig?.sender

  if (Array.isArray(rawFrom)) {
    for (const entry of rawFrom) {
      if (!entry) continue
      if (typeof entry === 'string') {
        candidates.push(entry)
      } else if (typeof entry === 'object') {
        const value = entry?.value ?? entry?.email ?? entry?.address ?? entry?.label
        if (value) candidates.push(String(value))
      }
    }
  } else if (typeof rawFrom === 'object' && rawFrom !== null) {
    const value = rawFrom?.value ?? rawFrom?.email ?? rawFrom?.address ?? rawFrom?.label
    if (value) candidates.push(String(value))
  } else if (typeof rawFrom === 'string' && rawFrom.trim() !== '') {
    candidates.push(...rawFrom.split(',').map((token) => token.trim()).filter(Boolean))
  }

  if (candidates.length === 0) {
    const saved = savedOptions?.from
    if (Array.isArray(saved)) {
      for (const entry of saved) {
        if (!entry) continue
        if (typeof entry === 'string') {
          candidates.push(entry)
        } else if (typeof entry === 'object') {
          const value = entry?.value ?? entry?.email ?? entry?.address ?? entry?.label
          if (value) candidates.push(String(value))
        }
      }
    } else if (typeof saved === 'string' && saved.trim() !== '') {
      candidates.push(...saved.split(',').map((token) => token.trim()).filter(Boolean))
    }
  }

  const normalized = candidates
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  return Array.from(new Set(normalized))
}

function normalizeSubjectFilter(rawConfig: any): string {
  const subject = rawConfig?.subject ?? rawConfig?.filters?.subject ?? ''
  if (typeof subject === 'string') {
    return subject.trim()
  }
  return ''
}

function normalizeAttachmentFilter(rawConfig: any): 'any' | 'yes' | 'no' {
  const value = rawConfig?.hasAttachment ?? rawConfig?.filters?.hasAttachment
  if (value === 'yes' || value === 'no') return value
  return 'any'
}

function resolveGmailTriggerFilters(triggerNode: any): GmailTriggerFilters {
  const rawConfig = triggerNode?.data?.config || {}
  const savedOptions = triggerNode?.data?.savedDynamicOptions || triggerNode?.data?.savedOptions || {}

  // Extract labelIds from config (can be array or single value)
  let labelIds: string[] = []
  const rawLabelIds = rawConfig?.labelIds || rawConfig?.filters?.labelIds
  if (Array.isArray(rawLabelIds)) {
    labelIds = rawLabelIds.filter(Boolean)
  } else if (typeof rawLabelIds === 'string' && rawLabelIds.trim()) {
    labelIds = [rawLabelIds]
  }

  return {
    from: normalizeFromFilters(rawConfig, savedOptions),
    subject: normalizeSubjectFilter(rawConfig),
    subjectExactMatch: rawConfig?.subjectExactMatch ?? true, // Default to exact match
    hasAttachment: normalizeAttachmentFilter(rawConfig),
    labelIds: labelIds.length > 0 ? labelIds : undefined, // Only include if specified
    aiContentFilter: rawConfig?.aiContentFilter?.trim() || undefined,
    aiFilterConfidence: rawConfig?.aiFilterConfidence || 'medium'
  }
}

export async function processGmailEvent(event: GmailWebhookEvent): Promise<any> {
  const sessionId = `gmail-webhook-${Date.now()}`

  try {
    const eventInfo = {
      eventType: event.eventData.type,
      emailAddress: event.eventData.emailAddress,
      historyId: event.eventData.historyId,
      requestId: event.requestId
    }

    logger.info('🔍 [Gmail Processor] Processing Gmail event:', eventInfo)
    logInfo(sessionId, 'Gmail webhook event received', eventInfo)

    const supabase = await createSupabaseServiceClient()

    // Store the webhook event in the database
    const { data: storedEvent, error: storeError } = await supabase
      .from('webhook_events')
      .insert({
        provider: 'gmail',
        service: 'gmail',
        event_type: event.eventData.type || 'gmail_new_email',
        event_data: event.eventData,
        request_id: event.requestId,
        status: 'received',
        timestamp: new Date().toISOString()
      })
      .select()
      .single()

    if (storeError) {
      logger.error('Failed to store Gmail webhook event:', storeError)
    }

    // IMMEDIATELY trigger workflows that match this Gmail event
    await triggerMatchingGmailWorkflows(event)

    // Process Gmail event
    const result = await processGmailEventData(event)
    logSuccess(sessionId, 'Gmail webhook event processed successfully', result)
    return result
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error'
    logger.error('Error processing Gmail webhook event:', error)
    logError(sessionId, 'Failed to process Gmail webhook event', {
      error: errorMessage,
      stack: error?.stack
    })
    throw error
  }
}

async function processGmailEventData(event: GmailWebhookEvent): Promise<any> {
  const { eventData } = event
  
  // Handle different Gmail event types
  switch (eventData.type) {
    case 'gmail_new_email':
    case 'message.new':
      return await handleGmailNewMessage(eventData)
    case 'message.modified':
      return await handleGmailMessageModified(eventData)
    case 'message.deleted':
      return await handleGmailMessageDeleted(eventData)
    case 'label.added':
      return await handleGmailLabelAdded(eventData)
    case 'label.removed':
      return await handleGmailLabelRemoved(eventData)
    case 'attachment.added':
      return await handleGmailAttachmentAdded(eventData)
    default:
      logger.info('Unhandled Gmail event type:', eventData.type)
      return { processed: true, eventType: eventData.type }
  }
}

// Gmail event handlers
async function handleGmailNewMessage(eventData: any): Promise<any> {
  logger.info('Processing Gmail new message event')
  // Note: Real processing happens in triggerMatchingGmailWorkflows() before this is called
  return {
    processed: true,
    type: 'gmail_new_message'
  }
}

async function handleGmailMessageModified(eventData: any): Promise<any> {
  logger.info('Processing Gmail message modified:', eventData.message_id)
  return { 
    processed: true, 
    type: 'gmail_message_modified', 
    messageId: eventData.message_id 
  }
}

async function handleGmailMessageDeleted(eventData: any): Promise<any> {
  logger.info('Processing Gmail message deleted:', eventData.message_id)
  return { 
    processed: true, 
    type: 'gmail_message_deleted', 
    messageId: eventData.message_id 
  }
}

async function handleGmailLabelAdded(eventData: any): Promise<any> {
  logger.info('Processing Gmail label added:', eventData.label_id)
  return { 
    processed: true, 
    type: 'gmail_label_added', 
    labelId: eventData.label_id,
    messageId: eventData.message_id
  }
}

async function handleGmailLabelRemoved(eventData: any): Promise<any> {
  logger.info('Processing Gmail label removed:', eventData.label_id)
  return { 
    processed: true, 
    type: 'gmail_label_removed', 
    labelId: eventData.label_id,
    messageId: eventData.message_id
  }
}

async function handleGmailAttachmentAdded(eventData: any): Promise<any> {
  logger.info('Processing Gmail attachment added:', eventData.attachment_id)
  return { 
    processed: true, 
    type: 'gmail_attachment_added', 
    attachmentId: eventData.attachment_id,
    messageId: eventData.message_id
  }
}

/**
 * Shared helper: fetch a Gmail message by ID and parse into standard emailDetails shape.
 * Both fetchGmailMessageDetails() and fetchEmailDetails() use this to avoid duplication.
 */
async function parseGmailMessage(gmail: any, messageId: string): Promise<any> {
  const message = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full'
  })

  const headers = message.data.payload?.headers || []
  const emailDetails: any = {
    id: message.data.id,
    messageId: message.data.id,
    threadId: message.data.threadId,
    labelIds: message.data.labelIds,
    snippet: message.data.snippet,
    internalDate: message.data.internalDate
  }

  headers.forEach((header: any) => {
    const name = header.name.toLowerCase()
    if (name === 'from') emailDetails.from = header.value
    if (name === 'to') emailDetails.to = header.value
    if (name === 'cc') emailDetails.cc = header.value
    if (name === 'subject') emailDetails.subject = header.value
    if (name === 'date') emailDetails.date = header.value
    if (name === 'delivered-to') emailDetails.deliveredTo = header.value
  })

  emailDetails.hasAttachments = false
  if (message.data.payload?.parts) {
    emailDetails.hasAttachments = message.data.payload.parts.some(
      (part: any) => part.filename && part.filename.length > 0
    )
  }

  let body = ''
  if (message.data.payload?.parts) {
    for (const part of message.data.payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body += Buffer.from(part.body.data, 'base64').toString('utf-8')
      }
    }
  } else if (message.data.payload?.body?.data) {
    body = Buffer.from(message.data.payload.body.data, 'base64').toString('utf-8')
  }
  emailDetails.body = body

  return emailDetails
}

type RecoveryOutcome = 'RECOVERY_NONE' | 'RECOVERY_UNIQUE_MATCH' | 'RECOVERY_AMBIGUOUS' | 'RECOVERY_WEAK'

/**
 * Shared recovery helper: attempt to find the message that triggered a Pub/Sub notification
 * when gmail.users.history.list() returns no results.
 *
 * Conservative by design: false negatives are acceptable, false positives are not.
 * Returns a recovered message only when there is one uniquely high-confidence candidate.
 */
async function attemptMessageRecovery(
  gmail: any,
  emailAddress: string,
  publishTime: string | undefined,
  logSessionId: string
): Promise<{ emailDetails: any; outcome: RecoveryOutcome } | null> {
  try {
    logger.info('[Recovery] Attempting message recovery', { emailAddress })

    // Query recent inbox candidates (last 2 minutes)
    const twoMinutesAgo = Math.floor((Date.now() - 2 * 60 * 1000) / 1000)
    const messagesResponse = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      q: `after:${twoMinutesAgo}`,
      maxResults: 5
    })

    const messages = messagesResponse.data.messages
    if (!messages || messages.length === 0) {
      logger.info('[Recovery] outcome=RECOVERY_NONE — no recent inbox candidates')
      logInfo(logSessionId, 'Recovery outcome', { outcome: 'RECOVERY_NONE', reason: 'no recent inbox candidates' })
      return null
    }

    logger.info('[Recovery] Found candidates, scoring', { candidateCount: messages.length })

    // Parse the publish time for temporal correlation
    const pubTime = publishTime ? new Date(publishTime).getTime() : Date.now()

    // Score each candidate
    type ScoredCandidate = { emailDetails: any; score: number; signals: string[] }
    const scored: ScoredCandidate[] = []

    for (const msg of messages) {
      try {
        const emailDetails = await parseGmailMessage(gmail, msg.id)
        let score = 0
        const signals: string[] = []

        // Primary signal 1: freshness — internalDate within 90s of publish time
        const internalDate = emailDetails.internalDate ? parseInt(emailDetails.internalDate, 10) : 0
        const timeDiffMs = Math.abs(pubTime - internalDate)
        if (timeDiffMs <= 90_000) {
          score += 2
          signals.push(`fresh(${Math.round(timeDiffMs / 1000)}s)`)
        }

        // Primary signal 2: new-mail indicators — has both INBOX and UNREAD labels
        const labels: string[] = emailDetails.labelIds || []
        if (labels.includes('INBOX') && labels.includes('UNREAD')) {
          score += 2
          signals.push('inbox+unread')
        }

        // Supporting signal: recipient/header evidence
        // Not required (alias/BCC/forwarding can break this), but strengthens confidence
        const lowerEmail = emailAddress.toLowerCase()
        const toField = (emailDetails.to || '').toLowerCase()
        const ccField = (emailDetails.cc || '').toLowerCase()
        const deliveredTo = (emailDetails.deliveredTo || '').toLowerCase()
        if (toField.includes(lowerEmail) || ccField.includes(lowerEmail) || deliveredTo.includes(lowerEmail)) {
          score += 1
          signals.push('recipient-match')
        }

        scored.push({ emailDetails, score, signals })
      } catch (err: any) {
        logger.info('[Recovery] Failed to parse candidate message', { messageId: msg.id, error: err?.message })
      }
    }

    // A candidate is "strong" if it passes both primary signals (score >= 4)
    const strongCandidates = scored.filter(c => c.score >= 4)

    if (strongCandidates.length === 0) {
      // Check if there are any candidates that passed at least one primary signal
      const weakCandidates = scored.filter(c => c.score >= 2)
      const outcome: RecoveryOutcome = weakCandidates.length > 0 ? 'RECOVERY_WEAK' : 'RECOVERY_NONE'
      logger.info(`[Recovery] outcome=${outcome}`, {
        totalCandidates: scored.length,
        weakCandidates: weakCandidates.length,
        scores: scored.map(c => ({ score: c.score, signals: c.signals }))
      })
      logInfo(logSessionId, 'Recovery outcome', { outcome, totalCandidates: scored.length, weakCandidates: weakCandidates.length })
      return null
    }

    if (strongCandidates.length > 1) {
      logger.info('[Recovery] outcome=RECOVERY_AMBIGUOUS — multiple strong candidates', {
        strongCount: strongCandidates.length,
        scores: strongCandidates.map(c => ({ score: c.score, signals: c.signals }))
      })
      logInfo(logSessionId, 'Recovery outcome', { outcome: 'RECOVERY_AMBIGUOUS', strongCount: strongCandidates.length })
      return null
    }

    // Exactly 1 strong candidate
    const match = strongCandidates[0]
    logger.info('[Recovery] outcome=RECOVERY_UNIQUE_MATCH', {
      score: match.score,
      signals: match.signals,
      hasFrom: !!match.emailDetails.from,
      subjectLength: match.emailDetails.subject?.length || 0,
      hasAttachments: match.emailDetails.hasAttachments
    })
    logInfo(logSessionId, 'Recovery outcome', {
      outcome: 'RECOVERY_UNIQUE_MATCH',
      score: match.score,
      signals: match.signals
    })

    return { emailDetails: match.emailDetails, outcome: 'RECOVERY_UNIQUE_MATCH' }
  } catch (error: any) {
    logger.error('[Recovery] Failed during message recovery', { error: error?.message })
    logError(logSessionId, 'Recovery failed', { error: error?.message })
    return null
  }
}

type CheckpointOutcome = 'CHECKPOINT_ADVANCED_VIA_HISTORY' | 'CHECKPOINT_ADVANCED_VIA_RECOVERY' | 'CHECKPOINT_PRESERVED_UNCERTAIN'

/**
 * Shared helper: persist a new historyId checkpoint to the canonical source.
 * One place for checkpoint advancement policy and logging.
 */
async function updateStoredHistoryId(
  configSource: GmailConfigSource,
  newHistoryId: string,
  reason: CheckpointOutcome,
  logSessionId: string
): Promise<void> {
  const supabase = await createSupabaseServiceClient()

  logger.info(`[Checkpoint] ${reason}`, {
    workflowId: configSource.workflowId,
    newHistoryId,
    source: configSource.source,
    configId: configSource.configId
  })
  logInfo(logSessionId, `Checkpoint decision: ${reason}`, {
    workflowId: configSource.workflowId,
    newHistoryId,
    configId: configSource.configId
  })

  if (configSource.source === 'trigger_resources') {
    const { error: updateError } = await supabase
      .from('trigger_resources')
      .update({ config: { ...configSource.config, resourceId: newHistoryId } })
      .eq('id', configSource.configId)

    if (updateError) {
      logger.error('[Checkpoint] Failed to write historyId to trigger_resources', {
        workflowId: configSource.workflowId, workflowName: configSource.workflowName,
        configId: configSource.configId, newHistoryId, error: updateError.message
      })
      return
    }

    const { data: readBack } = await supabase
      .from('trigger_resources')
      .select('config')
      .eq('id', configSource.configId)
      .single()

    const persistedConfig = readBack?.config as Record<string, unknown> | null
    if (persistedConfig?.resourceId !== newHistoryId) {
      logger.error('[Checkpoint] Write-back verification failed in trigger_resources', {
        workflowId: configSource.workflowId, workflowName: configSource.workflowName,
        configId: configSource.configId, expected: newHistoryId, actual: persistedConfig?.resourceId
      })
    }
  } else {
    const existingWatch = (configSource.config as WebhookConfigsConfig).watch || {}
    const { error: updateError } = await supabase
      .from('webhook_configs')
      .update({ config: { ...configSource.config, watch: { ...existingWatch, historyId: newHistoryId } } })
      .eq('id', configSource.configId)

    if (updateError) {
      logger.error('[Checkpoint] Failed to write historyId to webhook_configs', {
        workflowId: configSource.workflowId, workflowName: configSource.workflowName,
        configId: configSource.configId, newHistoryId, error: updateError.message
      })
      return
    }

    const { data: readBack } = await supabase
      .from('webhook_configs')
      .select('config')
      .eq('id', configSource.configId)
      .single()

    const persistedConfig = readBack?.config as Record<string, unknown> | null
    const persistedWatch = persistedConfig?.watch as Record<string, unknown> | undefined
    if (persistedWatch?.historyId !== newHistoryId) {
      logger.error('[Checkpoint] Write-back verification failed in webhook_configs', {
        workflowId: configSource.workflowId, workflowName: configSource.workflowName,
        configId: configSource.configId, expected: newHistoryId, actual: persistedWatch?.historyId
      })
    }
  }
}

/**
 * Fetch Gmail message details using an integration's access token
 * This is used for test mode execution
 */
async function fetchGmailMessageDetails(
  integration: any,
  historyId: string | number,
  sessionId?: string
): Promise<any | null> {
  // Use provided sessionId or generate a new one
  const logSessionId = sessionId || `gmail-fetch-${Date.now()}`

  try {
    logInfo(logSessionId, 'Fetching Gmail message details', {
      integrationId: integration.id,
      historyId,
      userId: integration.user_id
    })

    logger.info(`🔍 [fetchGmailMessageDetails] Starting to fetch email for historyId: ${historyId}`)

    // Get decrypted access token
    const accessToken = await getDecryptedAccessToken(integration.user_id, "gmail")

    if (!accessToken) {
      const error = 'No access token available for Gmail integration'
      logger.error(`❌ [fetchGmailMessageDetails] ${error}`)
      logError(logSessionId, error, { userId: integration.user_id })
      return null
    }

    // Set up Gmail API client
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    // Get the user's email address
    const profile = await gmail.users.getProfile({ userId: 'me' })
    const emailAddress = profile.data.emailAddress

    logInfo(logSessionId, 'Gmail profile fetched', { emailAddress })
    logger.info(`📧 [fetchGmailMessageDetails] Gmail account: ${emailAddress}`)

    // Fetch recent history — broaden to include both messageAdded and labelAdded
    const startHistoryIdStr = String(historyId)
    logger.info('[fetchGmailMessageDetails] historyId used for history.list', {
      startHistoryId: startHistoryIdStr,
      integrationId: integration.id
    })

    const historyRequest: any = {
      userId: 'me',
      historyTypes: ['messageAdded', 'labelAdded'],
      startHistoryId: startHistoryIdStr
    }

    logInfo(logSessionId, 'Fetching Gmail history', historyRequest)
    const history = await gmail.users.history.list(historyRequest)

    const historyLength = history.data.history?.length || 0
    logger.info(`📚 [fetchGmailMessageDetails] History response:`, { historyLength })

    if (!history.data.history || history.data.history.length === 0) {
      logger.info('[fetchGmailMessageDetails] Empty history — attempting recovery', { historyId: startHistoryIdStr })
      logWarning(logSessionId, 'No history entries, attempting recovery', { historyId })

      const recovery = await attemptMessageRecovery(gmail, emailAddress || '', undefined, logSessionId)
      if (recovery && recovery.outcome === 'RECOVERY_UNIQUE_MATCH') {
        logger.info('[fetchGmailMessageDetails] Recovery succeeded', {
          hasFrom: !!recovery.emailDetails.from,
          subjectLength: recovery.emailDetails.subject?.length || 0
        })
        return recovery.emailDetails
      }

      logger.info('[fetchGmailMessageDetails] No confident recovery', { outcome: recovery?.outcome || 'null' })
      return null
    }

    // Expand extraction — include labelsAdded alongside messagesAdded
    const messageId = history.data.history
      ?.flatMap((entry: any) => [
        ...(entry.messagesAdded || []),
        ...(entry.labelsAdded || []),
        ...(entry.messages || [])
      ])
      ?.map((entry: any) => entry.message || entry)
      ?.find((msg: any) => msg?.id)?.id

    if (!messageId) {
      const message = 'No message ID found in Gmail history'
      logger.info(`ℹ️ [fetchGmailMessageDetails] ${message}`)
      logWarning(logSessionId, message, { historyLength: history.data.history.length })
      return null
    }

    logInfo(logSessionId, 'Found Gmail message', { messageId })
    logger.info(`📧 [fetchGmailMessageDetails] Found message ID: ${messageId}`)

    const emailDetails = await parseGmailMessage(gmail, messageId)

    logSuccess(logSessionId, 'Successfully fetched Gmail message details', {
      from: emailDetails.from,
      subject: emailDetails.subject,
      hasAttachments: emailDetails.hasAttachments
    })

    // SECURITY: Don't log email addresses or subject content (PII)
    logger.info(`✅ [fetchGmailMessageDetails] Successfully fetched email:`, {
      hasFrom: !!emailDetails.from,
      subjectLength: emailDetails.subject?.length || 0,
      hasAttachments: emailDetails.hasAttachments,
      bodyLength: emailDetails.body?.length || 0
    })

    return emailDetails
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error'
    logger.error(`❌ [fetchGmailMessageDetails] Failed to fetch email details:`, error)
    logError(logSessionId, 'Failed to fetch Gmail message details', {
      error: errorMessage,
      stack: error?.stack,
      historyId
    })
    return null
  }
}

async function fetchEmailDetails(
  notification: GmailNotification,
  userId: string,
  configSource: GmailConfigSource
): Promise<any | null> {
  const sessionId = `gmail-fetch-regular-${Date.now()}`

  try {
    logInfo(sessionId, 'Fetching email details for regular workflow', {
      historyId: notification.historyId,
      emailAddress: notification.emailAddress,
      userId,
      source: configSource.source,
      workflowId: configSource.workflowId
    })

    logger.info(`🔍 Fetching email details for historyId: ${notification.historyId}`)
    const accessToken = await getDecryptedAccessToken(userId, "gmail")

    if (!accessToken) {
      const error = 'No access token available for Gmail'
      logger.error(`❌ ${error}`, {
        workflowId: configSource.workflowId,
        workflowName: configSource.workflowName
      })
      logError(sessionId, error, { userId, workflowId: configSource.workflowId })
      return null
    }

    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    // Resolve emailAddress from correct config shape
    const configEmailAddress = configSource.source === 'trigger_resources'
      ? configSource.config.emailAddress
      : configSource.config.watch?.emailAddress

    if (configEmailAddress && configEmailAddress !== notification.emailAddress) {
      logger.info('[fetchEmailDetails] Email mismatch, skipping', {
        workflowId: configSource.workflowId,
        workflowName: configSource.workflowName,
        source: configSource.source
      })
      logWarning(sessionId, 'Gmail notification email does not match config', {
        workflowId: configSource.workflowId,
        expected: configEmailAddress,
        received: notification.emailAddress
      })
      return null
    }

    // Resolve historyId from correct config shape
    let startHistoryId: string | undefined

    if (configSource.source === 'trigger_resources') {
      startHistoryId = configSource.config.resourceId
        ? String(configSource.config.resourceId)
        : undefined
    } else {
      startHistoryId = configSource.config.watch?.historyId
        ? String(configSource.config.watch.historyId)
        : undefined
    }

    if (!startHistoryId) {
      logger.warn('[fetchEmailDetails] No stored historyId — skipping', {
        workflowId: configSource.workflowId,
        workflowName: configSource.workflowName,
        source: configSource.source,
        configId: configSource.configId,
        hasResourceId: configSource.source === 'trigger_resources'
          ? !!configSource.config.resourceId : false,
        hasWatchHistoryId: configSource.source === 'webhook_configs'
          ? !!configSource.config.watch?.historyId : false
      })
      logWarning(sessionId, 'No stored historyId', {
        workflowId: configSource.workflowId, source: configSource.source, configId: configSource.configId
      })
      return null
    }

    // 4a: Explicit historyId decision-state logging
    const notifHistoryId = String(notification.historyId)
    const storedBig = BigInt(startHistoryId)
    const notifBig = BigInt(notifHistoryId)
    const comparison = storedBig < notifBig ? 'STORED_BEHIND'
                     : storedBig === notifBig ? 'EQUAL'
                     : 'STORED_AHEAD'

    logger.info('[fetchEmailDetails] historyId state', {
      comparison,
      storedStartHistoryId: startHistoryId,
      notificationHistoryId: notifHistoryId,
      workflowId: configSource.workflowId,
      workflowName: configSource.workflowName,
      source: configSource.source
    })
    logInfo(sessionId, 'historyId state', { comparison, storedStartHistoryId: startHistoryId, notificationHistoryId: notifHistoryId })

    // 4b: Handle non-behind states
    // When STORED_AHEAD, the stored checkpoint was advanced past the notification's historyId.
    // This commonly happens when onActivate sets the checkpoint to the current historyId,
    // but Pub/Sub delivers a notification for a slightly earlier change.
    // Fix: use the notification's historyId to query history.list — it knows something
    // changed at that point. Then advance the checkpoint to the higher value.
    if (comparison === 'STORED_AHEAD') {
      logger.info(`[fetchEmailDetails] STORED_AHEAD — querying from notification historyId instead`, {
        workflowId: configSource.workflowId,
        storedStartHistoryId: startHistoryId,
        notificationHistoryId: notifHistoryId
      })
      // Override startHistoryId with the notification's value so history.list finds the change
      startHistoryId = notifHistoryId
      // Fall through to the normal history.list path below
    } else if (comparison === 'EQUAL') {
      logger.info(`[fetchEmailDetails] EQUAL — attempting recovery`, {
        workflowId: configSource.workflowId
      })

      const recovery = await attemptMessageRecovery(gmail, notification.emailAddress, undefined, sessionId)
      if (recovery && recovery.outcome === 'RECOVERY_UNIQUE_MATCH') {
        await updateStoredHistoryId(configSource, notifHistoryId, 'CHECKPOINT_ADVANCED_VIA_RECOVERY', sessionId)
        return recovery.emailDetails
      }

      logger.info('[fetchEmailDetails] CHECKPOINT_PRESERVED_UNCERTAIN — no confident recovery', {
        workflowId: configSource.workflowId,
        recoveryResult: recovery?.outcome || 'null'
      })
      logInfo(sessionId, 'Checkpoint decision: CHECKPOINT_PRESERVED_UNCERTAIN', {
        workflowId: configSource.workflowId,
        comparison
      })
      return null
    }

    // 4c: Broaden history query — include both messageAdded and labelAdded
    const historyRequest: any = {
      userId: 'me',
      historyTypes: ['messageAdded', 'labelAdded'],
      startHistoryId: startHistoryId
    }

    logInfo(sessionId, 'Requesting Gmail history', historyRequest)
    const history = await gmail.users.history.list(historyRequest)

    const historyInfo = {
      historyLength: history.data.history?.length || 0
    }
    logger.info(`📚 History response:`, historyInfo)
    logInfo(sessionId, 'Gmail history response received', historyInfo)

    // 4e: Recover on empty history
    if (!history.data.history || history.data.history.length === 0) {
      logger.info('[fetchEmailDetails] Empty history despite STORED_BEHIND — attempting recovery', {
        workflowId: configSource.workflowId,
        startHistoryId,
        notificationHistoryId: notifHistoryId
      })

      const recovery = await attemptMessageRecovery(gmail, notification.emailAddress, undefined, sessionId)
      if (recovery && recovery.outcome === 'RECOVERY_UNIQUE_MATCH') {
        await updateStoredHistoryId(configSource, notifHistoryId, 'CHECKPOINT_ADVANCED_VIA_RECOVERY', sessionId)
        return recovery.emailDetails
      }

      logger.info('[fetchEmailDetails] CHECKPOINT_PRESERVED_UNCERTAIN — empty history, no confident recovery', {
        workflowId: configSource.workflowId,
        recoveryResult: recovery?.outcome || 'null'
      })
      logInfo(sessionId, 'Checkpoint decision: CHECKPOINT_PRESERVED_UNCERTAIN', {
        workflowId: configSource.workflowId,
        reason: 'empty_history_no_recovery'
      })
      return null
    }

    // 4d: Expand history result extraction — include labelsAdded alongside messagesAdded
    const messageId = history.data.history
      ?.flatMap((entry: any) => [
        ...(entry.messagesAdded || []),
        ...(entry.labelsAdded || []),
        ...(entry.messages || [])
      ])
      ?.map((entry: any) => entry.message || entry)
      ?.find((msg: any) => msg?.id)?.id

    if (!messageId) {
      const message = 'No message ID found in history entries'
      logger.info(message, { historyLength: history.data.history?.length })
      logWarning(sessionId, message, {
        historyLength: history.data.history?.length
      })
      return null
    }

    logger.info(`📧 Found message ID: ${messageId}`)
    logInfo(sessionId, 'Found Gmail message ID', { messageId })

    const emailDetails = await parseGmailMessage(gmail, messageId)

    logInfo(sessionId, 'Fetched full Gmail message', {
      messageId,
      threadId: emailDetails.threadId,
      labelCount: emailDetails.labelIds?.length || 0
    })

    // SECURITY: Don't log email addresses or subject content (PII)
    const summary = {
      hasFrom: !!emailDetails.from,
      subjectLength: emailDetails.subject?.length || 0,
      hasAttachments: emailDetails.hasAttachments,
      bodyLength: emailDetails.body?.length || 0
    }

    logger.info('📧 Fetched email details:', summary)
    logSuccess(sessionId, 'Successfully fetched email details', summary)

    // 4f: Normal history succeeded — advance checkpoint to the highest historyId
    if (history.data.historyId) {
      // When STORED_AHEAD triggered a re-query from the notification historyId,
      // ensure we don't regress the checkpoint below the original stored value.
      const apiHistoryId = String(history.data.historyId)
      const originalStoredId = configSource.source === 'trigger_resources'
        ? String(configSource.config.resourceId || '0')
        : String(configSource.config.watch?.historyId || '0')
      const advanceTo = BigInt(apiHistoryId) > BigInt(originalStoredId) ? apiHistoryId : originalStoredId
      await updateStoredHistoryId(configSource, advanceTo, 'CHECKPOINT_ADVANCED_VIA_HISTORY', sessionId)
    }

    return emailDetails
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error'
    logger.error('Failed to fetch email details:', error)
    logError(sessionId, 'Failed to fetch email details', {
      error: errorMessage,
      stack: error?.stack,
      historyId: notification.historyId
    })
    return null
  }
}

/**
 * Use AI to classify email content and determine if it matches the user's intent
 */
async function classifyEmailWithAI(
  email: any,
  intent: string,
  confidence: 'low' | 'medium' | 'high' = 'medium'
): Promise<{ matches: boolean; confidence: number; reasoning: string }> {
  const thresholds = {
    low: 50,
    medium: 70,
    high: 90
  }
  const requiredConfidence = thresholds[confidence]

  try {
    const anthropic = getAnthropicClient()

    const systemPrompt = `You are an email classification assistant. Analyze email content and determine if it matches the user's intent.

Respond with JSON:
{
  "matches": boolean,
  "confidence": number (0-100),
  "reasoning": string (brief explanation)
}

Understand context, tone, and implied meaning - not just keywords.`

    const userPrompt = `**User Intent:** ${intent}

**Email Subject:** ${email.subject || '(No subject)'}

**Email Body:**
${email.body || '(Empty email)'}

---

Does this email match the user's intent? Respond with JSON only.`

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 512,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude')
    }

    // Parse JSON response
    let jsonText = content.text.trim()
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '')
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '')
    }

    const result = JSON.parse(jsonText)

    // Apply threshold
    if (result.confidence < requiredConfidence) {
      return {
        matches: false,
        confidence: result.confidence,
        reasoning: `${result.reasoning} (Below ${requiredConfidence}% threshold)`
      }
    }

    // SECURITY: Log classification result without email content
    logger.info('🤖 AI Email Classification:', {
      matches: result.matches,
      confidence: result.confidence,
      threshold: requiredConfidence
    })

    return result

  } catch (error: any) {
    logger.error('AI email classification failed:', error)
    // Fail open - don't block emails if AI fails
    return {
      matches: true,
      confidence: 0,
      reasoning: `AI classification error: ${error.message}`
    }
  }
}

async function checkEmailMatchesFilters(email: any, filters: GmailTriggerFilters): Promise<boolean> {
  // SECURITY: Don't log email content (PII)
  logger.info('🔍 Checking email against filters:', {
    email: { hasFrom: !!email.from, subjectLength: email.subject?.length || 0, hasAttachments: email.hasAttachments },
    hasFilters: !!(filters.from || filters.subject || filters.labelIds)
  })

  // Check if email is in the configured folders/labels
  if (filters.labelIds && filters.labelIds.length > 0) {
    const emailLabelIds = email.labelIds || []
    const hasMatchingLabel = filters.labelIds.some(filterId =>
      emailLabelIds.includes(filterId)
    )

    if (!hasMatchingLabel) {
      logger.info(`❌ Folder filter mismatch: email labels [${emailLabelIds.join(', ')}] don't match configured labels [${filters.labelIds.join(', ')}]`)
      return false
    }

    logger.info(`✅ Folder filter matched: email is in one of the configured folders`)
  }

  if (filters.from && filters.from.length > 0) {
    const emailFromRaw = email.from || ''
    const emailLower = normalizeEmailString(emailFromRaw)
    const emailMatch = emailLower.match(/<(.+?)>/)
    const emailAddress = emailMatch ? emailMatch[1] : emailLower

    const normalizedFilters = filters.from.map(normalizeEmailString).filter(Boolean)

    if (normalizedFilters.length > 0) {
      const matches = normalizedFilters.some((filterToken) => {
        if (emailAddress === filterToken) return true
        if (emailLower.includes(filterToken)) return true
        return false
      })

      if (!matches) {
        logger.info(`❌ Sender filter mismatch: email didn't match ${normalizedFilters.length} filter(s)`)
        return false
      }

      logger.info(`✅ Sender filter matched: email matched one of ${normalizedFilters.length} filter(s)`)
    }
  }

  const subjectFilterRaw = typeof filters.subject === 'string' ? filters.subject.trim() : ''
  if (subjectFilterRaw) {
    const subjectFilter = subjectFilterRaw.toLowerCase()
    const emailSubject = (email.subject || '').toLowerCase().trim()
    const exactMatch = filters.subjectExactMatch !== false // Default to true

    const isMatch = exactMatch
      ? emailSubject === subjectFilter
      : emailSubject.includes(subjectFilter)

    if (!isMatch) {
      logger.info(`❌ Subject filter mismatch: subject length ${emailSubject.length} doesn't match filter (exactMatch: ${exactMatch})`)
      return false
    }
    logger.info(`✅ Subject filter matched: subject length ${emailSubject.length} matches filter (exactMatch: ${exactMatch})`)
  }

  if (filters.hasAttachment && filters.hasAttachment !== 'any') {
    const shouldHaveAttachment = filters.hasAttachment === 'yes'
    if (email.hasAttachments !== shouldHaveAttachment) {
      logger.info(`❌ Attachment filter mismatch: email has attachments=${email.hasAttachments}, filter expects=${shouldHaveAttachment}`)
      return false
    }
    logger.info(`✅ Attachment filter matched: ${shouldHaveAttachment ? 'has' : 'no'} attachments`)
  }

  // AI Content Filter - semantic email classification
  if (filters.aiContentFilter && filters.aiContentFilter.trim() !== '') {
    logger.info('🤖 AI Content Filter enabled, classifying email...')

    const aiResult = await classifyEmailWithAI(
      email,
      filters.aiContentFilter,
      filters.aiFilterConfidence || 'medium'
    )

    if (!aiResult.matches) {
      logger.info(`❌ AI filter mismatch: ${aiResult.reasoning}`)
      return false
    }

    logger.info(`✅ AI filter matched (${aiResult.confidence}%): ${aiResult.reasoning}`)
  }

  logger.info('✅ All filters matched!')
  return true
}

async function triggerMatchingGmailWorkflows(event: GmailWebhookEvent): Promise<void> {
  try {
    logger.info('🚀 [Gmail Processor] Starting to find matching workflows for Gmail event')
    const supabase = await createSupabaseServiceClient()

    // FIRST: Check for active test sessions waiting for Gmail triggers
    // Query without join - use test_mode_config for workflow data (avoids schema cache issues)
    logger.info('[Gmail] Querying for test sessions with trigger_type like gmail_trigger_%, status=listening')
    const { data: testSessions, error: sessionError } = await supabase
      .from('workflow_test_sessions')
      .select('*')
      .like('trigger_type', 'gmail_trigger_%')
      .in('status', ['listening'])

    if (sessionError) {
      logger.error('[Gmail] Error querying test sessions:', sessionError)
    }

    logger.info(`[Gmail] Test session query result: ${testSessions?.length || 0} sessions found`, {
      error: sessionError?.message,
      sessionCount: testSessions?.length || 0
    })

    if (!sessionError && testSessions && testSessions.length > 0) {
      logger.info(`[Gmail] Found ${testSessions.length} active test session(s) waiting for Gmail trigger`)

      for (const session of testSessions) {
        try {
          // Get workflow data from test_mode_config (stored when test session was created)
          const testConfig = session.test_mode_config as any
          let workflow: any = null

          if (testConfig?.nodes) {
            logger.info('[Gmail] Using test_mode_config for workflow data', { sessionId: session.id })
            workflow = {
              id: session.workflow_id,
              user_id: session.user_id,
              nodes: testConfig.nodes,
              connections: testConfig.connections || [],
              name: testConfig.workflowName || 'Unsaved Workflow'
            }
          } else {
            // Fallback: try to fetch workflow from DB using normalized tables
            logger.info('[Gmail] No test_mode_config, fetching workflow from DB', { workflowId: session.workflow_id })
            const [workflowResult, nodesResult, edgesResult] = await Promise.all([
              supabase.from('workflows').select('id, user_id, name').eq('id', session.workflow_id).single(),
              supabase.from('workflow_nodes').select('*').eq('workflow_id', session.workflow_id).order('display_order'),
              supabase.from('workflow_edges').select('*').eq('workflow_id', session.workflow_id)
            ])

            if (workflowResult.data) {
              // Convert to legacy format for execution engine
              const nodes = (nodesResult.data || []).map((node: any) => ({
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
              const connections = (edgesResult.data || []).map((edge: any) => ({
                id: edge.id,
                source: edge.source_node_id,
                target: edge.target_node_id,
                sourceHandle: edge.source_port_id || 'source',
                targetHandle: edge.target_port_id || 'target'
              }))
              workflow = {
                ...workflowResult.data,
                nodes,
                connections
              }
            }
          }

          if (!workflow) {
            logger.error('[Gmail] No workflow found in test_mode_config or database', { sessionId: session.id })
            continue
          }

          logger.info('[Gmail] Starting workflow execution for test session', {
            sessionId: session.id,
            workflowId: workflow.id,
            workflowName: workflow.name,
            userId: workflow.user_id,
            sessionUserId: session.user_id,
            fromTestConfig: !!testConfig?.nodes
          })

          // Use the user_id from the session (which is guaranteed to exist)
          const userId = session.user_id || workflow.user_id

          if (!userId) {
            logger.error('[Gmail] No userId found - cannot execute workflow', {
              sessionId: session.id,
              workflowId: workflow.id
            })
            continue
          }

          // For test sessions, DON'T execute the workflow here.
          // Instead, just fetch email details and store trigger data.
          // The frontend will call /api/workflows/execute-stream for real-time SSE updates.

          // Get email details first for proper context
          let emailDetails = null
          try {
            logger.info('[Gmail] Fetching Gmail integration for test session', {
              userId,
              provider: 'gmail'
            })

            const { data: integration } = await supabase
              .from('integrations')
              .select('*')
              .eq('user_id', userId)
              .eq('provider', 'gmail')
              .in('status', CONNECTED_STATUSES_LIST)
              .single()

            if (integration) {
              // Get the stored historyId from when the watch was created
              let triggerResource = null
              const { data: testTriggerResource } = await supabase
                .from('trigger_resources')
                .select('config')
                .eq('workflow_id', session.workflow_id)
                .like('trigger_type', 'gmail_trigger_%')
                .eq('test_session_id', session.id)
                .eq('status', 'active')
                .maybeSingle()

              if (testTriggerResource) {
                triggerResource = testTriggerResource
                logger.info('[Gmail] Found trigger_resource for test session', { sessionId: session.id })
              } else {
                // Fallback: get most recent trigger_resource for this workflow
                const { data: fallbackResource } = await supabase
                  .from('trigger_resources')
                  .select('config')
                  .eq('workflow_id', session.workflow_id)
                  .like('trigger_type', 'gmail_trigger_%')
                  .eq('status', 'active')
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()
                triggerResource = fallbackResource
                logger.info('[Gmail] Using fallback trigger_resource', { found: !!fallbackResource })
              }

              // Use stored historyId if available, otherwise fall back to notification's historyId
              const triggerConfig = triggerResource?.config as Record<string, unknown> | null
              const storedHistoryId = triggerConfig?.resourceId
              const historyIdToUse = storedHistoryId || event.eventData.historyId

              logger.info('[Gmail] Fetching email details', {
                notificationHistoryId: event.eventData.historyId,
                storedHistoryId,
                usingHistoryId: historyIdToUse
              })

              emailDetails = await fetchGmailMessageDetails(integration, historyIdToUse)

              if (emailDetails) {
                logger.info('[Gmail] Email details fetched successfully', {
                  hasFrom: !!emailDetails.from,
                  subjectLength: emailDetails.subject?.length || 0,
                  hasAttachments: emailDetails.hasAttachments
                })
              } else {
                logger.info('[Gmail] No email details could be fetched')
              }
            } else {
              logger.info('[Gmail] No connected Gmail integration found for user', { userId })
            }
          } catch (err: any) {
            const errorMessage = err?.message || 'Unknown error'
            logger.info('[Gmail] Could not fetch email details:', err)
          }

          // Build flattened trigger data for variable resolution
          const flattenedEmailData = emailDetails || {
            from: event.eventData.emailAddress,
            subject: 'New Email',
            body: '',
            content: '',
            to: '',
            date: new Date().toISOString(),
            hasAttachments: false
          }

          // Build trigger data to store in the test session
          const triggerData = {
            provider: 'gmail',
            emailAddress: event.eventData.emailAddress,
            historyId: event.eventData.historyId,
            timestamp: new Date().toISOString(),
            trigger: {
              type: session.trigger_type || 'gmail_trigger_new_email',
              from: flattenedEmailData.from,
              subject: flattenedEmailData.subject,
              body: flattenedEmailData.body || flattenedEmailData.content || '',
              to: flattenedEmailData.to,
              date: flattenedEmailData.date,
              hasAttachments: flattenedEmailData.hasAttachments,
              data: flattenedEmailData
            },
            emailDetails: emailDetails
          }

          // Store trigger data in test session - frontend will handle execution via SSE
          const { error: updateError } = await supabase
            .from('workflow_test_sessions')
            .update({
              status: 'trigger_received',
              trigger_data: triggerData
            })
            .eq('id', session.id)

          if (updateError) {
            logger.error('[Gmail] Failed to update test session with trigger data:', updateError)
          } else {
            logger.info('[Gmail] Trigger data stored in test session (execution deferred to frontend SSE)', {
              sessionId: session.id,
              workflowId: workflow.id,
              hasEmailDetails: !!emailDetails
            })
          }

        } catch (workflowError) {
          logger.error(`[Gmail] Failed to execute workflow for test session ${session.id}:`, workflowError)
        }
      }

      // If test sessions were found, don't process regular workflows
      logger.info('[Gmail] Test sessions processed, skipping regular workflow processing')
      return
    }

    // SECOND: Find all active workflows with Gmail webhook triggers (only if no test sessions)
    // Allow testing workflows that haven't been published yet by including drafts
    const { data: workflows, error } = await supabase
      .from('workflows')
      .select('id, user_id, name')
      .in('status', ['active', 'draft'])

    if (error) {
      logger.error('Failed to fetch workflows:', error)
      return
    }

    if (!workflows) return

    // Process each workflow
    for (const workflow of workflows) {
      // Load nodes from normalized table
      const { data: dbNodes } = await supabase
        .from('workflow_nodes')
        .select('*')
        .eq('workflow_id', workflow.id)
        .order('display_order')

      const nodes = (dbNodes || []).map((n: any) => ({
        id: n.id,
        type: n.node_type,
        position: { x: n.position_x, y: n.position_y },
        data: {
          type: n.node_type,
          label: n.label,
          nodeType: n.node_type,
          config: n.config || {},
          isTrigger: n.is_trigger,
          providerId: n.provider_id
        }
      }))

      // Find ALL Gmail trigger nodes (not just gmail_trigger_new_email)
      const gmailTriggerNodes = nodes.filter((node: any) => {
        const nodeType = node.data?.type || node.data?.nodeType || node.type || ''
        const isGmailTrigger =
          nodeType.startsWith('gmail_trigger_') ||
          node.data?.providerId === 'gmail'

        return node.data?.isTrigger && isGmailTrigger
      })

      if (gmailTriggerNodes.length === 0) continue

      // Get the actual trigger type from the node
      const triggerNode = gmailTriggerNodes[0]
      const triggerType = triggerNode.data?.type || triggerNode.data?.nodeType || triggerNode.type || 'gmail_trigger_new_email'

      logger.info(`[Gmail Processor] Found ${gmailTriggerNodes.length} Gmail trigger(s) in workflow ${workflow.id}`, {
        triggerType
      })

      // Primary: Check trigger_resources table (source of truth for lifecycle-managed triggers)
      // Match any Gmail trigger type for this workflow
      const { data: triggerResource, error: triggerError } = await supabase
        .from('trigger_resources')
        .select('id, config, trigger_type')
        .eq('workflow_id', workflow.id)
        .like('trigger_type', 'gmail_trigger_%')
        .eq('status', 'active')
        .or('is_test.is.null,is_test.eq.false')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (triggerError) {
        logger.error('Failed to fetch Gmail trigger resource:', triggerError)
        continue
      }

      let configSource: GmailConfigSource | null = null

      if (triggerResource) {
        logger.info('✅ Found Gmail trigger in trigger_resources table', {
          resourceTriggerType: triggerResource.trigger_type
        })
        configSource = {
          source: 'trigger_resources' as const,
          configId: triggerResource.id,
          workflowId: workflow.id,
          workflowName: workflow.name,
          config: (triggerResource.config || {}) as TriggerResourcesConfig & Record<string, unknown>
        }
      } else {
        // Fallback: Check webhook_configs table (legacy data)
        logger.info('⚠️ No trigger_resources found, checking webhook_configs as fallback...')
        const { data: configRows, error: configError } = await supabase
          .from('webhook_configs')
          .select('id, config')
          .eq('workflow_id', workflow.id)
          .like('trigger_type', 'gmail_trigger_%')
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)

        if (!configError && configRows?.[0]) {
          logger.info('✅ Found Gmail trigger in webhook_configs table (legacy)')
          configSource = {
            source: 'webhook_configs' as const,
            configId: configRows[0].id,
            workflowId: workflow.id,
            workflowName: workflow.name,
            config: (configRows[0].config || {}) as WebhookConfigsConfig & Record<string, unknown>
          }
        }
      }

      // Missing config source is a configuration integrity issue, not a routine skip
      if (!configSource) {
        logger.error('[Gmail Processor] Configuration integrity issue: no trigger_resources or webhook_configs for Gmail workflow', {
          workflowId: workflow.id,
          workflowName: workflow.name,
          triggerType
        })
        continue
      }

      // Test-mode bypass: accept inline trigger data when WEBHOOK_TEST_MODE is enabled.
      // This skips the Gmail API fetch, allowing the harness to test the processing pipeline.
      // Hard-gated: _testTriggerData is ignored entirely outside test mode.
      let emailDetails: any = null
      if (process.env.WEBHOOK_TEST_MODE === 'true' && event.eventData._testTriggerData) {
        emailDetails = event.eventData._testTriggerData
        logger.info('[Gmail Processor] Using test-mode inline trigger data')
      } else {
        // Fetch the actual email details via Gmail API
        emailDetails = await fetchEmailDetails(
          {
            historyId: event.eventData.historyId,
            emailAddress: event.eventData.emailAddress
          },
          workflow.user_id,
          configSource
        )
      }

      if (!emailDetails) {
        logger.info('Could not fetch email details, skipping workflow')
        continue
      }

      const dedupeToken = emailDetails.id || event.eventData.messageId || `${event.eventData.emailAddress || 'unknown'}-${event.eventData.historyId}`

      // Check if email matches any trigger's filters AND trigger-type-specific criteria
      let matchFound = false
      let matchedTriggerType = triggerType

      for (const tNode of gmailTriggerNodes) {
        const nodeType = tNode.data?.type || tNode.data?.nodeType || tNode.type || ''
        const filters = resolveGmailTriggerFilters(tNode)

        logger.info(`Checking trigger node ${tNode.id} (${nodeType}) filters:`, filters)

        // Trigger-type-specific pre-checks
        if (nodeType === 'gmail_trigger_new_attachment') {
          if (!emailDetails.hasAttachments) {
            logger.info(`  ❌ Skipping ${nodeType}: email has no attachments`)
            continue
          }
        } else if (nodeType === 'gmail_trigger_new_starred_email') {
          const labelIds = emailDetails.labelIds || []
          if (!labelIds.includes('STARRED')) {
            logger.info(`  ❌ Skipping ${nodeType}: email is not starred`)
            continue
          }
        } else if (nodeType === 'gmail_trigger_new_labeled_email') {
          const configuredLabel = tNode.data?.config?.labelId || tNode.data?.triggerConfig?.labelId || filters.label
          if (configuredLabel) {
            const labelIds = emailDetails.labelIds || []
            if (!labelIds.includes(configuredLabel)) {
              logger.info(`  ❌ Skipping ${nodeType}: email doesn't have label ${configuredLabel}`)
              continue
            }
          }
        }

        if (await checkEmailMatchesFilters(emailDetails, filters)) {
          matchFound = true
          matchedTriggerType = nodeType
          break
        }
      }

      if (!matchFound) {
        logger.info(`❌ Email doesn't match filters for workflow ${workflow.id}`)
        continue
      }

      if (dedupeToken && wasRecentlyProcessedGmail(workflow.id, dedupeToken)) {
        logger.info(`⚠️ Duplicate Gmail event detected for workflow ${workflow.id} and token ${dedupeToken}, skipping execution`)
        continue
      }

      // Email matches filters - trigger the workflow.
      // PR-V2-WEBHOOK-GMAIL: route through unified webhook dispatcher.
      // The local processedGmailEvents map stays as-is for the rollback-
      // on-error semantic (see catch below) — pass `skipDedup: true` to
      // the dispatcher so its own cache doesn't second-guess the local
      // dedup. dedupeToken still mediates the local map.
      try {
        logger.info(`🎯 Triggering workflow: "${workflow.name}" (${workflow.id})`)

        if (dedupeToken) {
          markGmailEventProcessed(workflow.id, dedupeToken)
        }

        // Build flattened trigger data for variable resolution
        const flattenedEmailData = emailDetails || {
          from: event.eventData.emailAddress,
          subject: 'New Email',
          body: '',
          content: ''
        }

        const triggerData = {
          ...event.eventData,
          emailDetails: emailDetails,
          trigger: {
            type: matchedTriggerType,
            from: flattenedEmailData.from,
            subject: flattenedEmailData.subject,
            body: flattenedEmailData.body || flattenedEmailData.content || '',
            to: flattenedEmailData.to,
            date: flattenedEmailData.date,
            hasAttachments: flattenedEmailData.hasAttachments,
            data: flattenedEmailData
          }
        }

        const dispatchResult = await executeWebhookWorkflow({
          workflowId: workflow.id,
          userId: workflow.user_id,
          provider: 'gmail',
          triggerType: matchedTriggerType,
          triggerData,
          metadata: {
            requestId: event.requestId,
            emailAddress: event.eventData.emailAddress,
          },
          skipDedup: true,
        })

        if (!dispatchResult.success) {
          throw new Error(dispatchResult.error || 'gmail dispatch failed')
        }

        logger.info(`✅ Successfully triggered workflow ${workflow.name} (${workflow.id}) with session ${dispatchResult.sessionId}`)
      } catch (workflowError) {
        logger.error(`Failed to trigger workflow ${workflow.id}:`, workflowError)
        if (dedupeToken) {
          processedGmailEvents.delete(buildGmailDedupeKey(workflow.id, dedupeToken))
        }
      }
    }
  } catch (error) {
    logger.error('Error triggering matching Gmail workflows:', error)
  }
} 
