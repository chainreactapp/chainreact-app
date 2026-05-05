import { NextRequest, NextResponse } from 'next/server'
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createClient } from '@supabase/supabase-js'
import { executeWebhookWorkflow } from '@/lib/webhooks/execute'
import { handleDropboxWebhookEvent } from '@/lib/webhooks/dropboxTriggerHandler'

import { logger } from '@/lib/utils/logger'

// Discord API helpers to resolve IDs to names
async function resolveDiscordChannelName(channelId: string, guildId: string): Promise<string | null> {
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: {
        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (response.ok) {
      const channel = await response.json()
      logger.info(`🏷️ Resolved channel ${channelId} to: ${channel.name}`)
      return channel.name || null
    }
  } catch (error) {
    logger.error(`Failed to resolve channel name for ${channelId}:`, error)
  }
  return null
}

async function resolveDiscordGuildName(guildId: string): Promise<string | null> {
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: {
        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (response.ok) {
      const guild = await response.json()
      logger.info(`🏷️ Resolved guild ${guildId} to: ${guild.name}`)
      return guild.name || null
    }
  } catch (error) {
    logger.error(`Failed to resolve guild name for ${guildId}:`, error)
  }
  return null
}

// Helper to create supabase client inside handlers
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

// In-memory cache to prevent duplicate Discord message processing
// This handles the race condition where two requests arrive nearly simultaneously
const discordMessageCache = new Map<string, { timestamp: number; requestId: string }>()

// Clean up old cache entries every 5 minutes
setInterval(() => {
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000)
  for (const [messageId, data] of discordMessageCache.entries()) {
    if (data.timestamp < fiveMinutesAgo) {
      discordMessageCache.delete(messageId)
    }
  }
}, 5 * 60 * 1000)

/**
 * PR-V2-WEBHOOK-PROVIDER: routes provider-specific webhook executions
 * through the unified webhook dispatcher. Dedup uses requestId as the
 * primary signal (per-request ID generated for the inbound webhook).
 *
 * Exported for tests.
 */
