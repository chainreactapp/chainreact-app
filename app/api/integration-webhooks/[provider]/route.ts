import { NextResponse } from 'next/server'
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createClient } from '@supabase/supabase-js'
import { executeWebhookWorkflow } from '@/lib/webhooks/execute'

import { logger } from '@/lib/utils/logger'

export async function POST(
  request: Request,
  { params }: { params: { provider: string } }
) {
  const { provider } = params

  // Create client inside handler to avoid build-time initialization
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  try {
    // Get the raw body and headers
    const body = await request.text()
    const headers = Object.fromEntries(request.headers.entries())
    
    // Parse JSON if possible
    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      payload = body
    }

    logger.info(`📥 Received webhook from ${provider}:`, {
      headers: Object.keys(headers),
      payloadKeys: typeof payload === 'object' ? Object.keys(payload) : 'raw body',
      timestamp: new Date().toISOString()
    })

    // Find all active webhooks for this provider
    const { data: webhooks, error: webhookError } = await supabase
      .from('integration_webhooks')
      .select('*')
      .eq('provider_id', provider)
      .eq('status', 'active')

    if (webhookError) {
      logger.error(`Error fetching webhooks for ${provider}:`, webhookError)
      return errorResponse('Internal server error' , 500)
    }

    if (!webhooks || webhooks.length === 0) {
      logger.info(`No active webhooks found for provider: ${provider}`)
      return jsonResponse({ message: 'No active webhooks' }, { status: 200 })
    }

    // Process each webhook
    const results = []
    for (const webhook of webhooks) {
      try {
        const result = await processWebhook(webhook, payload, headers, provider)
        results.push(result)
      } catch (error) {
        logger.error(`Error processing webhook ${webhook.id}:`, error)
        results.push({ webhookId: webhook.id, success: false, error: error.message })
      }
    }

    return jsonResponse({
      success: true,
      processed: results.length,
      results
    })

  } catch (error: any) {
    logger.error(`Webhook error for ${provider}:`, error)
    return errorResponse('Internal server error' , 500)
  }
}

export async function GET(
  request: Request,
  { params }: { params: { provider: string } }
) {
  const { provider } = params
  
  return jsonResponse({
    message: "Integration webhook endpoint active",
    provider: provider,
    methods: ["POST"],
    timestamp: new Date().toISOString()
  })
}

async function processWebhook(
  webhook: any,
  payload: any,
  headers: any,
  provider: string
): Promise<any> {
  const startTime = Date.now()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  try {
    // Log the webhook execution
    const { data: execution, error: logError } = await supabase
      .from('integration_webhook_executions')
      .insert({
        webhook_id: webhook.id,
        user_id: webhook.user_id,
        provider_id: provider,
        trigger_type: determineTriggerType(provider, payload),
        payload: payload,
        headers: headers,
        status: 'pending',
        triggered_at: new Date().toISOString()
      })
      .select()
      .single()

    if (logError) {
      logger.error('Error logging webhook execution:', logError)
    }

    // Find workflows that use this provider's triggers
    const workflows = await findWorkflowsForProvider(webhook.user_id, provider)
    
    if (workflows.length === 0) {
      // Update execution status
      await supabase
        .from('integration_webhook_executions')
        .update({
          status: 'success',
          response_body: 'No workflows found for this trigger',
          execution_time_ms: Date.now() - startTime
        })
        .eq('id', execution.id)

      return {
        webhookId: webhook.id,
        success: true,
        message: 'No workflows found for this trigger'
      }
    }

    // PR-V2-WEBHOOK-INTEGRATION-WEBHOOKS: route through unified webhook
    // dispatcher. Dedup uses the integration_webhook_executions row id
    // (`execution.id`) — that's the per-inbound-event identifier the
    // route persists before fanning out to workflows.
    const workflowResults = []

    for (const workflow of workflows) {
      try {
        const transformedPayload = transformPayloadForWorkflow(provider, payload, workflow)

        const dispatchResult = await executeWebhookWorkflow({
          workflowId: workflow.id,
          userId: workflow.user_id,
          provider,
          triggerType: `${provider}_webhook`,
          triggerData: transformedPayload,
          metadata: {
            webhookExecutionId: execution.id,
            providerId: provider,
          },
          dedupeKey: execution.id,
        })

        workflowResults.push({
          workflowId: workflow.id,
          sessionId: dispatchResult.sessionId ?? null,
          success: dispatchResult.success,
          duplicate: dispatchResult.duplicate,
          ...(dispatchResult.error ? { error: dispatchResult.error } : {}),
        })

      } catch (error) {
        logger.error(`Error executing workflow ${workflow.id}:`, error)
        workflowResults.push({
          workflowId: workflow.id,
          success: false,
          error: error.message
        })
      }
    }

    // Update execution status
    await supabase
      .from('integration_webhook_executions')
      .update({
        status: 'success',
        response_body: JSON.stringify(workflowResults),
        execution_time_ms: Date.now() - startTime
      })
      .eq('id', execution.id)

    // Update webhook stats
    await supabase
      .from('integration_webhooks')
      .update({
        last_triggered: new Date().toISOString(),
        trigger_count: webhook.trigger_count + 1
      })
      .eq('id', webhook.id)

    return {
      webhookId: webhook.id,
      success: true,
      workflowsExecuted: workflowResults.length,
      results: workflowResults
    }

  } catch (error: any) {
    // Log error
    await supabase
      .from('integration_webhook_executions')
      .update({
        status: 'error',
        error_message: error.message,
        execution_time_ms: Date.now() - startTime
      })
      .eq('id', webhook.id)

    // Update webhook error count
    await supabase
      .from('integration_webhooks')
      .update({
        error_count: webhook.error_count + 1
      })
      .eq('id', webhook.id)

    throw error
  }
}

