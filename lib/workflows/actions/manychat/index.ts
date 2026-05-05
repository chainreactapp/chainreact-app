/**
 * ManyChat Action Handlers
 * Implements all ManyChat workflow actions
 */

import { ActionResult } from '../index'
import { createSupabaseServerClient } from '@/utils/supabase/server'
import { decrypt } from '@/lib/security/encryption'
import { createManyChatClient } from '@/lib/integrations/providers/manychat/client'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Helper: Get ManyChat client for user
 */
async function getManyChatClient(userId: string) {
  const supabase = await createSupabaseServerClient()

  const { data: integration, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'manychat')
    .in('status', CONNECTED_STATUSES_LIST)
    .single()

  if (error || !integration) {
    throw new Error('ManyChat integration not found or not connected')
  }

  const apiKey = decrypt(integration.access_token)
  return createManyChatClient(apiKey)
}

/**
 * Send Message
 * Send a text message to a subscriber
 */
export async function sendManyChatMessage(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Send Message] Config:', config)

    const client = await getManyChatClient(userId)

    const subscriberId = parseInt(config.subscriberId || input.subscriberId, 10)
    const message = config.message || input.message

    if (!subscriberId || !message) {
      throw new Error('Subscriber ID and message are required')
    }

    await client.sendMessage({
      subscriber_id: subscriberId,
      text: message,
      message_tag: config.messageTag,
    })

    logger.info(`[ManyChat Send Message] Sent message to subscriber ${subscriberId}`)

    return {
      success: true,
      output: {
        subscriberId,
        message,
        sentAt: new Date().toISOString(),
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Send Message] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to send message',
    }
  }
}

/**
 * Send Flow
 * Send a flow to a subscriber
 */
export async function sendManyChatFlow(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Send Flow] Config:', config)

    const client = await getManyChatClient(userId)

    const subscriberId = parseInt(config.subscriberId || input.subscriberId, 10)
    const flowNs = config.flowNs || input.flowNs

    if (!subscriberId || !flowNs) {
      throw new Error('Subscriber ID and flow namespace are required')
    }

    await client.sendFlow({
      subscriber_id: subscriberId,
      flow_ns: flowNs,
    })

    logger.info(`[ManyChat Send Flow] Sent flow ${flowNs} to subscriber ${subscriberId}`)

    return {
      success: true,
      output: {
        subscriberId,
        flowNs,
        sentAt: new Date().toISOString(),
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Send Flow] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to send flow',
    }
  }
}

/**
 * Set Custom Field
 * Set a custom field value for a subscriber
 */
export async function setManyChatCustomField(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Set Custom Field] Config:', config)

    const client = await getManyChatClient(userId)

    const subscriberId = parseInt(config.subscriberId || input.subscriberId, 10)
    const fieldId = parseInt(config.fieldId || input.fieldId, 10)
    const fieldValue = config.fieldValue || input.fieldValue

    if (!subscriberId || !fieldId || fieldValue === undefined) {
      throw new Error('Subscriber ID, field ID, and field value are required')
    }

    await client.setCustomField({
      subscriber_id: subscriberId,
      field_id: fieldId,
      field_value: fieldValue,
    })

    logger.info(`[ManyChat Set Custom Field] Set field ${fieldId} for subscriber ${subscriberId}`)

    return {
      success: true,
      output: {
        subscriberId,
        fieldId,
        fieldValue,
        updatedAt: new Date().toISOString(),
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Set Custom Field] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to set custom field',
    }
  }
}

/**
 * Get Subscriber Info
 * Retrieve subscriber information
 */
export async function getManyChatSubscriber(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Get Subscriber] Config:', config)

    const client = await getManyChatClient(userId)

    const subscriberId = parseInt(config.subscriberId || input.subscriberId, 10)

    if (!subscriberId) {
      throw new Error('Subscriber ID is required')
    }

    const subscriber = await client.getSubscriber(subscriberId)

    logger.info(`[ManyChat Get Subscriber] Retrieved subscriber ${subscriberId}`)

    return {
      success: true,
      output: {
        id: subscriber.id,
        firstName: subscriber.first_name,
        lastName: subscriber.last_name,
        name: subscriber.name,
        email: subscriber.email,
        phone: subscriber.phone,
        status: subscriber.status,
        subscribedAt: subscriber.subscribed,
        lastInteraction: subscriber.last_interaction,
        lastSeen: subscriber.last_seen,
        customFields: subscriber.custom_fields || {},
        tags: subscriber.tags || [],
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Get Subscriber] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to get subscriber',
    }
  }
}

/**
 * Add Tag
 * Add a tag to a subscriber
 */