export async function dispatchProviderWebhook(
  workflow: { id: string; user_id: string },
  provider: string,
  triggerNode: any,
  transformedPayload: any,
  requestId: string,
): Promise<{ success: boolean; sessionId?: string; duplicate?: boolean; error?: string }> {
  try {
    const result = await executeWebhookWorkflow({
      workflowId: workflow.id,
      userId: workflow.user_id,
      provider,
      triggerType: triggerNode?.data?.type ?? `${provider}_webhook`,
      triggerData: transformedPayload,
      metadata: {
        requestId,
        providerId: provider,
      },
      dedupeKey: requestId,
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }
    return { success: true, sessionId: result.sessionId, duplicate: result.duplicate }
  } catch (dispatchError: any) {
    return { success: false, error: dispatchError?.message ?? 'dispatch threw' }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params
  const startTime = Date.now()

  // Generate unique request ID for tracking
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const logPrefix = `[${requestId}][${provider}]`

  logger.info(`🚀 ${logPrefix} Starting webhook processing for provider: ${provider}`)

  // Variables to track for error handling
  let workflow: any = null
  let payload: any = null
  let headers: any = {}

  try {
    // Get the raw body and headers
    const body = await request.text()
    headers = Object.fromEntries(request.headers.entries())

    // Parse JSON if possible
    try {
      payload = JSON.parse(body)
    } catch {
      payload = body
    }

    // Use console.log for critical Discord messages to ensure visibility
    if (provider === 'discord') {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('📥 DISCORD MESSAGE RECEIVED BY WORKFLOW ENDPOINT')
      console.log(`   Message ID: ${payload?.id || 'unknown'}`)
      console.log(`   Guild ID: ${payload?.guild_id || 'unknown'}`)
      console.log(`   Channel ID: ${payload?.channel_id || 'unknown'}`)
      console.log(`   Author: ${payload?.author?.username || 'unknown'}`)
      console.log(`   Content: ${payload?.content?.substring(0, 50) || 'empty'}${payload?.content?.length > 50 ? '...' : ''}`)
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    }

    logger.info(`📥 ${logPrefix} Received webhook from ${provider}:`, {
      headers: Object.keys(headers),
      payloadKeys: typeof payload === 'object' ? Object.keys(payload) : 'raw body',
      messageId: payload?.id || 'no-id',
      timestamp: new Date().toISOString()
    })

    // Special handling for Discord to prevent duplicate processing
    if (provider === 'discord' && payload?.id) {
      const cachedData = discordMessageCache.get(payload.id)
      if (cachedData && cachedData.requestId !== requestId) {
        const timeDiff = Date.now() - cachedData.timestamp
        if (timeDiff < 1000) { // Within 1 second is likely a duplicate
          logger.info(`⚡ ${logPrefix} Duplicate Discord message ${payload.id} detected (${timeDiff}ms apart), skipping`)
          return jsonResponse({
            success: true,
            message: 'Duplicate request ignored',
            messageId: payload.id
          })
        }
      }
      // Cache this message ID
      discordMessageCache.set(payload.id, { timestamp: Date.now(), requestId })
    }

    // Fetch workflows that match this provider trigger
    const supabase = getSupabase()

    // FIRST: Check for active test sessions that should receive this webhook
    // Test sessions allow testing unsaved workflows before they're saved to production
    const { data: testSessions } = await supabase
      .from('workflow_test_sessions')
      .select('id, workflow_id, user_id, status, test_mode_config')
      .eq('status', 'listening')

    if (testSessions && testSessions.length > 0 && provider === 'discord') {
      console.log(`🧪 Found ${testSessions.length} active test session(s) - will execute test workflows`)
    }

    const { data: workflows, error: workflowError } = await supabase
      .from('workflows')
      .select('id, name, user_id, status')
      .eq('status', 'active')

    if (workflowError) {
      logger.error(`${logPrefix} Error fetching workflows:`, workflowError)
      throw new Error('Failed to fetch workflows')
    }

    // If no saved workflows AND no test sessions, nothing to do
    if ((!workflows || workflows.length === 0) && (!testSessions || testSessions.length === 0)) {
      if (provider === 'discord') {
        console.log('⚠️ NO ACTIVE WORKFLOWS OR TEST SESSIONS FOUND')
        console.log('   To activate: Toggle the workflow status to "Active" or start a test')
      }
      logger.info(`${logPrefix} No active workflows or test sessions found`)
      return jsonResponse({
        success: true,
        message: 'No active workflows to process'
      })
    }

    if (provider === 'discord') {
      console.log(`📋 Found ${workflows?.length || 0} active workflow(s) and ${testSessions?.length || 0} test session(s)`)
      workflows?.forEach((w, i) => {
        console.log(`   ${i + 1}. Workflow: ${w.name} (${w.id}) - status: ${w.status}`)
      })
    }

    // Process each matching workflow
    const results = []
    for (const wf of workflows) {
      workflow = wf // Set for error handling

      // Load nodes from normalized table
      const { data: dbNodes, error: nodesError } = await supabase
        .from('workflow_nodes')
        .select('*')
        .eq('workflow_id', workflow.id)
        .order('display_order')

      if (provider === 'discord') {
        console.log(`🔍 Workflow ${workflow.id}: Loaded ${dbNodes?.length || 0} nodes`)
        if (nodesError) {
          console.log(`   ❌ Error loading nodes: ${nodesError.message}`)
        }
      }

      const workflowNodes = (dbNodes || []).map((n: any) => ({
        id: n.id,
        type: n.node_type,
        position: { x: n.position_x, y: n.position_y },
        data: {
          type: n.node_type,
          label: n.label,
          config: n.config || {},
          isTrigger: n.is_trigger,
          providerId: n.provider_id
        }
      }))

      // Find the trigger node for this provider
      const triggerNode = workflowNodes.find((node: any) =>
        node.data?.providerId === provider &&
        node.data?.isTrigger === true
      )

      if (provider === 'discord') {
        if (triggerNode) {
          logger.debug('Found Discord trigger:', triggerNode.data?.type)
          logger.debug('Trigger config present for node:', triggerNode.id)
        } else {
          logger.debug(`No Discord trigger node found in workflow ${workflow.id}`)
          const nodeTypes = workflowNodes.map((n: any) => `${n.data?.providerId}:${n.data?.type}:isTrigger=${n.data?.isTrigger}`)
          logger.debug(`Available nodes: ${nodeTypes.join(', ')}`)
        }
      }

      if (!triggerNode) {
        logger.info(`${logPrefix} No trigger node found for provider ${provider} in workflow ${workflow.id}, skipping`)
        continue
      }

      // Provider-specific trigger matching (check if the incoming event matches trigger configuration)
      if (provider === 'discord') {
        const triggerConfig = triggerNode.data?.config || {}
        const triggerType = triggerNode.data?.type

        logger.info(`${logPrefix} 🔍 Discord trigger matching for workflow ${workflow.id}:`, {
          triggerType,
          configuredGuildId: triggerConfig.guildId,
          configuredChannelId: triggerConfig.channelId,
          incomingGuildId: payload.guild_id,
          incomingChannelId: payload.channel_id
        })

        // Check guild ID match (required for all Discord triggers)
        if (triggerConfig.guildId && triggerConfig.guildId !== payload.guild_id) {
          console.log(`   ❌ Guild mismatch - configured: ${triggerConfig.guildId}, incoming: ${payload.guild_id}`)
          logger.info(`${logPrefix} ❌ Guild mismatch - configured: ${triggerConfig.guildId}, incoming: ${payload.guild_id}, skipping workflow ${workflow.id}`)
          continue
        }
        console.log(`   ✅ Guild match: ${payload.guild_id}`)

        // Check channel ID match for message triggers (if channel is configured)
        if (triggerType === 'discord_trigger_new_message') {
          if (triggerConfig.channelId && triggerConfig.channelId !== payload.channel_id) {
            console.log(`   ❌ Channel mismatch - configured: ${triggerConfig.channelId}, incoming: ${payload.channel_id}`)
            logger.info(`${logPrefix} ❌ Channel mismatch - configured: ${triggerConfig.channelId}, incoming: ${payload.channel_id}, skipping workflow ${workflow.id}`)
            continue
          }
          console.log(`   ✅ Channel check passed (configured: "${triggerConfig.channelId || 'any'}", incoming: ${payload.channel_id})`)

          // Check content filter if configured
          if (triggerConfig.contentFilter && Array.isArray(triggerConfig.contentFilter) && triggerConfig.contentFilter.length > 0) {
            const messageContent = (payload.content || '').toLowerCase()
            const matchesKeyword = triggerConfig.contentFilter.some((keyword: string) =>
              messageContent.includes(keyword.toLowerCase())
            )
            if (!matchesKeyword) {
              logger.info(`${logPrefix} ❌ Content filter mismatch - keywords: ${triggerConfig.contentFilter.join(', ')}, content: ${payload.content?.substring(0, 50)}..., skipping workflow ${workflow.id}`)
              continue
            }
          }

          // Check author filter if configured
          if (triggerConfig.authorFilter && triggerConfig.authorFilter !== payload.author?.id) {
            logger.info(`${logPrefix} ❌ Author filter mismatch - configured: ${triggerConfig.authorFilter}, incoming: ${payload.author?.id}, skipping workflow ${workflow.id}`)
            continue
          }
        }

        console.log(`   ✅ Discord trigger MATCHED for workflow ${workflow.id}!`)
        logger.info(`${logPrefix} ✅ Discord trigger matched for workflow ${workflow.id}!`)
      }

      // Transform payload for the workflow
      const transformedPayload = await transformPayloadForWorkflow(provider, payload, triggerNode)

      if (!transformedPayload) {
        logger.info(`${logPrefix} Ignoring webhook payload after transformation (empty payload) for workflow ${workflow.id}`)
        continue
      }

      // NOTE: We intentionally do NOT update test sessions here for ACTIVE workflows.
      // If a workflow is being executed via webhook because it's active, updating its
      // test sessions would cause duplicate execution (once here + once from frontend).
      // Test sessions are handled separately in the test session processing section below.

      try {
        logger.info(`${logPrefix} Starting workflow execution for workflow ${workflow.id}...`)
        const dispatchResult = await dispatchProviderWebhook(
          { id: workflow.id, user_id: workflow.user_id },
          provider,
          triggerNode,
          transformedPayload,
          requestId,
        )

        if (!dispatchResult.success) {
          throw new Error(dispatchResult.error || 'dispatch failed')
        }

        logger.info(`${logPrefix} Workflow execution completed for workflow ${workflow.id}`, {
          sessionId: dispatchResult.sessionId,
          duplicate: dispatchResult.duplicate,
        })

        // Log webhook execution
        await logWebhookExecution(workflow.id, provider, payload, headers, 'success', Date.now() - startTime)

        results.push({
          workflowId: workflow.id,
          sessionId: dispatchResult.sessionId ?? null,
          success: true,
          executionTime: Date.now() - startTime
        })
      } catch (workflowError: any) {
        logger.error(`${logPrefix} Error processing workflow ${workflow.id}:`, workflowError)
        await logWebhookExecution(workflow.id, provider, payload, headers, 'error', Date.now() - startTime, workflowError.message)

        results.push({
          workflowId: workflow.id,
          sessionId: null,
          success: false,
          error: workflowError.message,
          executionTime: Date.now() - startTime
        })
      }
    }

    // PROCESS TEST SESSIONS - Execute unsaved workflows from test mode
    // This allows testing triggers before saving the workflow
    if (testSessions && testSessions.length > 0) {
      for (const testSession of testSessions) {
        try {
          const testConfig = testSession.test_mode_config as any
          if (!testConfig?.nodes || !testConfig?.triggerNode) {
            console.log(`🧪 Test session ${testSession.id} has no valid config, skipping`)
            continue
          }

          // Find the trigger node from test config
          const triggerNode = testConfig.triggerNode
          if (triggerNode.data?.providerId !== provider) {
            continue // Skip test sessions for other providers
          }

          console.log(`🧪 Processing test session ${testSession.id} for workflow ${testSession.workflow_id}`)

          // Check if trigger matches (same logic as production workflows)
          if (provider === 'discord') {
            const triggerConfig = triggerNode.data?.config || {}
            const triggerType = triggerNode.data?.type

            // Check guild ID match
            if (triggerConfig.guildId && triggerConfig.guildId !== payload.guild_id) {
              console.log(`   🧪 Guild mismatch for test session, skipping`)
              continue
            }

            // Check channel ID match for message triggers
            if (triggerType === 'discord_trigger_new_message') {
              if (triggerConfig.channelId && triggerConfig.channelId !== payload.channel_id) {
                console.log(`   🧪 Channel mismatch for test session, skipping`)
                continue
              }
            }

            console.log(`   🧪 ✅ Discord trigger MATCHED for test session!`)
          }

          // Transform payload for the test workflow
          const transformedPayload = await transformPayloadForWorkflow(provider, payload, triggerNode)

          if (!transformedPayload) {
            continue
          }

          // Update test session with trigger data so SSE stream sees the update
          // NOTE: We do NOT execute the workflow here - the frontend will do that
          // after receiving the trigger_received event via the SSE stream.
          // This prevents duplicate execution (one here + one from frontend).
          await supabase
            .from('workflow_test_sessions')
            .update({
              status: 'trigger_received',
              trigger_data: transformedPayload,
            })
            .eq('id', testSession.id)
          console.log(`   🧪 ✅ Updated test session ${testSession.id} with trigger data (frontend will execute)`)

          results.push({
            workflowId: testSession.workflow_id,
            sessionId: null, // No execution session created here - frontend handles it
            success: true,
            executionTime: Date.now() - startTime,
            isTestSession: true,
            triggerDataReceived: true
          })

        } catch (testError: any) {
          console.error(`🧪 ❌ Error processing test session ${testSession.id}:`, testError)

          // Update test session with error
          await supabase
            .from('workflow_test_sessions')
            .update({
              status: 'failed',
              ended_at: new Date().toISOString(),
            })
            .eq('id', testSession.id)

          results.push({
            workflowId: testSession.workflow_id,
            sessionId: null,
            success: false,
            error: testError.message,
            executionTime: Date.now() - startTime,
            isTestSession: true
          })
        }
      }
    }

    // Return results
    if (results.length === 0) {
      return jsonResponse({
        success: true,
        message: 'No matching workflows found for this webhook'
      })
    }

    const successCount = results.filter(r => r.success).length
    return jsonResponse({
      success: successCount > 0,
      message: `Processed ${successCount} of ${results.length} workflows`,
      results
    })

  } catch (error: any) {
    logger.error(`${logPrefix} Fatal error processing webhook:`, error)

    // Log error if we have a workflow context
    if (workflow?.id) {
      await logWebhookExecution(workflow.id, provider, payload, headers, 'error', Date.now() - startTime, error.message)
    }

    return jsonResponse({
      success: false,
      error: error.message || 'Internal server error'
    }, { status: 500 })
  }
}

async function transformPayloadForWorkflow(provider: string, payload: any, triggerNode: any): Promise<any> {
  // Transform the external payload to match what the workflow expects
  // Get provider-specific transformations
  const providerTransformation = await getProviderSpecificTransformation(provider, payload)
  if (providerTransformation == null) {
    return null
  }

  const baseTransformation = {
    provider,
    timestamp: new Date().toISOString(),
    originalPayload: payload,
    triggerType: triggerNode.data?.type,
    // Add provider-specific transformations at top level for backward compatibility
    ...providerTransformation,
    // CRITICAL: Also add trigger data under 'trigger' key for {{trigger.fieldName}} variable resolution
    // The resolveValue function looks for input.trigger.fieldName when resolving {{trigger.fieldName}}
    trigger: providerTransformation
  }

  return baseTransformation
}

async function getProviderSpecificTransformation(provider: string, payload: any): Promise<any> {
  switch (provider) {
    case 'gmail':
      return {
        email: {
          subject: payload.subject || payload.snippet,
          from: payload.from || payload.sender,
          body: payload.body || payload.snippet,
          threadId: payload.threadId,
          messageId: payload.messageId
        }
      }
    
    case 'slack':
      {
        const event = payload?.event ?? payload
        if (!event) {
          return null
        }

        const subtype = event.subtype ?? payload?.subtype
        if (subtype === 'message_deleted') {
          logger.info('🧹 [Slack Workflow Webhook] Ignoring message_deleted event', {
            channel: event.channel ?? payload?.channel,
            ts: event.deleted_ts || event.ts || payload?.ts
          })
          return null
        }

        return {
          message: {
            text: event.text ?? payload?.text,
            channel: event.channel ?? payload?.channel,
            user: event.user ?? payload?.user,
            timestamp: event.ts ?? payload?.ts,
            threadTs: event.thread_ts ?? payload?.thread_ts,
            team: event.team ?? payload?.team ?? payload?.team_id
          }
        }
      }
    
    case 'discord':
      logger.debug('[Discord] Transforming payload for guild:', payload.guild_id)

      // Resolve Discord names from IDs
      const channelName = await resolveDiscordChannelName(payload.channel_id, payload.guild_id)
      const guildName = await resolveDiscordGuildName(payload.guild_id)

      // Return flat data structure that matches the outputSchema in discord node definition
      const transformedData = {
        messageId: payload.id || '',
        content: payload.content || '',
        authorId: payload.author?.id || '',
        authorName: payload.author?.username || payload.author?.global_name || payload.author?.display_name || 'Unknown User',
        channelId: payload.channel_id || '',
        channelName: channelName || `Channel ${payload.channel_id}`,
        guildId: payload.guild_id || '',
        guildName: guildName || `Server ${payload.guild_id}`,
        timestamp: payload.timestamp || new Date().toISOString(),
        attachments: payload.attachments || [],
        mentions: payload.mentions || []
      }
      logger.debug('[Discord] Transformed data keys:', Object.keys(transformedData || {}).join(', '))
      return transformedData
    
    case 'github':
      return {
        issue: {
          title: payload.issue?.title,
          body: payload.issue?.body,
          number: payload.issue?.number,
          state: payload.issue?.state
        },
        repository: payload.repository
      }
    
    case 'notion':
      return {
        page: {
          id: payload.page?.id,
          title: payload.page?.properties?.title,
          url: payload.page?.url
        }
      }
    
    case 'hubspot':
      return {
        contact: {
          id: payload.objectId,
          properties: payload.properties
        }
      }
    
    case 'airtable':
      return {
        record: {
          id: payload.id,
          fields: payload.fields,
          table: payload.table
        }
      }
    
    default:
      return {}
  }
}

async function logWebhookExecution(
  workflowId: string,
  provider: string,
  payload: any,
  headers: any,
  status: 'success' | 'error',
  executionTime: number,
  errorMessage?: string
): Promise<void> {
  try {
    await getSupabase()
      .from('webhook_executions')
      .insert({
        workflow_id: workflowId,
        trigger_type: `${provider}_trigger`,
        provider_id: provider,
        payload: payload,
        headers: headers,
        status: status,
        error_message: errorMessage,
        execution_time_ms: executionTime,
        created_at: new Date().toISOString()
      })
  } catch (error) {
    logger.error('Error logging webhook execution:', error)
  }
}
