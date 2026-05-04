/**
 * Discord Notification Service
 */

import { logger } from '@/lib/utils/logger'
import { createSupabaseServerClient } from '@/utils/supabase/server'

interface DiscordEmbed {
  title: string
  description: string
  color: number
  fields: Array<{ name: string; value: string; inline?: boolean }>
  timestamp: string
}

/**
 * Send Discord notification to a channel
 */
export async function sendDiscordMessage(
  channelId: string,
  message: string,
  userId: string
): Promise<boolean> {
  try {
    // Use Discord Bot Token (not user OAuth token)
    const botToken = process.env.DISCORD_BOT_TOKEN

    if (!botToken) {
      logger.error('Discord bot token not configured')
      return false
    }

    // Send message via Discord API
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: message,
        embeds: [formatDiscordEmbed(message)],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      logger.error('Discord API error:', error)
      return false
    }

    const data = await response.json()

    logger.info('Discord message sent successfully:', {
      channel: channelId,
      id: data.id
    })

    return true
  } catch (error: any) {
    logger.error('Failed to send Discord message:', {
      error: error.message,
      channelId
    })
    return false
  }
}

import type { WorkflowFailurePayload } from './workflowFailurePayload'

/**
 * Send workflow error to Discord with humanized embed.
 *
 * Discord doesn't support button-style links inside embeds without a bot
 * interaction handler, so the CTA is appended as a markdown link in the
 * description.
 */
export async function sendWorkflowErrorDiscord(
  channelId: string,
  payload: WorkflowFailurePayload,
  _userId: string
): Promise<boolean> {
  try {
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) {
      logger.error('Discord bot token not configured')
      return false
    }

    const embed = buildWorkflowFailureDiscordEmbed(payload)
    const fallback = `${payload.title} — workflow "${payload.workflowName}"`

    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: fallback, embeds: [embed] }),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      logger.error('Discord API error:', error)
      return false
    }
    return true
  } catch (err: any) {
    logger.error('Failed to send Discord workflow error:', { error: err.message, channelId })
    return false
  }
}

function buildWorkflowFailureDiscordEmbed(p: WorkflowFailurePayload): DiscordEmbed {
  const color = p.severity === 'warning' ? 0xd97706 : 0xdc2626
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Workflow', value: p.workflowName, inline: true },
  ]
  if (p.failedStepName) {
    fields.push({ name: 'Failed step', value: p.failedStepName, inline: true })
  }
  if (p.hint) {
    fields.push({ name: 'What to do', value: p.hint, inline: false })
  }
  if (p.cta) {
    fields.push({
      name: 'Action',
      value: `[${p.cta.label}](${p.cta.url})`,
      inline: false,
    })
  }
  if (p.technicalDetails) {
    const truncated =
      p.technicalDetails.length > 500
        ? `${p.technicalDetails.slice(0, 500)}…`
        : p.technicalDetails
    fields.push({
      name: 'Technical details',
      value: `\`\`\`${truncated}\`\`\``,
      inline: false,
    })
  }

  return {
    title: p.title,
    description: p.description,
    color,
    fields,
    timestamp: new Date().toISOString(),
  }
}
