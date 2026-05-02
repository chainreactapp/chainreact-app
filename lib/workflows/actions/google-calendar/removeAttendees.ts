import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import { requireExplicitField } from '../core/requireExplicitField'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Google Calendar remove attendees handler
 */
export async function removeGoogleCalendarAttendees(
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
    // attendees on attendee changes). Previous silent default 'all' removed.
    const missingRequired = requireExplicitField(resolvedConfig, 'sendNotifications')
    if (missingRequired) return missingRequired as unknown as ActionResult

    const {
      calendarId = 'primary',
      eventId,
      attendeesToRemove,
      removeAllAttendees = false,
      sendNotifications,
    } = resolvedConfig

    if (!eventId) {
      throw new Error('Event ID is required to remove attendees')
    }

    // Check if an array was provided instead of a single event ID
    if (Array.isArray(eventId)) {
      throw new Error(
        'Multiple events detected. To remove attendees from multiple events, add a Loop node before this action and use {{loop.currentItem.eventId}} as the Event ID. If you want to remove attendees from only the first event, use {{list_events_node.events.0.eventId}} instead.'
      )
    }

    if (!removeAllAttendees && (!attendeesToRemove || (Array.isArray(attendeesToRemove) && attendeesToRemove.length === 0))) {
      throw new Error('At least one attendee email is required to remove, or enable "Remove all attendees"')
    }

    // Get the decrypted access token for Google
    const accessToken = await getDecryptedAccessToken(userId, "google-calendar")

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    // Create calendar API client
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

    // Get the existing event
    const existingEvent = await calendar.events.get({
      calendarId: calendarId,
      eventId: eventId
    })

    const existingAttendees = existingEvent.data.attendees || []

    if (existingAttendees.length === 0) {
      return {
        success: true,
        output: {
          eventId: eventId,
          message: 'Event has no attendees to remove',
          remainingAttendees: [],
          removedCount: 0
        }
      }
    }

    // Handle remove all attendees case
    let remainingAttendees
    let removedCount

    if (removeAllAttendees) {
      // Remove all attendees
      remainingAttendees = []
      removedCount = existingAttendees.length
    } else {
      // Process attendees to remove
      const removeList = typeof attendeesToRemove === 'string'
        ? attendeesToRemove.split(',').map((email: string) => email.trim().toLowerCase())
        : Array.isArray(attendeesToRemove)
          ? attendeesToRemove.map((email: any) => email.trim().toLowerCase())
          : [attendeesToRemove.trim().toLowerCase()]

      const removeSet = new Set(removeList)

      // Filter out attendees to remove
      remainingAttendees = existingAttendees.filter(
        (attendee: any) => !removeSet.has(attendee.email?.toLowerCase())
      )

      removedCount = existingAttendees.length - remainingAttendees.length

      if (removedCount === 0) {
        return {
          success: true,
          output: {
            eventId: eventId,
            message: 'No matching attendees found to remove',
            remainingAttendees: existingAttendees,
            removedCount: 0
          }
        }
      }
    }

    // Determine send notifications parameter
    let sendUpdates = 'none'
    if (sendNotifications === 'all') {
      sendUpdates = 'all'
    } else if (sendNotifications === 'externalOnly') {
      sendUpdates = 'externalOnly'
    }

    // Update the event with remaining attendees
    const response = await calendar.events.patch({
      calendarId: calendarId,
      eventId: eventId,
      requestBody: {
        attendees: remainingAttendees
      },
      sendUpdates: sendUpdates
    })

    const updatedEvent = response.data

    logger.info('✅ [Google Calendar] Removed attendees from event', {
      eventId: eventId,
      removedCount: removedCount,
      remainingAttendees: remainingAttendees.length
    })

    return {
      success: true,
      output: {
        eventId: updatedEvent.id,
        htmlLink: updatedEvent.htmlLink,
        summary: updatedEvent.summary,
        remainingAttendees: updatedEvent.attendees || [],
        previousAttendeeCount: existingAttendees.length,
        removedCount: removedCount,
        currentAttendeeCount: remainingAttendees.length
      }
    }
  } catch (error: any) {
    logger.error('❌ [Google Calendar] Error removing attendees:', error)

    if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.code === 401) {
      throw new Error('Google Calendar authentication failed. Please reconnect your account.')
    }

    if (error.message?.includes('404') || error.code === 404) {
      throw new Error('Event not found.')
    }

    throw error
  }
}
