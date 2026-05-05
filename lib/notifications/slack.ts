/**
 * Slack Notification Service
 */

import { logger } from '@/lib/utils/logger'
import { createSupabaseServerClient } from '@/utils/supabase/server'
import type { WorkflowFailurePayload } from './workflowFailurePayload'

/**
 * Send workflow error to Slack with humanized blocks.
 *
 * Reads the bot token from `user_profiles.slack_notification_config`, which is
 * populated by the dedicated notification OAuth flow at
 * `/api/notifications/slack/callback`. This is a separate Slack connection
 * from the workflow Slack integration in the `integrations` table.
 */
export async function sendWorkflowErrorSlack(
  channelId: string,
  payload: WorkflowFailurePayload,
  userId: string
): Promise<boolean> {
  const fallback = `${payload.title} — workflow "${payload.workflowName}"`
  const blocks = buildWorkflowFailureSlackBlocks(payload)

  try {
    const supabase = await createSupabaseServerClient()
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('slack_notification_config')
      .eq('id', userId)
      .single()

    if (error || !profile?.slack_notification_config) {
      logger.error('Slack notification config not found for user:', userId)
      return false
    }

    const config = profile.slack_notification_config as { bot_token?: string }
    const accessToken = config.bot_token
    if (!accessToken) {
      logger.error('Slack bot token not found in notification config')
      return false
    }

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: channelId, text: fallback, blocks }),
    })
    const data = await response.json()
    if (!data.ok) {
      logger.error('Slack API error:', data.error)
      return false
    }
    return true
  } catch (err: any) {
    logger.error('Failed to send Slack workflow error:', { error: err.message, channelId })
    return false
  }
}

function buildWorkflowFailureSlackBlocks(p: WorkflowFailurePayload): any[] {
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: p.title, emoji: false },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: p.description },
    },
  ]

  if (p.hint) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_${p.hint}_` }],
    })
  }

  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Workflow:*\n${p.workflowName}` },
      ...(p.failedStepName
        ? [{ type: 'mrkdwn', text: `*Failed step:*\n${p.failedStepName}` }]
        : []),
    ],
  })

  if (p.cta) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: p.cta.label, emoji: false },
          url: p.cta.url,
          style: 'primary',
        },
      ],
    })
  }

  if (p.technicalDetails) {
    // Slack mrkdwn code blocks; truncate to keep messages skimmable
    const truncated = p.technicalDetails.length > 500
      ? `${p.technicalDetails.slice(0, 500)}…`
      : p.technicalDetails
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*Technical details:*\n\`\`\`${truncated}\`\`\`` }],
    })
  }

  return blocks
}
