import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Schedule a meeting with Teams integration (creates a calendar event)
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/user-post-events
 */
export async function scheduleTeamsMeeting(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values
    const subject = input.subject || config.subject
    const startTime = input.startTime || config.startTime
    const endTime = input.endTime || config.endTime
    const attendees = input.attendees || config.attendees
    const description = input.description || config.description
    const isOnlineMeeting = input.isOnlineMeeting ?? config.isOnlineMeeting

    if (!subject || !startTime || !endTime) {
      return {
        success: false,
        error: 'Missing required fields: subject, startTime, and endTime are required'
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

    // Build event payload
    const eventPayload: any = {
      subject: subject,
      start: {
        dateTime: new Date(startTime).toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: new Date(endTime).toISOString(),
        timeZone: 'UTC'
      },
      isOnlineMeeting: isOnlineMeeting !== false, // Default to true
      onlineMeetingProvider: 'teamsForBusiness'
    }

    // Add description/body if provided
    if (description) {
      eventPayload.body = {
        contentType: 'html',
        content: description
      }
    }

    // Add attendees if specified
    if (attendees) {
      const attendeeList = typeof attendees === 'string'
        ? attendees.split(',').map((e: string) => e.trim()).filter((e: string) => e)
        : Array.isArray(attendees) ? attendees : []

      if (attendeeList.length > 0) {
        eventPayload.attendees = attendeeList.map((email: string) => ({
          emailAddress: {
            address: email
          },
          type: 'required'
        }))
      }
    }

    // Create the calendar event with Teams meeting
    // API: POST /me/events
    const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventPayload)
    })

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to schedule meeting:', errorData)
      return {
        success: false,
        error: `Failed to schedule meeting: ${errorData.error?.message || response.statusText}`
      }
    }

    const event = await response.json()

    return {
      success: true,
      output: {
        eventId: event.id,
        subject: event.subject,
        startTime: event.start?.dateTime,
        endTime: event.end?.dateTime,
        joinUrl: event.onlineMeeting?.joinUrl || '',
        success: true
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error scheduling meeting:', error)
    return {
      success: false,
      error: error.message || 'Failed to schedule Teams meeting'
    }
  }
}
