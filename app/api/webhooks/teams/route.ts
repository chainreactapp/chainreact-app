import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/utils/logger'
import { handleCorsPreFlight, addCorsHeaders } from '@/lib/utils/cors'
import { decryptResourceData } from '@/lib/utils/encryptionCertificate'
import { decrypt } from '@/lib/security/encryption'
import { executeWebhookWorkflow } from '@/lib/webhooks/execute'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

// Helper to create supabase client inside handlers
const getSupabase = () => createAdminClient()

/**
 * Microsoft Teams Webhook Endpoint
 *
 * Receives Microsoft Graph change notifications for Teams events
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatmessage
 *
 * Supported Events:
 * - New messages in channels
 * - New replies to messages
 * - New mentions
 * - New chats
 * - New chat messages
 * - New channels
 */

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request, {
    allowCredentials: false,
    allowedMethods: ['POST', 'OPTIONS'],
  })
}

export async function POST(request: NextRequest) {
  const testRunId = process.env.WEBHOOK_TEST_MODE === 'true'
    ? request.headers.get('x-test-run-id')
    : null
  const requestId = testRunId || crypto.randomUUID()

  // Entry-point log to catch ALL incoming requests (visible in production)
  logger.info('[Teams Webhook] POST received', {
    url: request.url,
    hasValidationToken: !!request.nextUrl.searchParams.get('validationToken')
  })

  try {
    // Microsoft Graph sends validationToken as a query param
    const validationToken = request.nextUrl.searchParams.get('validationToken')
    if (validationToken) {
      logger.info('[Teams Webhook] Received validation request')
      return new NextResponse(validationToken, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain'
        }
      })
    }

    const body = await request.json()

    // Store webhook event for audit trail (canonical receipt contract)
    const supabaseForReceipt = getSupabase()
    try {
      await supabaseForReceipt.from('webhook_events').insert({
        provider: 'teams',
        request_id: requestId,
        event_data: { ...body, _meta: { originalRequestId: requestId } },
        status: 'received',
        timestamp: new Date().toISOString(),
      })
    } catch (e) {
      logger.warn('[Teams Webhook] Failed to store webhook event:', e)
    }

    logger.info('[Teams Webhook] Received change notification:', {
      valueCount: body.value?.length || 0
    })

    // Process each notification in the batch
    const notifications = body.value || []

    for (const notification of notifications) {
      // Check if this is a lifecycle notification
      if (notification.lifecycleEvent) {
        await processLifecycleNotification(notification)
      } else {
        await processTeamsNotification(notification, requestId)
      }
    }

    // Return 202 Accepted to acknowledge receipt
    const response = NextResponse.json({ success: true }, { status: 202 })
    return addCorsHeaders(response, request, { allowCredentials: false })
  } catch (error: any) {
    logger.error('[Teams Webhook] Error processing webhook:', error)
    const response = NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    )
    return addCorsHeaders(response, request, { allowCredentials: false })
  }
}

export async function GET(request: NextRequest) {
  const validationToken = request.nextUrl.searchParams.get('validationToken')
  if (!validationToken) {
    return new NextResponse('Missing validation token', { status: 400 })
  }

  logger.info('[Teams Webhook] Received validation request (GET)')
  return new NextResponse(validationToken, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain'
    }
  })
}

/**
 * Process a single Teams change notification
 */
