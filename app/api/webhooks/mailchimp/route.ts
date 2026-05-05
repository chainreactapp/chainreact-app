import { NextRequest, NextResponse, after } from 'next/server'
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { logger } from '@/lib/utils/logger'
import { executeWebhookWorkflow } from '@/lib/webhooks/execute'

/**
 * Mailchimp Webhook Endpoint
 *
 * Handles webhook events from Mailchimp for workflow triggers.
 * Supports: subscribe, unsubscribe, profile updates, email changes, campaigns
 *
 * Event types:
 * - subscribe: New subscriber added
 * - unsubscribe: Subscriber unsubscribed
 * - profile: Profile updated
 * - upemail: Email address changed
 * - cleaned: Email cleaned (bounced)
 * - campaign: Campaign sent
 */

// Helper to create supabase client
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

export async function POST(request: NextRequest) {
  const testRunId = process.env.WEBHOOK_TEST_MODE === 'true'
    ? request.headers.get('x-test-run-id')
    : null
  const requestId = testRunId || crypto.randomUUID()
  const supabase = getSupabase()

  try {
    logger.info('[Mailchimp Webhook] Received webhook event')

    // Mailchimp sends data as form-encoded
    const formData = await request.formData()
    const eventType = formData.get('type') as string

    logger.info(`[Mailchimp Webhook] Event type: ${eventType}`)

    // Extract workflow and node IDs from query params
    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')
    const nodeId = searchParams.get('nodeId')

    // Build payload from form data
    const payload: any = {}
    formData.forEach((value, key) => {
      payload[key] = value
    })

    logger.debug('[Mailchimp Webhook] Received payload with keys:', Object.keys(payload).join(', '))

    // Map Mailchimp event to trigger type
    const triggerMapping: Record<string, string> = {
      'subscribe': 'mailchimp_trigger_new_subscriber',
      'unsubscribe': 'mailchimp_trigger_unsubscribed',
      'profile': 'mailchimp_trigger_subscriber_updated',
      'upemail': 'mailchimp_trigger_subscriber_updated',
      'campaign': 'mailchimp_trigger_new_campaign'
    }

    const triggerType = triggerMapping[eventType]

    if (!triggerType) {
      logger.info(`[Mailchimp Webhook] Ignoring event type: ${eventType}`)
      return jsonResponse({ received: true, ignored: true })
    }

    // Transform payload to standard format
    const transformedPayload = transformMailchimpPayload(eventType, payload)

    // Store webhook event for audit trail (canonical receipt contract)
    try {
      await supabase.from('webhook_events').insert({
        provider: 'mailchimp',
        request_id: requestId,
        event_data: { ...transformedPayload, _meta: { originalRequestId: requestId } },
        status: 'received',
        timestamp: new Date().toISOString(),
      })
    } catch (e) {
      logger.warn('[Mailchimp Webhook] Failed to store webhook event:', e)
    }

    // Primary matching: trigger_resources (canonical path)
    const { data: resources } = await supabase
      .from('trigger_resources')
      .select('workflow_id, user_id')
      .eq('provider_id', 'mailchimp')
      .eq('trigger_type', triggerType)
      .eq('status', 'active')

    if (resources && resources.length > 0) {
      logger.info(`[Mailchimp Webhook] Found ${resources.length} matching trigger resources`)
      let executed = 0
      for (const resource of resources) {
        const result = await executeWebhookWorkflow({
          workflowId: resource.workflow_id,
          userId: resource.user_id,
          provider: 'mailchimp',
          triggerType,
          triggerData: transformedPayload,
          metadata: { requestId },
        })
        if (result.success && !result.duplicate) executed++
      }
      return jsonResponse({ received: true, processed: executed })
    }

    // Fallback: legacy per-workflow query param path or workflow node search
    await triggerWorkflowsForEvent(triggerType, transformedPayload, requestId, workflowId, nodeId)

    return jsonResponse({ received: true, requestId })
  } catch (error: any) {
    logger.error('[Mailchimp Webhook] Handler error:', error)
    return errorResponse('Internal server error', 500)
  }
}

// Handle GET requests for webhook verification
export async function GET(request: NextRequest) {
  logger.info('[Mailchimp Webhook] Received verification request')

  // Mailchimp doesn't use verification challenges like some providers
  // Just return 200 OK
  return new NextResponse('OK', { status: 200 })
}

