import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import { requireExplicitField } from '../core/requireExplicitField'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Google Calendar move event handler
 * Moves an event from one calendar to another
 */
export async function moveGoogleCalendarEvent(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Resolve config values if they contain template variables
    const needsResolution = typeof config === 'object' &&
      Object.values(config).some(v =>
        typeof v === 'string' && v.includes('{{') && v.includes('}}')
      )

    const resolvedConfig = needsResolution ? resolveValue(config, input) : config

    // Q11 — sendNotifications has user-facing side effects (auto-emails
    // attendees on event move). Previous silent default 'all' removed.
    const missingRequired = requireExplicitField(resolvedConfig, 'sendNotifications')
    if (missingRequired) return missingRequired as unknown as ActionResult

    const {
      sourceCalendarId = 'primary',
      destinationCalendarId,
      eventId,
      sendNotifications,
    } = resolvedConfig

    if (!eventId) {
      throw new Error('Event ID is required to move an event')
    }

    // Check if an array was provided instead of a single event ID
    if (Array.isArray(eventId)) {
      throw new Error(
        'Multiple events detected. To move multiple events, add a Loop node before this action and use {{loop.currentItem.eventId}} as the Event ID. If you want to move only the first event, use {{list_events_node.events.0.eventId}} instead.'
      )
    }

    if (!destinationCalendarId) {
      throw new Error('Destination calendar ID is required')
    }

    if (sourceCalendarId === destinationCalendarId) {
      throw new Error('Source and destination calendars must be different')
    }

    // Get the decrypted access token for Google
    const accessToken = await getDecryptedAccessToken(userId, "google-calendar")

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    // Create calendar API client
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

    // Determine send notifications parameter
    let sendUpdates = 'none'
    if (sendNotifications === 'all') {
      sendUpdates = 'all'
    } else if (sendNotifications === 'externalOnly') {
      sendUpdates = 'externalOnly'
    }

    // Move the event
    const response = await calendar.events.move({
      calendarId: sourceCalendarId,
      eventId: eventId,
      destination: destinationCalendarId,
      sendUpdates: sendUpdates
    })

    const movedEvent = response.data

    logger.info('✅ [Google Calendar] Moved event', {
      eventId: eventId,
      from: sourceCalendarId,
      to: destinationCalendarId,
      title: movedEvent.summary
    })

    return {
      success: true,
      output: {
        eventId: movedEvent.id,
        htmlLink: movedEvent.htmlLink,
        summary: movedEvent.summary,
        description: movedEvent.description,
        location: movedEvent.location,
        start: movedEvent.start,
        end: movedEvent.end,
        sourceCalendarId: sourceCalendarId,
        destinationCalendarId: destinationCalendarId,
        movedAt: new Date().toISOString(),
        status: movedEvent.status
      }
    }
  } catch (error: any) {
    logger.error('❌ [Google Calendar] Error moving event:', error)

    if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.code === 401) {
      throw new Error('Google Calendar authentication failed. Please reconnect your account.')
    }

    if (error.message?.includes('404') || error.code === 404) {
      throw new Error('Event or calendar not found.')
    }

    throw error
  }
}
