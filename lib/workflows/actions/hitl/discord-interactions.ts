/**
 * Discord Interactions for HITL (No Gateway Required)
 * Uses Discord's native button/modal system
 */

import { createSupabaseServiceClient } from '@/utils/supabase/server'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export interface DiscordInteractionButton {
  label: string
  value: string
  style: 'primary' | 'secondary' | 'success' | 'danger'
}

/**
 * Send Discord message with interactive buttons
 */
export async function sendDiscordHITLWithButtons(
  userId: string,
  guildId: string,
  channelId: string,
  message: string,
  buttons: DiscordInteractionButton[],
  conversationId: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const supabase = await createSupabaseServiceClient()

  // Get Discord bot token
  const { data: integration } = await supabase
    .from('integrations')
    .select('credentials')
    .eq('user_id', userId)
    .eq('provider', 'discord')
    .in('status', CONNECTED_STATUSES_LIST)
    .single()

  if (!integration) {
    return { success: false, error: 'Discord integration not connected' }
  }

  const botToken = integration.credentials.bot_token

  // Create button components
  const components = [
    {
      type: 1, // Action Row
      components: buttons.map((btn, idx) => ({
        type: 2, // Button
        style: btn.style === 'primary' ? 1 : btn.style === 'success' ? 3 : btn.style === 'danger' ? 4 : 2,
        label: btn.label,
        custom_id: `hitl_${conversationId}_${btn.value}` // Include conversation ID in button ID
      }))
    }
  ]

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: message,
          components,
          embeds: [
            {
              title: '💬 Workflow Waiting for Input',
              color: 0x5865F2, // Discord Blurple
              footer: {
                text: 'Click a button below to respond'
              }
            }
          ]
        }),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      console.error('Failed to send Discord message with buttons:', error)
      return { success: false, error }
    }

    const data = await response.json()
    return { success: true, messageId: data.id }
  } catch (error: any) {
    console.error('Error sending Discord HITL message:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Update message after interaction
 */
export async function updateDiscordMessage(
  userId: string,
  channelId: string,
  messageId: string,
  newContent: string,
  removeButtons: boolean = true
): Promise<boolean> {
  const supabase = await createSupabaseServiceClient()

  const { data: integration } = await supabase
    .from('integrations')
    .select('credentials')
    .eq('user_id', userId)
    .eq('provider', 'discord')
    .in('status', CONNECTED_STATUSES_LIST)
    .single()

  if (!integration) return false

  const botToken = integration.credentials.bot_token

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: newContent,
          components: removeButtons ? [] : undefined,
          embeds: [
            {
              title: '✅ Response Received',
              color: 0x57F287, // Green
              description: 'Workflow continuing...'
            }
          ]
        }),
      }
    )

    return response.ok
  } catch (error) {
    console.error('Error updating Discord message:', error)
    return false
  }
}

/**
 * Send follow-up message (for conversations)
 */
export async function sendDiscordFollowUp(
  userId: string,
  channelId: string,
  message: string,
  buttons?: DiscordInteractionButton[]
): Promise<{ success: boolean; messageId?: string }> {
  const supabase = await createSupabaseServiceClient()

  const { data: integration } = await supabase
    .from('integrations')
    .select('credentials')
    .eq('user_id', userId)
    .eq('provider', 'discord')
    .in('status', CONNECTED_STATUSES_LIST)
    .single()

  if (!integration) return { success: false }

  const botToken = integration.credentials.bot_token

  const components = buttons ? [
    {
      type: 1,
      components: buttons.map(btn => ({
        type: 2,
        style: btn.style === 'primary' ? 1 : btn.style === 'success' ? 3 : btn.style === 'danger' ? 4 : 2,
        label: btn.label,
        custom_id: `hitl_followup_${btn.value}`
      }))
    }
  ] : []

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: message,
          components
        }),
      }
    )

    if (!response.ok) return { success: false }

    const data = await response.json()
    return { success: true, messageId: data.id }
  } catch (error) {
    console.error('Error sending Discord follow-up:', error)
    return { success: false }
  }
}
