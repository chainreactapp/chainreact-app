import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Update an online meeting in Microsoft Teams
 *
 * This action updates the calendar event associated with the online meeting.
 * The meeting dropdown returns a JSON object with eventId and joinWebUrl.
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/event-update
 */
export async function updateTeamsMeeting(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values
    const meetingIdRaw = input.meetingId || config.meetingId
    const subject = input.subject || config.subject
    const startDateTime = input.startDateTime || config.startDateTime
    const endDateTime = input.endDateTime || config.endDateTime

    if (!meetingIdRaw) {
      return {
        success: false,
        error: 'Meeting ID is required'
      }
    }

    if (!subject && !startDateTime && !endDateTime) {
      return {
        success: false,
        error: 'At least one field to update is required (subject, startDateTime, or endDateTime)'
      }
    }

    // Parse the meeting ID - it may be a JSON string with eventId and joinWebUrl
    let eventId: string

    try {
      const meetingData = JSON.parse(meetingIdRaw)
      eventId = meetingData.eventId
    } catch {
      // If it's not JSON, assume it's a direct meeting/event ID
      eventId = meetingIdRaw
    }

    if (!eventId) {
      return {
        success: false,
        error: 'Could not determine event ID from meeting selection'
      }
    }

    const supabase = createAdminClient()

    // Get Teams integration
    const { data: integration } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'teams')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (!integration || !integration.access_token) {
      return {
        success: false,
        error: 'Teams integration not found or not connected'
      }
    }

    const accessToken = await decrypt(integration.access_token)

    // Build update payload for calendar event
    const updatePayload: any = {}

    if (subject) {
      updatePayload.subject = subject
    }

    if (startDateTime) {
      updatePayload.start = {
        dateTime: new Date(startDateTime).toISOString(),
        timeZone: 'UTC'
      }
    }

    if (endDateTime) {
      updatePayload.end = {
        dateTime: new Date(endDateTime).toISOString(),
        timeZone: 'UTC'
      }
    }

    // Update the calendar event (which also updates the associated online meeting)
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/events/${eventId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = response.statusText
      try {
        const errorData = JSON.parse(errorText)
        errorMessage = errorData.error?.message || response.statusText
      } catch {
        // Error text is not JSON
      }
      logger.error('[Teams] Failed to update meeting:', errorText)
      return {
        success: false,
        error: `Failed to update meeting: ${errorMessage}`
      }
    }

    const event = await response.json()

    return {
      success: true,
      output: {
        meetingId: event.id,
        subject: event.subject,
        startDateTime: event.start?.dateTime,
        endDateTime: event.end?.dateTime,
        joinUrl: event.onlineMeeting?.joinUrl,
        success: true
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error updating meeting:', error)
    return {
      success: false,
      error: error.message || 'Failed to update Teams meeting'
    }
  }
}
