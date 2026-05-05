import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * End/cancel an online meeting in Microsoft Teams
 *
 * This action cancels the calendar event associated with the online meeting.
 * The meeting dropdown returns a JSON object with eventId and joinWebUrl.
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/event-cancel
 */
export async function endTeamsMeeting(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values
    const meetingIdRaw = input.meetingId || config.meetingId

    if (!meetingIdRaw) {
      return {
        success: false,
        error: 'Meeting ID is required'
      }
    }

    // Parse the meeting ID - it may be a JSON string with eventId and joinWebUrl
    let eventId: string
    let meetingSubject: string | undefined

    try {
      const meetingData = JSON.parse(meetingIdRaw)
      eventId = meetingData.eventId
      meetingSubject = meetingData.subject
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

    // Cancel the calendar event (which also cancels the online meeting)
    // This sends cancellation notices to all attendees
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/events/${eventId}/cancel`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          comment: 'Meeting cancelled'
        })
      }
    )

    if (!response.ok && response.status !== 202 && response.status !== 204) {
      const errorText = await response.text()
      let errorMessage = response.statusText
      try {
        const errorData = JSON.parse(errorText)
        errorMessage = errorData.error?.message || response.statusText
      } catch {
        // Error text is not JSON
      }
      logger.error('[Teams] Failed to cancel meeting:', errorText)
      return {
        success: false,
        error: `Failed to cancel meeting: ${errorMessage}`
      }
    }

    return {
      success: true,
      output: {
        success: true,
        meetingId: eventId,
        subject: meetingSubject,
        message: 'Meeting cancelled successfully. Cancellation notices sent to attendees.'
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error ending meeting:', error)
    return {
      success: false,
      error: error.message || 'Failed to end Teams meeting'
    }
  }
}
