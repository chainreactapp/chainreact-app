import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import type { HandlerExecutionMeta } from '../core/idempotencyKey'
import { resolveTimezone } from '../core/resolveContextDefaults'
import { addMinutesToTime, parseTimeOrFail } from '../core/parseTimeOrFail'
import { requireExplicitField } from '../core/requireExplicitField'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Google Calendar update event handler
 */
export async function updateGoogleCalendarEvent(
  config: any,
  userId: string,
  input: Record<string, any>,
  meta?: HandlerExecutionMeta,
): Promise<ActionResult> {
  try {
    // Resolve config values if they contain template variables
    const needsResolution = typeof config === 'object' &&
      Object.values(config).some(v =>
        typeof v === 'string' && v.includes('{{') && v.includes('}}')
      )

    const resolvedConfig = needsResolution ? resolveValue(config, input) : config

    // Q11 — sendNotifications has user-facing side effects (auto-emails
    // attendees on event update). Previous silent default 'all' removed;
    // workflow author must explicitly choose. Existing workflows are
    // backfilled via handlerDefaultsBackfillRegistry (PR-G2).
    const missingRequired = requireExplicitField(resolvedConfig, 'sendNotifications')
    if (missingRequired) return missingRequired as unknown as ActionResult

    // Extract all config fields
    const {
      calendarId = 'primary',
      eventId,
      title,
      description,
      allDay,
      startDate,
      startTime,
      endDate,
      endTime,
      separateTimezones = false,
      startTimeZone,
      endTimeZone,
      location,
      attendees,
      notifications = [],
      googleMeet,
      sendNotifications,
      guestsCanInviteOthers,
      guestsCanSeeOtherGuests,
      guestsCanModify,
      visibility,
      transparency,
      colorId,
      recurrence
    } = resolvedConfig

    if (!eventId) {
      throw new Error('Event ID is required to update an event')
    }

    // Check if an array was provided instead of a single event ID
    if (Array.isArray(eventId)) {
      throw new Error(
        'Multiple events detected. To update multiple events, add a Loop node before this action and use {{loop.currentItem.eventId}} as the Event ID. If you want to update only the first event, use {{list_events_node.events.0.eventId}} instead.'
      )
    }

    // Get the decrypted access token for Google
    const accessToken = await getDecryptedAccessToken(userId, "google-calendar")

    // Q12 — resolve timezone via workspace → user → UTC. Replaces the prior
    // `Intl.DateTimeFormat().resolvedOptions().timeZone` (server tz) +
    // 'America/New_York' fallback.
    const fallbackTimezone = await resolveTimezone({
      workspaceId: meta?.workspaceId,
      userId,
    })
    let eventStartTimeZone = startTimeZone && startTimeZone !== 'auto'
      ? startTimeZone
      : fallbackTimezone
    let eventEndTimeZone = separateTimezones && endTimeZone && endTimeZone !== 'auto'
      ? endTimeZone
      : eventStartTimeZone

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    // Create calendar API client
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

    // First, get the existing event
    const existingEvent = await calendar.events.get({
      calendarId: calendarId,
      eventId: eventId
    })

    // Q11 — parseDateTime is a pure formatter. Time-format validation is
    // performed before this is called (see timed-event branch below).
    const parseDateTime = (date: string, time: string) => {
      if (!date || date === 'today') {
        date = new Date().toISOString().split('T')[0]
      }
      if (!time || time === 'current') {
        time = new Date().toTimeString().slice(0, 5)
      }
      return `${date}T${time}:00`
    }

    const parseDate = (date: string) => {
      if (!date || date === 'today') {
        return new Date().toISOString().split('T')[0]
      }
      return date
    }

    // Pull existing-event time components for the existing-event fallback
    // path. If the existing provider event genuinely lacks start-time data
    // (degenerate case) we substitute '09:00' as the synthesized value
    // (audit Q12 line 146 — Keep with documentation: this fallback applies
    // ONLY when the *existing* event lacks start-time, NOT when the user
    // supplies an invalid `startTime` config. End-time falls through to
    // start + 60 minutes so it is anchored to the actual start.
    const existingStartTime = existingEvent.data.start?.dateTime?.split('T')[1]?.substring(0, 5)
    const existingEndTime = existingEvent.data.end?.dateTime?.split('T')[1]?.substring(0, 5)
    const synthesizedExistingStart = existingStartTime || '09:00'
    const synthesizedExistingEnd =
      existingEndTime || addMinutesToTime(synthesizedExistingStart, 60)

    // Prepare the update data - only include fields that are being changed
    const eventData: any = {}

    if (title !== undefined) {
      eventData.summary = title
    }

    if (location !== undefined) {
      eventData.location = location
    }

    if (description !== undefined) {
      eventData.description = description
    }

    // Handle date/time updates
    if (allDay !== undefined || startDate !== undefined || startTime !== undefined || endDate !== undefined || endTime !== undefined) {
      if (allDay) {
        eventData.start = {
          date: parseDate(startDate || existingEvent.data.start?.date),
          timeZone: eventStartTimeZone
        }
        eventData.end = {
          date: parseDate(endDate || startDate || existingEvent.data.end?.date),
          timeZone: eventEndTimeZone
        }
      } else {
        // Q11 — strict HH:MM validation when the user supplies startTime /
        // endTime. The 'current' sentinel resolves to "now"; an empty value
        // falls through to the existing event's stored start/end (or the
        // synthesized fallback above for the degenerate existing-event case).
        let resolvedStartTime: string
        if (startTime === 'current') {
          resolvedStartTime = new Date().toTimeString().slice(0, 5)
        } else if (startTime) {
          const parsed = parseTimeOrFail(startTime, 'startTime')
          if (!parsed.ok) return parsed.failure as unknown as ActionResult
          resolvedStartTime = parsed.raw
        } else {
          resolvedStartTime = synthesizedExistingStart
        }

        let resolvedEndTime: string
        if (endTime === 'current') {
          resolvedEndTime = new Date().toTimeString().slice(0, 5)
        } else if (endTime) {
          const parsed = parseTimeOrFail(endTime, 'endTime')
          if (!parsed.ok) return parsed.failure as unknown as ActionResult
          resolvedEndTime = parsed.raw
        } else if (startTime && startTime !== 'current') {
          // User supplied a new start but no end → end = new start + 60.
          resolvedEndTime = addMinutesToTime(resolvedStartTime, 60)
        } else {
          // No new times supplied → preserve existing end (or synthesized
          // start + 60 if existing event genuinely lacks end-time data).
          resolvedEndTime = synthesizedExistingEnd
        }

        eventData.start = {
          dateTime: parseDateTime(
            startDate || existingEvent.data.start?.dateTime?.split('T')[0] || new Date().toISOString().split('T')[0],
            resolvedStartTime,
          ),
          timeZone: eventStartTimeZone
        }
        eventData.end = {
          dateTime: parseDateTime(
            endDate || startDate || existingEvent.data.end?.dateTime?.split('T')[0] || new Date().toISOString().split('T')[0],
            resolvedEndTime,
          ),
          timeZone: eventEndTimeZone
        }
      }
    }

    // Process attendees if provided
    if (attendees !== undefined) {
      if (attendees && attendees.length > 0) {
        const attendeeList = typeof attendees === 'string'
          ? attendees.split(',').map((email: string) => email.trim())
          : Array.isArray(attendees) ? attendees : [attendees]

        const validAttendees = attendeeList
          .filter(email => email && email.includes('@'))
          .map(email => ({ email: email.trim() }))

        if (validAttendees.length > 0) {
          eventData.attendees = validAttendees
        }
      } else {
        eventData.attendees = []
      }
    }

    // Add reminders from notifications array
    if (notifications !== undefined) {
      if (notifications && Array.isArray(notifications) && notifications.length > 0) {
        eventData.reminders = {
          useDefault: false,
          overrides: notifications.map((notif: any) => ({
            method: notif.method,
            minutes: notif.minutes
          }))
        }
      } else {
        eventData.reminders = {
          useDefault: true
        }
      }
    }

    // Handle Google Meet conference updates
    if (googleMeet !== undefined) {
      if (googleMeet && googleMeet.link) {
        const conferenceRequest: any = {
          requestId: `meet_${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }

        if (googleMeet.settings) {
          const conferenceSolution: any = {}
          if (googleMeet.settings.accessType) {
            conferenceSolution.accessType = googleMeet.settings.accessType
          }

          if (Object.keys(conferenceSolution).length > 0) {
            conferenceRequest.conferenceSolutionKey = {
              type: 'hangoutsMeet',
              ...conferenceSolution
            }
          }
        }

        eventData.conferenceData = {
          createRequest: conferenceRequest
        }
      }
    }

    // Set visibility
    if (visibility !== undefined && visibility !== 'default') {
      eventData.visibility = visibility
    }

    // Set transparency
    if (transparency !== undefined) {
      eventData.transparency = transparency === 'opaque' ? 'opaque' : 'transparent'
    }

    // Set color
    if (colorId !== undefined && colorId !== 'default') {
      eventData.colorId = colorId
    }

    // Handle recurrence
    if (recurrence !== undefined) {
      if (recurrence && recurrence !== 'none') {
        eventData.recurrence = [recurrence]
      } else {
        eventData.recurrence = null
      }
    }

    // Guest permissions
    if (guestsCanInviteOthers !== undefined) {
      eventData.guestsCanInviteOthers = guestsCanInviteOthers
    }
    if (guestsCanSeeOtherGuests !== undefined) {
      eventData.guestsCanSeeOtherGuests = guestsCanSeeOtherGuests
    }
    if (guestsCanModify !== undefined) {
      eventData.guestsCanModify = guestsCanModify
    }

    // Determine send notifications parameter
    let sendUpdates = 'none'
    if (sendNotifications === 'all') {
      sendUpdates = 'all'
    } else if (sendNotifications === 'externalOnly') {
      sendUpdates = 'externalOnly'
    }

    // Update the event
    const response = await calendar.events.update({
      calendarId: calendarId,
      eventId: eventId,
      requestBody: eventData,
      sendUpdates: sendUpdates,
      conferenceDataVersion: googleMeet ? 1 : 0
    })

    const updatedEvent = response.data

    logger.info('✅ [Google Calendar] Updated event', {
      eventId: updatedEvent.id
    })

    return {
      success: true,
      output: {
        eventId: updatedEvent.id,
        htmlLink: updatedEvent.htmlLink,
        summary: updatedEvent.summary,
        description: updatedEvent.description,
        location: updatedEvent.location,
        start: updatedEvent.start,
        end: updatedEvent.end,
        hangoutLink: updatedEvent.hangoutLink,
        meetLink: updatedEvent.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri,
        attendees: updatedEvent.attendees,
        status: updatedEvent.status,
        updated: updatedEvent.updated,
        startTimezone: eventStartTimeZone,
        endTimezone: eventEndTimeZone
      }
    }
  } catch (error: any) {
    logger.error('❌ [Google Calendar] Error updating event:', error)

    if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.code === 401) {
      throw new Error('Google Calendar authentication failed. Please reconnect your account.')
    }

    throw error
  }
}
