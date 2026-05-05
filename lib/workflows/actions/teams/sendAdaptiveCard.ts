import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { ActionResult } from '../index'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Send an Adaptive Card to a Microsoft Teams channel
 *
 * API Reference: https://learn.microsoft.com/en-us/graph/api/channel-post-messages
 * Adaptive Cards: https://learn.microsoft.com/en-us/adaptive-cards/
 */
export async function sendTeamsAdaptiveCard(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Support both config and input for field values
    const teamId = input.teamId || config.teamId
    const channelId = input.channelId || config.channelId
    const cardTitle = input.cardTitle || config.cardTitle
    const cardText = input.cardText || config.cardText
    const cardType = input.cardType || config.cardType

    if (!teamId || !channelId || !cardTitle || !cardText) {
      return {
        success: false,
        error: 'Missing required fields: teamId, channelId, cardTitle, and cardText are required'
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

    // Build adaptive card based on card type
    let adaptiveCard: any

    switch (cardType) {
      case 'thumbnail':
        adaptiveCard = {
          "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
          "type": "AdaptiveCard",
          "version": "1.4",
          "body": [
            {
              "type": "ColumnSet",
              "columns": [
                {
                  "type": "Column",
                  "width": "auto",
                  "items": [
                    {
                      "type": "Image",
                      "url": "https://adaptivecards.io/content/cats/1.png",
                      "size": "Small"
                    }
                  ]
                },
                {
                  "type": "Column",
                  "width": "stretch",
                  "items": [
                    {
                      "type": "TextBlock",
                      "text": cardTitle,
                      "weight": "Bolder",
                      "wrap": true
                    },
                    {
                      "type": "TextBlock",
                      "text": cardText,
                      "wrap": true
                    }
                  ]
                }
              ]
            }
          ]
        }
        break

      case 'receipt':
        adaptiveCard = {
          "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
          "type": "AdaptiveCard",
          "version": "1.4",
          "body": [
            {
              "type": "TextBlock",
              "text": cardTitle,
              "weight": "Bolder",
              "size": "Medium",
              "wrap": true
            },
            {
              "type": "TextBlock",
              "text": cardText,
              "wrap": true,
              "separator": true
            },
            {
              "type": "FactSet",
              "facts": [
                {
                  "title": "Date",
                  "value": new Date().toLocaleDateString()
                },
                {
                  "title": "Time",
                  "value": new Date().toLocaleTimeString()
                }
              ]
            }
          ]
        }
        break

      case 'hero':
      default:
        adaptiveCard = {
          "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
          "type": "AdaptiveCard",
          "version": "1.4",
          "body": [
            {
              "type": "TextBlock",
              "text": cardTitle,
              "weight": "Bolder",
              "size": "Large",
              "wrap": true
            },
            {
              "type": "TextBlock",
              "text": cardText,
              "wrap": true
            }
          ]
        }
        break
    }

    // Build message payload with adaptive card attachment
    const messagePayload = {
      body: {
        contentType: 'html',
        content: `<attachment id="adaptiveCard"></attachment>`
      },
      attachments: [
        {
          id: 'adaptiveCard',
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: JSON.stringify(adaptiveCard)
        }
      ]
    }

    // Send the adaptive card to the channel
    // API: POST /teams/{team-id}/channels/{channel-id}/messages
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messagePayload)
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('[Teams] Failed to send adaptive card:', errorData)
      return {
        success: false,
        error: `Failed to send adaptive card: ${errorData.error?.message || response.statusText}`
      }
    }

    const sentMessage = await response.json()

    return {
      success: true,
      output: {
        messageId: sentMessage.id,
        cardTitle: cardTitle,
        cardType: cardType || 'hero',
        channelId: channelId,
        timestamp: sentMessage.createdDateTime,
        success: true
      }
    }
  } catch (error: any) {
    logger.error('[Teams] Error sending adaptive card:', error)
    return {
      success: false,
      error: error.message || 'Failed to send Teams adaptive card'
    }
  }
}
