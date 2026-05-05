/**
 * Slack Notification Service
 */

import { logger } from '@/lib/utils/logger'
import { createSupabaseServerClient } from '@/utils/supabase/server'
import { CONNECTED_STATUSES_LIST } from '@/lib/integrations/connectionStatus'

interface SlackMessage {
  channel: string
  text: string
  blocks?: any[]
}

/**
 * Send Slack notification to a channel
 */
export async function sendSlackMessage(
  channelId: string,
  message: string,
  userId: string
): Promise<boolean> {
  try {
    // Get user's Slack integration
    const supabase = await createSupabaseServerClient()

    const { data: integration, error } = await supabase
      .from('integrations')
      .select('credentials')
      .eq('user_id', userId)
      .eq('provider', 'slack')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (error || !integration) {
      logger.error('Slack integration not found for user:', userId)
      return false
    }

    const accessToken = integration.credentials?.access_token

    if (!accessToken) {
      logger.error('Slack access token not found')
      return false
    }

    // Send message via Slack API
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channelId,
        text: message,
        blocks: formatSlackBlocks(message),
      }),
    })

    const data = await response.json()

    if (!data.ok) {
      logger.error('Slack API error:', data.error)
      return false
    }

    logger.info('Slack message sent successfully:', {
      channel: channelId,
      ts: data.ts
    })

    return true
  } catch (error: any) {
    logger.error('Failed to send Slack message:', {
      error: error.message,
      channelId
    })
    return false
  }
}

import type { WorkflowFailurePayload } from './workflowFailurePayload'

/**
 * Send workflow error to Slack with humanized blocks.
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
    const { data: integration, error } = await supabase
      .from('integrations')
      .select('credentials')
      .eq('user_id', userId)
      .eq('provider', 'slack')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (error || !integration) {
      logger.error('Slack integration not found for user:', userId)
      return false
    }
    const accessToken = (integration.credentials as any)?.access_token
    if (!accessToken) {
      logger.error('Slack access token not found')
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
