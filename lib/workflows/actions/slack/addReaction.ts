/**
 * Slack Add Reaction Action
 * Adds an emoji reaction to a message in Slack
 */

import { ActionResult } from '../core/executeWait'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export async function addSlackReaction(params: {
  config: any
  userId: string
  input: Record<string, any>
}): Promise<ActionResult> {
  const { config, userId, input } = params

  try {
    const {
      channel,
      timestamp,
      emoji
    } = config

    // Validate required fields
    if (!channel) {
      throw new Error('Channel is required')
    }

    if (!timestamp) {
      throw new Error('Message timestamp is required')
    }

    if (!emoji) {
      throw new Error('Emoji is required')
    }

    // Clean up the emoji name - remove colons if present
    let cleanEmoji = emoji
    if (cleanEmoji.startsWith(':') && cleanEmoji.endsWith(':')) {
      cleanEmoji = cleanEmoji.slice(1, -1)
    }
    // Also remove any skin tone modifiers format issues
    cleanEmoji = cleanEmoji.replace(/^:/, '').replace(/:$/, '')

    // Ensure timestamp is in correct format (should have a decimal point)
    let formattedTimestamp = timestamp
    if (typeof timestamp === 'string' && !timestamp.includes('.')) {
      // If it's a number without decimal, try to format it
      // Slack timestamps are Unix time with microseconds: 1234567890.123456
      if (timestamp.length > 10) {
        formattedTimestamp = timestamp.slice(0, 10) + '.' + timestamp.slice(10)
      }
    }

    // Get the Slack integration
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )

    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('access_token')
      .eq('user_id', userId)
      .eq('provider', 'slack')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (integrationError || !integration) {
      throw new Error('Slack integration not found. Please connect your Slack account.')
    }

    if (!integration.access_token) {
      throw new Error('Slack access token not found. Please reconnect your Slack account.')
    }

    // Decrypt the token
    const { decryptToken } = await import('@/lib/integrations/tokenUtils')
    const accessToken = await decryptToken(integration.access_token)

    if (!accessToken) {
      throw new Error('Failed to decrypt Slack token. Please reconnect your Slack account.')
    }

    // Prepare the reaction request
    const reactionPayload = {
      channel: channel,
      timestamp: formattedTimestamp,
      name: cleanEmoji
    }

    logger.info('[Slack Add Reaction] Adding reaction:', {
      channel,
      timestamp: formattedTimestamp,
      emoji: cleanEmoji
    })

    // Helper function to call Slack API
    const callSlackApi = async (endpoint: string, payload: any) => {
      const response = await fetch(`https://slack.com/api/${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(payload)
      })
      return response.json()
    }

    // Call Slack API to add the reaction
    let result = await callSlackApi('reactions.add', reactionPayload)

    // If not in channel, try to join first then retry
    if (!result.ok && result.error === 'not_in_channel') {
      logger.info('[Slack Add Reaction] Bot not in channel, attempting to join:', channel)

      const joinResult = await callSlackApi('conversations.join', { channel })

      if (joinResult.ok) {
        logger.info('[Slack Add Reaction] Successfully joined channel, retrying reaction')
        // Retry the reaction after joining
        result = await callSlackApi('reactions.add', reactionPayload)
      } else {
        logger.error('[Slack Add Reaction] Failed to join channel:', joinResult.error)
        // If join fails (e.g., private channel), provide helpful error
        if (joinResult.error === 'method_not_supported_for_channel_type') {
          throw new Error('Cannot add reaction: This is a private channel. Please invite the Slack bot to this channel first.')
        } else if (joinResult.error === 'channel_not_found') {
          throw new Error('Channel not found. Please check the channel ID.')
        } else {
          throw new Error(`Cannot join channel to add reaction: ${joinResult.error}`)
        }
      }
    }

    if (!result.ok) {
      logger.error('[Slack Add Reaction] API error:', result.error)

      // Provide more helpful error messages
      let errorMessage = result.error || 'Unknown error'
      if (result.error === 'message_not_found') {
        errorMessage = 'Message not found. Please check the timestamp is correct (format: 1234567890.123456)'
      } else if (result.error === 'already_reacted') {
        errorMessage = 'You have already added this reaction to the message'
      } else if (result.error === 'channel_not_found') {
        errorMessage = 'Channel not found. Please check the channel ID.'
      } else if (result.error === 'invalid_name') {
        errorMessage = `Invalid emoji name: ${cleanEmoji}. Please use a valid emoji.`
      } else if (result.error === 'too_many_emoji') {
        errorMessage = 'Too many reactions on this message.'
      } else if (result.error === 'too_many_reactions') {
        errorMessage = 'You have added too many reactions to this message.'
      } else if (result.error === 'not_in_channel') {
        errorMessage = 'Bot is not in this channel and could not join automatically. Please invite the Slack bot to this channel first.'
      }

      throw new Error(`Slack API error: ${errorMessage}`)
    }

    return {
      success: true,
      output: {
        success: true,
        channel: channel,
        timestamp: formattedTimestamp,
        emoji: cleanEmoji,
        addedAt: new Date().toISOString()
      },
      message: `Reaction :${cleanEmoji}: added successfully`
    }

  } catch (error: any) {
    logger.error('[Slack Add Reaction] Error:', error)
    return {
      success: false,
      output: {
        success: false,
        error: error.message
      },
      message: `Failed to add reaction: ${error.message}`
    }
  }
}

// Export with the expected action name
export const slackActionAddReaction = addSlackReaction
