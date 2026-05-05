/**
 * Slack Add Reminder Action
 * Creates a reminder for a user in Slack
 */

import { ActionResult } from '../core/executeWait'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export async function addSlackReminder(params: {
  config: any
  userId: string
  input: Record<string, any>
}): Promise<ActionResult> {
  const { config, userId, input } = params

  try {
    const {
      text,
      timeType,
      relativeTime,
      relativeUnit,
      absoluteTime,
      naturalTime,
      userType,
      userId: targetUserId,
      recurring
    } = config

    // Validate required fields
    if (!text) {
      throw new Error('Reminder text is required')
    }

    // Calculate the reminder time based on timeType
    let time: string

    switch (timeType) {
      case 'relative': {
        if (!relativeTime || !relativeUnit) {
          throw new Error('Relative time and unit are required')
        }

        // Calculate Unix timestamp for the reminder
        const now = Math.floor(Date.now() / 1000)
        let seconds = parseInt(relativeTime, 10)

        switch (relativeUnit) {
          case 'minutes':
            seconds *= 60
            break
          case 'hours':
            seconds *= 60 * 60
            break
          case 'days':
            seconds *= 60 * 60 * 24
            break
          case 'weeks':
            seconds *= 60 * 60 * 24 * 7
            break
          default:
            throw new Error(`Invalid time unit: ${relativeUnit}`)
        }

        time = String(now + seconds)
        break
      }

      case 'absolute': {
        if (!absoluteTime) {
          throw new Error('Absolute time is required')
        }

        // Parse datetime-local format (YYYY-MM-DDTHH:mm)
        const date = new Date(absoluteTime)
        if (isNaN(date.getTime())) {
          throw new Error('Invalid date format')
        }

        // Ensure the time is in the future
        if (date.getTime() <= Date.now()) {
          throw new Error('Reminder time must be in the future')
        }

        time = String(Math.floor(date.getTime() / 1000))
        break
      }

      case 'natural': {
        if (!naturalTime) {
          throw new Error('Natural language time is required')
        }

        // Slack's API accepts natural language time strings directly
        time = naturalTime
        break
      }

      default:
        throw new Error(`Invalid time type: ${timeType}`)
    }

    // Get the Slack integration - we need the USER token for reminders API
    // The Reminders API requires a user token (xoxp-), not a bot token (xoxb-)
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )

    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('access_token, metadata')
      .eq('user_id', userId)
      .eq('provider', 'slack')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (integrationError || !integration) {
      throw new Error('Slack integration not found. Please connect your Slack account.')
    }

    // Check for user token in metadata (stored during OAuth callback)
    const metadata = integration.metadata as Record<string, any> | null
    const encryptedUserToken = metadata?.user_token

    let accessToken: string | null = null

    if (encryptedUserToken) {
      // Decrypt the user token from metadata
      const { decrypt } = await import('@/lib/security/encryption')
      const encryptionKey = process.env.ENCRYPTION_KEY!
      try {
        accessToken = decrypt(encryptedUserToken, encryptionKey)
        logger.info('[Slack Add Reminder] Using user token from metadata')
      } catch (e) {
        logger.error('[Slack Add Reminder] Failed to decrypt user token:', e)
      }
    }

    // If no user token, fall back to main access token (which might be a bot token)
    if (!accessToken && integration.access_token) {
      const { decryptToken } = await import('@/lib/integrations/tokenUtils')
      accessToken = await decryptToken(integration.access_token)
      logger.info('[Slack Add Reminder] Falling back to main access token')
    }

    if (!accessToken) {
      throw new Error('Slack access token not found. Please reconnect your Slack account.')
    }

    // Check if it's a bot token (will fail for reminders API)
    if (accessToken.startsWith('xoxb-')) {
      throw new Error(
        'The Slack Reminders API requires a user token. Please disconnect and reconnect your Slack account to grant user-level permissions (reminders:write scope).'
      )
    }

    // Prepare the reminder request
    const reminderPayload: Record<string, any> = {
      text,
      time
    }

    // Add user if reminding a specific user (not self)
    if (userType === 'specific' && targetUserId) {
      reminderPayload.user = targetUserId
    }

    logger.info('[Slack Add Reminder] Creating reminder:', {
      text,
      time,
      timeType,
      userType,
      hasTargetUser: !!targetUserId
    })

    // Call Slack API to add the reminder
    const response = await fetch('https://slack.com/api/reminders.add', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(reminderPayload)
    })

    const result = await response.json()

    if (!result.ok) {
      logger.error('[Slack Add Reminder] API error:', result.error)

      // Provide more helpful error messages
      let errorMessage = result.error || 'Unknown error'
      if (result.error === 'not_allowed_token_type') {
        errorMessage = 'The Slack Reminders API requires a user token (not a bot token). This feature is not available with the current Slack app configuration. Slack reminders can only be created by user tokens (xoxp-), not bot tokens (xoxb-).'
      } else if (result.error === 'cannot_add_bot') {
        errorMessage = 'Cannot create reminders for bots'
      } else if (result.error === 'cannot_add_others') {
        errorMessage = 'Cannot create reminders for other users. Check your permissions.'
      } else if (result.error === 'cannot_add_slackbot') {
        errorMessage = 'Cannot create reminders for Slackbot'
      } else if (result.error === 'cannot_parse') {
        errorMessage = 'Could not understand the time format. Try a different format like "tomorrow at 2pm" or "in 30 minutes".'
      } else if (result.error === 'user_not_found') {
        errorMessage = 'User not found. Please check the user ID.'
      } else if (result.error === 'missing_scope') {
        errorMessage = 'Missing required scope: reminders:write. Please reconnect your Slack account with the required permissions.'
      }

      throw new Error(`Slack API error: ${errorMessage}`)
    }

    const reminder = result.reminder

    return {
      success: true,
      output: {
        reminderId: reminder.id,
        text: reminder.text,
        time: new Date(reminder.time * 1000).toISOString(),
        user: reminder.user,
        creator: reminder.creator,
        recurring: reminder.recurring || false,
        completeTs: reminder.complete_ts,
        success: true
      },
      message: `Reminder created successfully: "${text}"`
    }

  } catch (error: any) {
    logger.error('[Slack Add Reminder] Error:', error)
    return {
      success: false,
      output: {
        success: false,
        error: error.message
      },
      message: `Failed to create reminder: ${error.message}`
    }
  }
}

// Export with the expected action name
export const slackActionAddReminder = addSlackReminder