async function findWorkflowsForProvider(userId: string, provider: string): Promise<any[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  const { data: workflows, error } = await supabase
    .from('workflows')
    .select('id, name, user_id, status')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (error) {
    logger.error('Error fetching workflows:', error)
    return []
  }

  // Load nodes for each workflow and filter for this provider
  const matchingWorkflows: any[] = []

  for (const workflow of workflows || []) {
    try {
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
          config: n.config || {},
          isTrigger: n.is_trigger,
          providerId: n.provider_id
        }
      }))

      // Load edges from normalized table
      const { data: dbEdges } = await supabase
        .from('workflow_edges')
        .select('*')
        .eq('workflow_id', workflow.id)

      const connections = (dbEdges || []).map((e: any) => ({
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        sourceHandle: e.source_port_id || 'source',
        targetHandle: e.target_port_id || 'target'
      }))

      const hasMatchingTrigger = nodes.some((node: any) =>
        node.data?.providerId === provider &&
        node.data?.isTrigger === true
      )

      if (hasMatchingTrigger) {
        matchingWorkflows.push({ ...workflow, nodes, connections })
      }
    } catch {
      // Skip workflows with errors
    }
  }

  return matchingWorkflows
}

function determineTriggerType(provider: string, payload: any): string {
  // This would be more sophisticated based on the actual payload structure
  // For now, we'll use a simple mapping
  const triggerMappings: Record<string, string> = {
    'gmail': 'gmail_trigger_new_email',
    'slack': 'slack_trigger_new_message',
    'github': 'github_trigger_new_issue',
    'notion': 'notion_trigger_database_item_created',
    'hubspot': 'hubspot_trigger_new_contact',
    'airtable': 'airtable_trigger_new_record',
    'discord': 'discord_trigger_new_message'
  }

  return triggerMappings[provider] || `${provider}_trigger_event`
}

function transformPayloadForWorkflow(provider: string, payload: any, workflow: any): any {
  // Transform the external payload to match what the workflow expects
  // This would be more sophisticated based on the actual workflow structure
  
  const baseTransformation = {
    provider,
    timestamp: new Date().toISOString(),
    originalPayload: payload,
    // Add provider-specific transformations
    ...getProviderSpecificTransformation(provider, payload)
  }

  return baseTransformation
}

function getProviderSpecificTransformation(provider: string, payload: any): any {
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
      return {
        message: {
          text: payload.text,
          channel: payload.channel,
          user: payload.user,
          timestamp: payload.ts
        }
      }
    
    case 'github':
      return {
        issue: {
          title: payload.issue?.title,
          body: payload.issue?.body,
          number: payload.issue?.number,
          state: payload.issue?.state,
          user: payload.issue?.user?.login
        }
      }
    
    case 'notion':
      return {
        page: {
          title: payload.page?.properties?.title?.title?.[0]?.text?.content,
          url: payload.page?.url,
          id: payload.page?.id
        }
      }
    
    default:
      return {
        data: payload
      }
  }
} 