export async function addManyChatTag(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Add Tag] Config:', config)

    const client = await getManyChatClient(userId)

    const subscriberId = parseInt(config.subscriberId || input.subscriberId, 10)
    const tagId = parseInt(config.tagId || input.tagId, 10)

    if (!subscriberId || !tagId) {
      throw new Error('Subscriber ID and tag ID are required')
    }

    await client.addTag({
      subscriber_id: subscriberId,
      tag_id: tagId,
    })

    logger.info(`[ManyChat Add Tag] Added tag ${tagId} to subscriber ${subscriberId}`)

    return {
      success: true,
      output: {
        subscriberId,
        tagId,
        addedAt: new Date().toISOString(),
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Add Tag] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to add tag',
    }
  }
}

/**
 * Remove Tag
 * Remove a tag from a subscriber
 */
export async function removeManyChatTag(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Remove Tag] Config:', config)

    const client = await getManyChatClient(userId)

    const subscriberId = parseInt(config.subscriberId || input.subscriberId, 10)
    const tagId = parseInt(config.tagId || input.tagId, 10)

    if (!subscriberId || !tagId) {
      throw new Error('Subscriber ID and tag ID are required')
    }

    await client.removeTag({
      subscriber_id: subscriberId,
      tag_id: tagId,
    })

    logger.info(`[ManyChat Remove Tag] Removed tag ${tagId} from subscriber ${subscriberId}`)

    return {
      success: true,
      output: {
        subscriberId,
        tagId,
        removedAt: new Date().toISOString(),
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Remove Tag] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to remove tag',
    }
  }
}

/**
 * Subscribe to Sequence
 * Subscribe a user to a sequence
 */
export async function subscribeManyChatSequence(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Subscribe Sequence] Config:', config)

    const client = await getManyChatClient(userId)

    const subscriberId = parseInt(config.subscriberId || input.subscriberId, 10)
    const sequenceId = parseInt(config.sequenceId || input.sequenceId, 10)

    if (!subscriberId || !sequenceId) {
      throw new Error('Subscriber ID and sequence ID are required')
    }

    await client.subscribeToSequence({
      subscriber_id: subscriberId,
      sequence_id: sequenceId,
    })

    logger.info(`[ManyChat Subscribe Sequence] Subscribed subscriber ${subscriberId} to sequence ${sequenceId}`)

    return {
      success: true,
      output: {
        subscriberId,
        sequenceId,
        subscribedAt: new Date().toISOString(),
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Subscribe Sequence] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to subscribe to sequence',
    }
  }
}

/**
 * Unsubscribe from Sequence
 * Unsubscribe a user from a sequence
 */
export async function unsubscribeManyChatSequence(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Unsubscribe Sequence] Config:', config)

    const client = await getManyChatClient(userId)

    const subscriberId = parseInt(config.subscriberId || input.subscriberId, 10)
    const sequenceId = parseInt(config.sequenceId || input.sequenceId, 10)

    if (!subscriberId || !sequenceId) {
      throw new Error('Subscriber ID and sequence ID are required')
    }

    await client.unsubscribeFromSequence({
      subscriber_id: subscriberId,
      sequence_id: sequenceId,
    })

    logger.info(`[ManyChat Unsubscribe Sequence] Unsubscribed subscriber ${subscriberId} from sequence ${sequenceId}`)

    return {
      success: true,
      output: {
        subscriberId,
        sequenceId,
        unsubscribedAt: new Date().toISOString(),
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Unsubscribe Sequence] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to unsubscribe from sequence',
    }
  }
}

/**
 * Find User by ID
 * Find a subscriber by their ID and return their info
 */
export async function findManyChatUser(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Find User] Config:', config)

    const client = await getManyChatClient(userId)

    const subscriberId = parseInt(config.subscriberId || input.subscriberId, 10)

    if (!subscriberId) {
      throw new Error('Subscriber ID is required')
    }

    const subscriber = await client.getSubscriber(subscriberId)

    logger.info(`[ManyChat Find User] Found subscriber ${subscriberId}`)

    return {
      success: true,
      output: {
        found: true,
        subscriber: {
          id: subscriber.id,
          firstName: subscriber.first_name,
          lastName: subscriber.last_name,
          name: subscriber.name,
          email: subscriber.email,
          phone: subscriber.phone,
          status: subscriber.status,
          subscribedAt: subscriber.subscribed,
          lastInteraction: subscriber.last_interaction,
          lastSeen: subscriber.last_seen,
          customFields: subscriber.custom_fields || {},
          tags: subscriber.tags || [],
        },
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Find User] Error:', error)

    // If user not found, return found: false instead of error
    if (error.message?.includes('not found') || error.message?.includes('404')) {
      return {
        success: true,
        output: {
          found: false,
          subscriberId: config.subscriberId || input.subscriberId,
        },
      }
    }

    return {
      success: false,
      error: error.message || 'Failed to find user',
    }
  }
}

