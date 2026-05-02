import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import { requireExplicitField } from '../core/requireExplicitField'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Google Calendar add attendees handler
 */
export async function addGoogleCalendarAttendees(
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
      attendees,
      sendNotifications,
    } = resolvedConfig

    if (!eventId) {
      throw new Error('Event ID is required to add attendees')
    }

    // Check if an array was provided instead of a single event ID
    if (Array.isArray(eventId)) {
      throw new Error(
        'Multiple events detected. To add attendees to multiple events, add a Loop node before this action and use {{loop.currentItem.eventId}} as the Event ID. If you want to add attendees to only the first event, use {{list_events_node.events.0.eventId}} instead.'
      )
    }

    if (!attendees || (Array.isArray(attendees) && attendees.length === 0)) {
      throw new Error('At least one attendee email is required')
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

    // Process new attendees
    const newAttendeeList = typeof attendees === 'string'
      ? attendees.split(',').map((email: string) => email.trim())
      : Array.isArray(attendees) ? attendees : [attendees]

    const validNewAttendees = newAttendeeList
      .filter(email => email && email.includes('@'))
      .map(email => ({ email: email.trim() }))

    if (validNewAttendees.length === 0) {
      throw new Error('No valid email addresses provided')
    }

    // Merge with existing attendees (avoid duplicates)
    const existingAttendees = existingEvent.data.attendees || []
    const existingEmails = new Set(existingAttendees.map((a: any) => a.email?.toLowerCase()))

    const attendeesToAdd = validNewAttendees.filter(
      attendee => !existingEmails.has(attendee.email.toLowerCase())
    )

    if (attendeesToAdd.length === 0) {
      return {
        success: true,
        output: {
          eventId: eventId,
          message: 'All attendees were already invited to this event',
          existingAttendees: existingAttendees.length,
          attemptedToAdd: validNewAttendees.length,
          actuallyAdded: 0
        }
      }
    }

    const updatedAttendees = [...existingAttendees, ...attendeesToAdd]

    // Determine send notifications parameter
    let sendUpdates = 'none'
    if (sendNotifications === 'all') {
      sendUpdates = 'all'
    } else if (sendNotifications === 'externalOnly') {
      sendUpdates = 'externalOnly'
    }

    // Update the event with new attendees
    const response = await calendar.events.patch({
      calendarId: calendarId,
      eventId: eventId,
      requestBody: {
        attendees: updatedAttendees
      },
      sendUpdates: sendUpdates
    })

    const updatedEvent = response.data

    logger.info('✅ [Google Calendar] Added attendees to event', {
      eventId: eventId,
      addedCount: attendeesToAdd.length,
      totalAttendees: updatedAttendees.length
    })

    return {
      success: true,
      output: {
        eventId: updatedEvent.id,
        htmlLink: updatedEvent.htmlLink,
        summary: updatedEvent.summary,
        attendees: updatedEvent.attendees,
        addedAttendees: attendeesToAdd,
        existingAttendees: existingAttendees.length,
        totalAttendees: updatedAttendees.length,
        actuallyAdded: attendeesToAdd.length
      }
    }
  } catch (error: any) {
    logger.error('❌ [Google Calendar] Error adding attendees:', error)

    if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.code === 401) {
      throw new Error('Google Calendar authentication failed. Please reconnect your account.')
    }

    if (error.message?.includes('404') || error.code === 404) {
      throw new Error('Event not found.')
    }

    throw error
  }
}
