import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import { requireExplicitField } from '../core/requireExplicitField'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Google Calendar delete event handler
 */
export async function deleteGoogleCalendarEvent(
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

    // Pass input directly, not wrapped in an object
    const resolvedConfig = needsResolution ? resolveValue(config, input) : config

    // Q11 — sendNotifications has user-facing side effects (auto-emails
    // attendees on event delete). Previous silent default 'none' removed —
    // the workflow author must explicitly choose. Existing workflows are
    // backfilled to 'none' (matches prior behavior) via the backfill registry.
    const missingRequired = requireExplicitField(resolvedConfig, 'sendNotifications')
    if (missingRequired) return missingRequired as unknown as ActionResult

    let {
      calendarId = 'primary',
      eventId,
      sendNotifications,
    } = resolvedConfig

    if (!eventId) {
      throw new Error('Event ID is required to delete an event')
    }

    // Check if an array was provided instead of a single event ID
    if (Array.isArray(eventId)) {
      throw new Error(
        'Multiple events detected. To delete multiple events, add a Loop node before this action and use {{loop.currentItem.eventId}} as the Event ID. If you want to delete only the first event, use {{list_events_node.events.0.eventId}} instead.'
      )
    }

    // Get the decrypted access token for Google
    const accessToken = await getDecryptedAccessToken(userId, "google-calendar")

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    // Create calendar API client
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

    // Get event details before deletion for the output
    const eventResponse = await calendar.events.get({
      calendarId: calendarId,
      eventId: eventId
    })

    const eventDetails = eventResponse.data

    // Determine send notifications parameter
    // Google Calendar API expects 'all', 'externalOnly', or 'none'
    const sendUpdates = sendNotifications === 'all' ? 'all'
      : sendNotifications === 'externalOnly' ? 'externalOnly'
      : 'none'

    // Delete the event with sendUpdates parameter
    await calendar.events.delete({
      calendarId: calendarId,
      eventId: eventId,
      sendUpdates: sendUpdates as 'all' | 'externalOnly' | 'none'
    })

    logger.info('✅ [Google Calendar] Deleted event', {
      eventId: eventId,
      title: eventDetails.summary
    })

    return {
      success: true,
      output: {
        eventId: eventId,
        deleted: true,
        deletedAt: new Date().toISOString(),
        eventTitle: eventDetails.summary,
        eventStart: eventDetails.start,
        eventEnd: eventDetails.end,
        calendarId: calendarId
      }
    }
  } catch (error: any) {
    logger.error('❌ [Google Calendar] Error deleting event:', error)

    if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.code === 401) {
      throw new Error('Google Calendar authentication failed. Please reconnect your account.')
    }

    if (error.message?.includes('404') || error.code === 404) {
      throw new Error('Event not found. It may have already been deleted.')
    }

    throw error
  }
}