/**
 * Find by Custom Field
 * Find subscribers by custom field value
 */
export async function findByManyChatCustomField(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Find by Custom Field] Config:', config)

    const client = await getManyChatClient(userId)

    const fieldId = parseInt(config.fieldId || input.fieldId, 10)
    const fieldValue = config.fieldValue || input.fieldValue

    if (!fieldId || !fieldValue) {
      throw new Error('Field ID and field value are required')
    }

    const subscribers = await client.findSubscriberByCustomField(fieldId, fieldValue)

    logger.info(`[ManyChat Find by Custom Field] Found ${subscribers.length} subscribers`)

    return {
      success: true,
      output: {
        found: subscribers.length > 0,
        count: subscribers.length,
        subscribers: subscribers.map(s => ({
          id: s.id,
          firstName: s.first_name,
          lastName: s.last_name,
          email: s.email,
          phone: s.phone,
        })),
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Find by Custom Field] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to find subscribers',
    }
  }
}

/**
 * Create Subscriber
 * Create a new subscriber in ManyChat
 */
export async function createManyChatSubscriber(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Create Subscriber] Config:', config)

    const client = await getManyChatClient(userId)

    const params: any = {}
    if (config.firstName || input.firstName) params.first_name = config.firstName || input.firstName
    if (config.lastName || input.lastName) params.last_name = config.lastName || input.lastName
    if (config.email || input.email) params.email = config.email || input.email
    if (config.phone || input.phone) params.phone = config.phone || input.phone
    if (config.whatsapp || input.whatsapp) params.whatsapp = config.whatsapp || input.whatsapp

    const subscriber = await client.createSubscriber(params)

    logger.info(`[ManyChat Create Subscriber] Created subscriber ${subscriber.id}`)

    return {
      success: true,
      output: {
        subscriberId: subscriber.id,
        firstName: subscriber.first_name,
        lastName: subscriber.last_name,
        email: subscriber.email,
        createdAt: subscriber.subscribed,
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Create Subscriber] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to create subscriber',
    }
  }
}

/**
 * Send Content
 * Send rich content (cards, galleries) to subscriber
 */
export async function sendManyChatContent(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Send Content] Config:', config)

    const client = await getManyChatClient(userId)

    const subscriberId = parseInt(config.subscriberId || input.subscriberId, 10)
    const contentType = config.contentType || input.contentType || 'card'
    const title = config.title || input.title
    const subtitle = config.subtitle || input.subtitle
    const imageUrl = config.imageUrl || input.imageUrl
    const buttonText = config.buttonText || input.buttonText
    const buttonUrl = config.buttonUrl || input.buttonUrl

    if (!subscriberId || !title) {
      throw new Error('Subscriber ID and title are required')
    }

    await client.sendContent({
      subscriber_id: subscriberId,
      content_type: contentType,
      title,
      subtitle,
      image_url: imageUrl,
      button_text: buttonText,
      button_url: buttonUrl,
    })

    logger.info(`[ManyChat Send Content] Sent ${contentType} to subscriber ${subscriberId}`)

    return {
      success: true,
      output: {
        subscriberId,
        contentType,
        sentAt: new Date().toISOString(),
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Send Content] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to send content',
    }
  }
}

/**
 * Send Dynamic Message
 * Send template-based message with variable substitution
 */
export async function sendManyChatDynamicMessage(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('[ManyChat Send Dynamic Message] Config:', config)

    const client = await getManyChatClient(userId)

    const subscriberId = parseInt(config.subscriberId || input.subscriberId, 10)
    const templateText = config.templateText || input.templateText
    const variablesJson = config.variables || input.variables

    if (!subscriberId || !templateText) {
      throw new Error('Subscriber ID and template text are required')
    }

    // Parse variables JSON
    let variables: Record<string, string> = {}
    if (variablesJson) {
      try {
        variables = typeof variablesJson === 'string' ? JSON.parse(variablesJson) : variablesJson
      } catch (e) {
        throw new Error('Invalid JSON in variables field')
      }
    }

    // Replace variables in template
    let renderedMessage = templateText
    for (const [key, value] of Object.entries(variables)) {
      renderedMessage = renderedMessage.replace(new RegExp(`{{${key}}}`, 'g'), String(value))
    }

    // Send the rendered message
    await client.sendMessage({
      subscriber_id: subscriberId,
      text: renderedMessage,
    })

    logger.info(`[ManyChat Send Dynamic Message] Sent to subscriber ${subscriberId}`)

    return {
      success: true,
      output: {
        subscriberId,
        message: renderedMessage,
        sentAt: new Date().toISOString(),
      },
    }
  } catch (error: any) {
    logger.error('[ManyChat Send Dynamic Message] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to send dynamic message',
    }
  }
}