async function processTeamsNotification(notification: any, requestId?: string) {
  try {
    const { subscriptionId, changeType, resource, resourceData, encryptedContent } = notification

    logger.info('[Teams Webhook] Processing notification:', {
      subscriptionId,
      changeType,
      resource,
      hasEncryptedContent: !!encryptedContent
    })

    const supabase = createAdminClient()

    // Look up the trigger resource associated with this subscription
    // Query trigger_resources table (updated from webhook_configs for consistency)
    const { data: triggerResource, error: queryError } = await supabase
      .from('trigger_resources')
      .select('*')
      .eq('external_id', subscriptionId)
      .eq('provider', 'teams')
      .eq('status', 'active')
      .single()

    if (queryError || !triggerResource) {
      logger.warn('[Teams Webhook] No trigger resource found for subscription:', { subscriptionId, queryError: queryError?.message })
      return
    }

    // Check if this is a test subscription
    const isTestTrigger = triggerResource.is_test === true
    const testSessionId = triggerResource.test_session_id

    logger.info('[Teams Webhook] Found trigger resource:', {
      workflowId: triggerResource.workflow_id,
      isTestTrigger,
      testSessionId,
      triggerType: triggerResource.trigger_type
    })

    if (isTestTrigger) {
      logger.info('[Teams Webhook] Processing TEST trigger notification:', { testSessionId })
    }

    // Determine the trigger type based on the resource and changeType
    const triggerType = determineTriggerType(resource, changeType, triggerResource.trigger_type)

    // Parse the resource URL to extract IDs
    const resourceIds = parseTeamsResourceUrl(resource)

    // Get message data - either from encrypted content or via API call
    let messageData: any = null

    if (encryptedContent) {
      // We have encrypted resource data - decrypt it!
      logger.info('[Teams Webhook] Decrypting resource data')

      try {
        // Get the private key from trigger resource config
        const encryptedPrivateKey = triggerResource.config?.encryptedPrivateKey
        if (!encryptedPrivateKey) {
          logger.error('[Teams Webhook] No private key found in trigger resource config')
          throw new Error('No private key available for decryption')
        }

        // Decrypt the private key
        const privateKey = await decrypt(encryptedPrivateKey)

        // Decrypt the resource data
        messageData = decryptResourceData(
          encryptedContent.data,
          encryptedContent.dataSignature,
          encryptedContent.dataKey,
          privateKey
        )

        logger.info('[Teams Webhook] Successfully decrypted resource data')
      } catch (error: any) {
        logger.error('[Teams Webhook] Failed to decrypt resource data:', error)
        // Fall back to fetching via API
        messageData = null
      }
    }

    // Test-mode bypass: accept plaintext resourceData when WEBHOOK_TEST_MODE is enabled.
    // This skips encryption/API fetch, allowing the harness to test the processing pipeline.
    // Hard-gated: ignored entirely outside test mode.
    if (!messageData && process.env.WEBHOOK_TEST_MODE === 'true' && notification._testMessageData) {
      messageData = notification._testMessageData
      logger.info('[Teams Webhook] Using test-mode plaintext message data')
    }

    // If we don't have decrypted data, fetch it via API (fallback)
    if (!messageData && resourceIds.messageId) {
      logger.info('[Teams Webhook] Fetching message details via API')
      messageData = await fetchMessageDetails(
        triggerResource.workflow_id,
        resourceIds.teamId,
        resourceIds.channelId,
        resourceIds.chatId,
        resourceIds.messageId
      )
    }

    // Build trigger data based on notification type
    const triggerData = buildTriggerData(
      triggerType,
      resourceIds,
      messageData,
      notification
    )

    // For test triggers, store the result in the test session instead of executing workflow
    if (isTestTrigger && testSessionId) {
      logger.info('[Teams Webhook] Storing test trigger result for session:', testSessionId)

      const { error: updateError } = await supabase
        .from('workflow_test_sessions')
        .update({
          status: 'trigger_received',
          trigger_data: triggerData
        })
        .eq('id', testSessionId)

      if (updateError) {
        logger.error('[Teams Webhook] Failed to update test session:', { testSessionId, error: updateError.message })
      } else {
        logger.info('[Teams Webhook] Test trigger result stored successfully')
      }
      return
    }

    // Execute the workflow (production only)
    await executeWebhookWorkflow({
      workflowId: triggerResource.workflow_id,
      userId: triggerResource.user_id,
      provider: 'teams',
      triggerType: triggerType || triggerResource.trigger_type || 'teams_trigger_event',
      triggerData,
      metadata: { subscriptionId, changeType, requestId },
    })

    logger.info('[Teams Webhook] Successfully processed notification')
  } catch (error: any) {
    logger.error('[Teams Webhook] Error processing notification:', error)
  }
}

/**
 * Determine the trigger type from the resource URL
 */
function determineTriggerType(resource: string, changeType: string, configuredType: string): string {
  // Use the configured trigger type from webhook_configs
  return configuredType
}

