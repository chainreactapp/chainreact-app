import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import { requireExplicitField } from '../core/requireExplicitField'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Google Calendar quick add event handler
 * Creates events from natural language text like "Lunch with John tomorrow at noon"
 */
export async function quickAddGoogleCalendarEvent(
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

    // Q11 — sendNotifications has user-facing side effects (Google's
    // quickAdd may parse attendees from natural-language text). Previous
    // silent default 'none' removed; workflow author must choose explicitly.
    const missingRequired = requireExplicitField(resolvedConfig, 'sendNotifications')
    if (missingRequired) return missingRequired as unknown as ActionResult

    const {
      calendarId = 'primary',
      text,
      sendNotifications,
    } = resolvedConfig

    if (!text) {
      throw new Error('Natural language text is required to create an event')
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

    // Use Google's Quick Add API
    const response = await calendar.events.quickAdd({
      calendarId: calendarId,
      text: text,
      sendUpdates: sendUpdates
    })

    const event = response.data

    logger.info('✅ [Google Calendar] Quick added event from text', {
      eventId: event.id,
      text: text,
      parsedTitle: event.summary
    })

    return {
      success: true,
      output: {
        eventId: event.id,
        htmlLink: event.htmlLink,
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: event.start,
        end: event.end,
        attendees: event.attendees || [],
        organizer: event.organizer,
        created: event.created,
        status: event.status,
        hangoutLink: event.hangoutLink,
        meetLink: event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri,
        originalText: text
      }
    }
  } catch (error: any) {
    logger.error('❌ [Google Calendar] Error quick adding event:', error)

    if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.code === 401) {
      throw new Error('Google Calendar authentication failed. Please reconnect your account.')
    }

    if (error.message?.includes('400') || error.code === 400) {
      throw new Error('Could not parse the text into a valid event. Try being more specific with dates and times.')
    }

    throw error
  }
}
