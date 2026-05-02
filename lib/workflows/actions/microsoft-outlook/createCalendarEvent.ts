import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import type { HandlerExecutionMeta } from '../core/idempotencyKey'
import { resolveTimezone } from '../core/resolveContextDefaults'
import { invalidTimeFormat, parseTimeOrFail } from '../core/parseTimeOrFail'
import { missingRequiredField } from '../core/requireExplicitField'

import { logger } from '@/lib/utils/logger'

/**
 * Microsoft Outlook create calendar event handler with timezone auto-detection
 */
export async function createOutlookCalendarEvent(
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

    // Process date/time based on the simplified field structure
    const processedConfig = { ...resolvedConfig }
    const now = new Date()
    let eventDate = new Date()

    // Calculate the date based on eventDate selection
    switch (resolvedConfig.eventDate) {
      case 'today':
        // Keep eventDate as now
        break
      case 'tomorrow':
        eventDate.setDate(eventDate.getDate() + 1)
        break
      case 'in_3_days':
        eventDate.setDate(eventDate.getDate() + 3)
        break
      case 'in_1_week':
        eventDate.setDate(eventDate.getDate() + 7)
        break
      case 'in_2_weeks':
        eventDate.setDate(eventDate.getDate() + 14)
        break
      case 'custom_days':
        const daysToAdd = parseInt(resolvedConfig.customDays) || 1
        eventDate.setDate(eventDate.getDate() + daysToAdd)
        break
      case 'next_weekday':
        if (resolvedConfig.nextWeekday) {
          const weekdayMap: { [key: string]: number } = {
            'monday': 1,
            'tuesday': 2,
            'wednesday': 3,
            'thursday': 4,
            'friday': 5,
            'saturday': 6,
            'sunday': 0
          }
          const targetDay = weekdayMap[resolvedConfig.nextWeekday]
          const currentDay = eventDate.getDay()
          const daysUntilTarget = (targetDay - currentDay + 7) % 7 || 7 // If same day, go to next week
          eventDate.setDate(eventDate.getDate() + daysUntilTarget)
        }
        break
      case 'next_monday':
        const daysUntilMonday = (1 - eventDate.getDay() + 7) % 7 || 7
        eventDate.setDate(eventDate.getDate() + daysUntilMonday)
        break
      case 'next_friday':
        const daysUntilFriday = (5 - eventDate.getDay() + 7) % 7 || 7
        eventDate.setDate(eventDate.getDate() + daysUntilFriday)
        break
      case 'specific':
        if (resolvedConfig.specificDate) {
          eventDate = new Date(`${resolvedConfig.specificDate }T00:00:00`)
        }
        break
    }

    // Format the date as YYYY-MM-DD
    const formattedDate = eventDate.toISOString().split('T')[0]

    // Handle time
    let calculatedStartTime = resolvedConfig.eventTime || '09:00'
    if (calculatedStartTime === 'current') {
      const currentHours = now.getHours().toString().padStart(2, '0')
      const currentMinutes = now.getMinutes().toString().padStart(2, '0')
      calculatedStartTime = `${currentHours}:${currentMinutes}`
    } else if (calculatedStartTime === 'custom' && resolvedConfig.customTime) {
      calculatedStartTime = resolvedConfig.customTime
    }

    // Handle duration and end time
    const duration = resolvedConfig.duration || '60'

    if (duration === 'allday') {
      processedConfig.isAllDay = true
      processedConfig.startDate = formattedDate
      processedConfig.endDate = formattedDate
      processedConfig.startTime = '00:00'
      processedConfig.endTime = '23:59'
    } else if (duration === 'custom') {
      // Q11 — when duration='custom', customEndTime MUST be supplied
      // explicitly. Silent '17:00' substitution is removed (audit
      // createCalendarEvent.ts:110).
      if (!resolvedConfig.customEndTime) {
        return missingRequiredField('customEndTime') as unknown as ActionResult
      }
      const customEndParsed = parseTimeOrFail(resolvedConfig.customEndTime, 'customEndTime')
      if (!customEndParsed.ok) {
        return customEndParsed.failure as unknown as ActionResult
      }
      processedConfig.isAllDay = false
      processedConfig.startDate = formattedDate
      processedConfig.startTime = calculatedStartTime
      processedConfig.endDate = resolvedConfig.customEndDate || formattedDate
      processedConfig.endTime = customEndParsed.raw
    } else {
      // Calculate end time based on duration
      processedConfig.isAllDay = false
      processedConfig.startDate = formattedDate
      processedConfig.startTime = calculatedStartTime

      const [startHours, startMinutes] = calculatedStartTime.split(':').map(Number)
      const durationMinutes = parseInt(duration)
      const totalMinutes = startHours * 60 + startMinutes + durationMinutes
      const endHours = Math.floor(totalMinutes / 60) % 24
      const endMinutes = totalMinutes % 60
      processedConfig.endTime = `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`

      // If end time goes past midnight, set end date to next day
      if (totalMinutes >= 24 * 60) {
        const endDate = new Date(eventDate)
        endDate.setDate(endDate.getDate() + Math.floor(totalMinutes / (24 * 60)))
        processedConfig.endDate = endDate.toISOString().split('T')[0]
      } else {
        processedConfig.endDate = formattedDate
      }
    }

    const {
      calendarId,
      subject,
      body,
      startDate,
      startTime,
      endDate,
      endTime,
      timeZone,
      isAllDay,
      location,
      locations,
      attendees,
      reminderMinutesBeforeStart,
      showAs = 'busy',
      sensitivity = 'normal',
      importance = 'normal',
      isOnlineMeeting = false,
      onlineMeetingProvider = 'teamsForBusiness'
    } = processedConfig

    // Get the decrypted access token for Microsoft Outlook
    const accessToken = await getDecryptedAccessToken(userId, "microsoft-outlook")

    // Q12 — resolve timezone via workspace → user → UTC. Replaces
    // `Intl.DateTimeFormat().resolvedOptions().timeZone` (server tz) so the
    // event timezone reflects the workspace/user, not the runtime host.
    const fallbackTimezone = await resolveTimezone({
      workspaceId: meta?.workspaceId,
      userId,
    })
    const eventTimeZone = timeZone && timeZone !== 'user-timezone' ? timeZone : fallbackTimezone

    // Q11 — strict HH:MM validation. The 'current' sentinel resolves to
    // "now"; an invalid format string returns INVALID_TIME_FORMAT instead
    // of the prior silent '09:00' substitution
    // (audit createCalendarEvent.ts:190).
    let timeValidationFailure: ActionResult | null = null

    const parseDateTime = (date: string, time: string, isEndDate: boolean = false) => {
      if (!date || date === 'today') {
        date = new Date().toISOString().split('T')[0]
      } else if (date === 'same-as-start' && startDate) {
        date = startDate === 'today' ? new Date().toISOString().split('T')[0] : startDate
      }

      if (!time || time === 'current') {
        if (isEndDate) {
          const now = new Date()
          now.setHours(now.getHours() + 1)
          time = now.toTimeString().slice(0, 5)
        } else {
          time = new Date().toTimeString().slice(0, 5)
        }
      } else {
        const parsed = parseTimeOrFail(time, isEndDate ? 'endTime' : 'startTime')
        if (!parsed.ok) {
          timeValidationFailure = parsed.failure as unknown as ActionResult
          // Return a syntactically-valid placeholder so we don't crash before
          // the caller checks `timeValidationFailure`. Caller short-circuits.
          time = '00:00'
        } else {
          time = parsed.raw
        }
      }

      return `${date}T${time}:00`
    }

    // Prepare the event data for Microsoft Graph API
    const eventData: any = {
      subject: subject || 'Untitled Event'
    }

    // Only add body if provided
    if (body) {
      eventData.body = {
        contentType: 'HTML',
        content: body
      }
    }

    // Only add showAs if provided (default is 'busy' in Outlook)
    if (showAs) {
      eventData.showAs = showAs
    }

    // Only add sensitivity if provided (default is 'normal')
    if (sensitivity) {
      eventData.sensitivity = sensitivity
    }

    // Only add importance if provided (default is 'normal')
    if (importance) {
      eventData.importance = importance.toLowerCase()
    }

    // Handle all-day events
    if (isAllDay) {
      eventData.isAllDay = true

      // Parse start date for all-day event
      let allDayStartDate = startDate
      if (!allDayStartDate || allDayStartDate === 'today') {
        allDayStartDate = new Date().toISOString().split('T')[0]
      }

      // Parse end date for all-day event
      let allDayEndDate = endDate
      if (!allDayEndDate || allDayEndDate === 'same-as-start' || allDayEndDate === 'today') {
        allDayEndDate = allDayStartDate
      }

      eventData.start = {
        dateTime: `${allDayStartDate}T00:00:00`,
        timeZone: eventTimeZone
      }
      eventData.end = {
        dateTime: `${allDayEndDate}T00:00:00`,
        timeZone: eventTimeZone
      }
    } else {
      // Regular timed event
      eventData.start = {
        dateTime: parseDateTime(startDate, startTime, false),
        timeZone: eventTimeZone
      }
      eventData.end = {
        dateTime: parseDateTime(endDate, endTime, true),
        timeZone: eventTimeZone
      }
      // Q11 — short-circuit if either parseDateTime invocation flagged an
      // invalid time-format failure. Avoids producing a corrupt provider
      // call with a placeholder time.
      if (timeValidationFailure) {
        return timeValidationFailure
      }
    }

    // Add location if provided
    if (location || locations) {
      const locationString = location || locations
      if (locationString && locationString.trim()) {
        eventData.location = {
          displayName: locationString.trim()
        }
      }
    }

    // Configure Microsoft Teams / Skype online meeting if requested
    const wantsOnlineMeeting = typeof isOnlineMeeting === 'string' ? isOnlineMeeting === 'true' : !!isOnlineMeeting
    if (wantsOnlineMeeting) {
      eventData.isOnlineMeeting = true
      const provider = (onlineMeetingProvider || 'teamsForBusiness').trim()
      const allowedProviders = new Set(['teamsForBusiness', 'skypeForBusiness', 'skypeForConsumer'])
      eventData.onlineMeetingProvider = allowedProviders.has(provider) ? provider : 'teamsForBusiness'
    }

    // Process attendees if provided
    if (attendees && attendees.length > 0) {
      const attendeeList = Array.isArray(attendees) ? attendees : [attendees]
      const validAttendees = attendeeList
        .filter(email => email && typeof email === 'string' && email.includes('@'))
        .map(email => ({
          emailAddress: {
            address: email.trim()
          },
          type: 'required'
        }))

      // Only add attendees if we have valid ones
      if (validAttendees.length > 0) {
        eventData.attendees = validAttendees
      }
    }

    // Add reminder if specified and valid
    if (reminderMinutesBeforeStart !== undefined && reminderMinutesBeforeStart !== null && reminderMinutesBeforeStart !== '' && reminderMinutesBeforeStart !== 'none') {
      const reminderValue = parseInt(reminderMinutesBeforeStart)
      if (!isNaN(reminderValue) && reminderValue >= 0) {
        eventData.reminderMinutesBeforeStart = reminderValue
        eventData.isReminderOn = true
      }
    }

    // Determine which calendar to use
    // If no calendar selected or it's 'default', use the primary calendar
    const calendarEndpoint = calendarId && calendarId.trim() && calendarId !== 'default' && calendarId !== ''
      ? `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`
      : 'https://graph.microsoft.com/v1.0/me/events'

    // Create the event using Microsoft Graph API
    const response = await fetch(calendarEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventData)
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `Failed to create calendar event: ${response.statusText}`

      try {
        const errorJson = JSON.parse(errorText)
        if (errorJson.error?.message) {
          errorMessage = `Failed to create calendar event: ${errorJson.error.message}`
        }
      } catch {
        // If error text is not JSON, use the default message
      }

      throw new Error(errorMessage)
    }

    const createdEvent = await response.json()

    return {
      success: true,
      output: {
        eventId: createdEvent.id,
        subject: createdEvent.subject,
        start: createdEvent.start,
        end: createdEvent.end,
        location: createdEvent.location?.displayName,
        webLink: createdEvent.webLink,
        timezone: eventTimeZone,
        isAllDay: createdEvent.isAllDay,
        attendees: createdEvent.attendees?.map((a: any) => a.emailAddress.address),
        onlineMeetingJoinUrl: createdEvent.onlineMeeting?.joinUrl || createdEvent.webLink,
        onlineMeetingProvider: createdEvent.onlineMeetingProvider || (eventData.isOnlineMeeting ? (eventData.onlineMeetingProvider || 'teamsForBusiness') : undefined),
        onlineMeeting: createdEvent.onlineMeeting,
        createdDateTime: createdEvent.createdDateTime
      }
    }
  } catch (error: any) {
    logger.error('[Outlook Calendar] Error creating event:', error)

    // Check if it's a token error
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      throw new Error('Microsoft Outlook authentication failed. Please reconnect your account.')
    }

    throw error
  }
}