/**
 * Parse Teams resource URL to extract IDs
 * Example: teams('xxx')/channels('yyy')/messages('zzz')
 */
function parseTeamsResourceUrl(resource: string): {
  teamId?: string
  channelId?: string
  chatId?: string
  messageId?: string
} {
  const result: any = {}

  // Extract team ID
  const teamMatch = resource.match(/teams\('([^']+)'\)/)
  if (teamMatch) result.teamId = teamMatch[1]

  // Extract channel ID
  const channelMatch = resource.match(/channels\('([^']+)'\)/)
  if (channelMatch) result.channelId = channelMatch[1]

  // Extract chat ID
  const chatMatch = resource.match(/chats\('([^']+)'\)/)
  if (chatMatch) result.chatId = chatMatch[1]

  // Extract message ID
  const messageMatch = resource.match(/messages\('([^']+)'\)/)
  if (messageMatch) result.messageId = messageMatch[1]

  return result
}

/**
 * Fetch full message details from Microsoft Graph API
 */
async function fetchMessageDetails(
  workflowId: string,
  teamId?: string,
  channelId?: string,
  chatId?: string,
  messageId?: string
): Promise<any> {
  try {
    const supabase = createAdminClient()

    // Get the workflow to find the user and integration
    const { data: workflow } = await supabase
      .from('workflows')
      .select('user_id')
      .eq('id', workflowId)
      .single()

    if (!workflow) return null

    // Get Teams integration
    const { data: integration } = await supabase
      .from('integrations')
      .select('access_token')
      .eq('user_id', workflow.user_id)
      .eq('provider', 'teams')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (!integration || !integration.access_token) return null

    const { decrypt } = await import('@/lib/security/encryption')
    const accessToken = await decrypt(integration.access_token)

    // Build the API endpoint
    let endpoint: string
    if (teamId && channelId && messageId) {
      endpoint = `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${messageId}`
    } else if (chatId && messageId) {
      endpoint = `https://graph.microsoft.com/v1.0/chats/${chatId}/messages/${messageId}`
    } else {
      return null
    }

    // Fetch message details
    const response = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      logger.error('[Teams Webhook] Failed to fetch message details:', await response.text())
      return null
    }

    return await response.json()
  } catch (error: any) {
    logger.error('[Teams Webhook] Error fetching message details:', error)
    return null
  }
}

/**
 * Build trigger data from notification
 */
function buildTriggerData(
  triggerType: string,
  resourceIds: any,
  messageData: any,
  notification: any
): any {
  const baseData = {
    ...resourceIds,
    timestamp: new Date().toISOString()
  }

  if (!messageData) return baseData

  // Common message fields
  const messageFields = {
    messageId: messageData.id,
    content: messageData.body?.content || '',
    senderId: messageData.from?.user?.id || '',
    senderName: messageData.from?.user?.displayName || '',
    timestamp: messageData.createdDateTime,
    attachments: messageData.attachments || []
  }

  switch (triggerType) {
    case 'teams_trigger_new_message':
      return {
        ...baseData,
        ...messageFields,
        channelId: resourceIds.channelId,
        channelName: messageData.channelIdentity?.displayName || ''
      }

    case 'teams_trigger_new_reply':
      return {
        ...baseData,
        replyId: messageData.id,
        parentMessageId: messageData.replyToId || '',
        content: messageData.body?.content || '',
        senderId: messageData.from?.user?.id || '',
        senderName: messageData.from?.user?.displayName || '',
        channelId: resourceIds.channelId,
        timestamp: messageData.createdDateTime
      }

    case 'teams_trigger_channel_mention':
      const mentions = messageData.mentions || []
      return {
        ...baseData,
        ...messageFields,
        mentionedUsers: mentions.filter((m: any) => m.mentioned?.user).map((m: any) => m.mentioned.user.id),
        mentionedKeywords: mentions.filter((m: any) => !m.mentioned?.user).map((m: any) => m.mentionText)
      }

    case 'teams_trigger_new_chat_message':
      return {
        ...baseData,
        messageId: messageData.id,
        chatId: resourceIds.chatId,
        content: messageData.body?.content || '',
        senderId: messageData.from?.user?.id || '',
        senderName: messageData.from?.user?.displayName || '',
        timestamp: messageData.createdDateTime
      }

    case 'teams_trigger_new_chat':
      return {
        ...baseData,
        chatId: resourceIds.chatId,
        chatType: messageData.chatType || 'unknown',
        topic: messageData.topic || '',
        createdDateTime: messageData.createdDateTime,
        members: messageData.members || []
      }

    case 'teams_trigger_new_channel':
      return {
        ...baseData,
        channelId: resourceIds.channelId,
        channelName: messageData.displayName || '',
        description: messageData.description || '',
        membershipType: messageData.membershipType || 'standard',
        createdDateTime: messageData.createdDateTime
      }

    default:
      return baseData
  }
}