/**
 * Transform Mailchimp webhook payload to standard format
 */
function transformMailchimpPayload(eventType: string, payload: any): any {
  const baseData = {
    email: payload['data[email]'] || payload.email,
    audienceId: payload['data[list_id]'] || payload.list_id,
    timestamp: new Date().toISOString()
  }

  switch (eventType) {
    case 'subscribe':
      return {
        ...baseData,
        firstName: payload['data[merges][FNAME]'],
        lastName: payload['data[merges][LNAME]'],
        status: 'subscribed',
        subscriberId: payload['data[id]'],
        source: payload['data[source]'] || 'webhook',
        ipAddress: payload['data[ip_opt]']
      }

    case 'unsubscribe':
      return {
        ...baseData,
        firstName: payload['data[merges][FNAME]'],
        lastName: payload['data[merges][LNAME]'],
        reason: payload['data[reason]'],
        campaignId: payload['data[campaign_id]'],
        subscriberId: payload['data[id]']
      }

    case 'profile':
    case 'upemail':
      return {
        ...baseData,
        firstName: payload['data[merges][FNAME]'],
        lastName: payload['data[merges][LNAME]'],
        status: payload['data[status]'],
        subscriberId: payload['data[id]'],
        eventType: eventType === 'upemail' ? 'email_changed' : 'profile_updated',
        oldEmail: payload['data[old_email]'],
        newEmail: payload['data[new_email]']
      }

    case 'campaign':
      return {
        campaignId: payload['data[id]'],
        title: payload['data[subject]'],
        subject: payload['data[subject]'],
        status: payload['data[status]'],
        sendTime: payload['data[send_time]'],
        ...baseData
      }

    default:
      return baseData
  }
}

/**
 * Trigger workflows that match this event
 */
async function triggerWorkflowsForEvent(
  triggerType: string,
  payload: any,
  eventId: string,
  workflowId?: string | null,
  nodeId?: string | null
) {
  const supabase = getSupabase()

  try {
    // If workflow ID provided, trigger that specific workflow
    if (workflowId && nodeId) {
      logger.info(`[Mailchimp Webhook] Triggering workflow ${workflowId}`)

      // Check if workflow is active
      const { data: workflow } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', workflowId)
        .eq('status', 'active')
        .single()

      if (!workflow) {
        logger.info(`[Mailchimp Webhook] Workflow ${workflowId} not found or inactive`)
        return
      }

      // PR-V2-WEBHOOK-MAILCHIMP: route through unified webhook dispatcher.
      // Dedup uses Mailchimp's per-event ID — Mailchimp re-sends the same
      // eventId on retries, so this is a stable cross-retry key.
      after(async () => {
        await executeWebhookWorkflow({
          workflowId,
          userId: workflow.user_id,
          provider: 'mailchimp',
          triggerType,
          triggerData: { ...payload, trigger: payload },
          metadata: { eventId, webhookEventId: eventId },
          dedupeKey: eventId,
        })
      })
    } else {
      // Find all matching workflows
      const { data: workflows } = await supabase
        .from('workflows')
        .select('*')
        .eq('status', 'active')
        .contains('nodes', [{ type: triggerType }])

      logger.info(`[Mailchimp Webhook] Found ${workflows?.length || 0} matching workflows`)

      // Execute each matching workflow via unified webhook dispatcher.
      // dedupeKey is built per-(workflow, event) so distinct workflows
      // get distinct keys for the same Mailchimp event but the SAME
      // workflow won't double-execute on retry (the dispatcher prepends
      // workflowId to dedupeKey internally).
      if (workflows && workflows.length > 0) {
        for (const workflow of workflows) {
          after(async () => {
            await executeWebhookWorkflow({
              workflowId: workflow.id,
              userId: workflow.user_id,
              provider: 'mailchimp',
              triggerType,
              triggerData: { ...payload, trigger: payload },
              metadata: { eventId, webhookEventId: eventId },
              dedupeKey: eventId,
            })
          })
        }
      }
    }
  } catch (error: any) {
    logger.error('[Mailchimp Webhook] Failed to trigger workflows:', error)
  }
}

