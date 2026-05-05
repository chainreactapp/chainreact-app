import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Start an online meeting in Microsoft Teams
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings
 */
export async function startTeamsMeeting(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values
    const subject = input.subject || config.subject
    const participants = input.participants || config.participants
    const startDateTime = input.startDateTime || config.startDateTime
    const endDateTime = input.endDateTime || config.endDateTime

    if (!subject) {
      return {
        success: false,
        error: 'Meeting subject is required'
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

    // Build meeting payload
    const meetingPayload: any = {
      subject: subject
    }

    // Add time if specified
    if (startDateTime) {
      meetingPayload.startDateTime = new Date(startDateTime).toISOString()
    } else {
      // Start immediately
      meetingPayload.startDateTime = new Date().toISOString()
    }

    if (endDateTime) {
      meetingPayload.endDateTime = new Date(endDateTime).toISOString()
    }

    // Add participants if specified
    if (participants && Array.isArray(participants) && participants.length > 0) {
      meetingPayload.participants = {
        attendees: participants.map((email: string) => ({
          identity: {
            user: {
              id: email,
              displayName: email
            }
          },
          upn: email
        }))
      }
    }

    // Create the meeting
    const response = await fetch('https://graph.microsoft.com/v1.0/me/onlineMeetings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(meetingPayload)
    })

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to start meeting:', errorData)
      return {
        success: false,
        error: `Failed to start meeting: ${errorData.error?.message || response.statusText}`
      }
    }

    const meeting = await response.json()

    return {
      success: true,
      output: {
        meetingId: meeting.id,
        joinUrl: meeting.joinUrl || meeting.joinWebUrl,
        subject: meeting.subject,
        startDateTime: meeting.startDateTime,
        success: true
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error starting meeting:', error)
    return {
      success: false,
      error: error.message || 'Failed to start Teams meeting'
    }
  }
}