/**
 * Process lifecycle notifications (reauthorizationRequired, subscriptionRemoved, missed)
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events
 */
async function processLifecycleNotification(notification: any) {
  try {
    const { subscriptionId, lifecycleEvent, subscriptionExpirationDateTime } = notification

    logger.info('[Teams Webhook] Received lifecycle notification:', {
      subscriptionId,
      lifecycleEvent,
      expirationDateTime: subscriptionExpirationDateTime
    })

    const supabase = createAdminClient()

    // Look up the trigger resource
    const { data: triggerResource, error: queryError } = await supabase
      .from('trigger_resources')
      .select('*')
      .eq('external_id', subscriptionId)
      .eq('provider', 'teams')
      .single()

    if (queryError || !triggerResource) {
      logger.warn('[Teams Webhook] No trigger resource found for subscription:', subscriptionId)
      return
    }

    switch (lifecycleEvent) {
      case 'reauthorizationRequired':
        // Subscription needs reauthorization (token expiring or permissions changed)
        logger.warn('[Teams Webhook] Reauthorization required for subscription:', subscriptionId)

        // Get the integration and renew the subscription
        const { data: integration } = await supabase
          .from('integrations')
          .select('access_token')
          .eq('user_id', triggerResource.user_id)
          .eq('provider', 'teams')
          .in('status', CONNECTED_STATUSES_LIST)
          .single()

        if (integration && integration.access_token) {
          const { decrypt } = await import('@/lib/security/encryption')
          const accessToken = await decrypt(integration.access_token)

          // Extend the subscription expiration
          const newExpiration = new Date()
          newExpiration.setMinutes(newExpiration.getMinutes() + 4230) // 3 days

          const response = await fetch(
            `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
            {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                expirationDateTime: newExpiration.toISOString()
              })
            }
          )

          if (response.ok) {
            // Update trigger resource with new expiration
            const updatedConfig = {
              ...(triggerResource.config || {}),
              expirationDateTime: newExpiration.toISOString()
            }

            await supabase
              .from('trigger_resources')
              .update({
                config: updatedConfig,
                updated_at: new Date().toISOString()
              })
              .eq('id', triggerResource.id)

            logger.info('[Teams Webhook] Subscription reauthorized and renewed:', subscriptionId)
          } else {
            logger.error('[Teams Webhook] Failed to reauthorize subscription:', await response.text())
          }
        }
        break

      case 'subscriptionRemoved':
        // Subscription was removed (usually due to auth failure)
        logger.error('[Teams Webhook] Subscription removed:', subscriptionId)

        // Mark trigger resource as deleted
        await supabase
          .from('trigger_resources')
          .update({
            status: 'deleted',
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', triggerResource.id)

        // TODO: Notify user that their workflow trigger is no longer active
        break

      case 'missed':
        // We missed some notifications (webhook was unreachable)
        logger.warn('[Teams Webhook] Missed notifications for subscription:', subscriptionId)
        // The notification will be retried by Microsoft Graph
        break

      default:
        logger.warn('[Teams Webhook] Unknown lifecycle event:', lifecycleEvent)
    }
  } catch (error: any) {
    logger.error('[Teams Webhook] Error processing lifecycle notification:', error)
  }
}

// Workflow execution is now handled by the shared executeWebhookWorkflow() helper
