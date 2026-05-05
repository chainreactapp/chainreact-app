import { NextResponse } from 'next/server'
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const workflowId = searchParams.get('workflowId')

  const supabase = await createSupabaseRouteHandlerClient()

  // Get the current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return errorResponse('Unauthorized' , 401)
  }

  try {
    switch (type) {
      case 'previous_nodes': {
        // Get nodes from the current workflow that produce output
        if (!workflowId) {
          return jsonResponse([])
        }

        const { data: workflow } = await supabase
          .from('workflows')
          .select('configuration')
          .eq('id', workflowId)
          .single()

        if (!workflow?.configuration?.nodes) {
          return jsonResponse([])
        }

        // Filter nodes that produce output and are not UI nodes
        const outputNodes = workflow.configuration.nodes
          .filter((node: any) => {
            // Exclude UI placeholder nodes
            if (node.type === 'addAction' || node.type === 'insertAction') {
              return false
            }
            // Exclude the AI Agent itself to prevent circular references
            if (node.data?.type === 'ai_agent' || node.data?.type === 'ai_message') {
              return false
            }
            // Include nodes that typically produce output
            return node.data?.producesOutput !== false
          })
          .map((node: any) => ({
            value: node.id,
            label: node.data?.title || node.data?.type || node.id,
            description: node.data?.description || `Output from ${node.data?.type}`,
            type: node.data?.type,
            icon: node.data?.icon
          }))

        return jsonResponse(outputNodes)
      }

      case 'connected_integrations': {
        // Get all connected integrations for memory selection
        const { data: integrations } = await supabase
          .from('integrations')
          .select('provider, status, created_at')
          .eq('user_id', user.id)
          .in('status', CONNECTED_STATUSES_LIST)
          .order('created_at', { ascending: false })

        if (!integrations) {
          return jsonResponse([])
        }

        // Map to options format with proper labels
        const integrationOptions = integrations.map(integration => {
          // Provider name mapping for display
          const providerLabels: Record<string, string> = {
            'gmail': 'Gmail',
            'slack': 'Slack',
            'discord': 'Discord',
            'notion': 'Notion',
            'airtable': 'Airtable',
            'hubspot': 'HubSpot',
            'google-drive': 'Google Drive',
            'google-sheets': 'Google Sheets',
            'google-calendar': 'Google Calendar',
            'google-docs': 'Google Docs',
            'onedrive': 'OneDrive',
            'dropbox': 'Dropbox',
            'box': 'Box',
            'teams': 'Microsoft Teams',
            'outlook': 'Outlook',
            'onenote': 'OneNote',
            'trello': 'Trello',
            'github': 'GitHub',
            'gitlab': 'GitLab',
          }

          return {
            value: integration.provider,
            label: providerLabels[integration.provider] || integration.provider,
            description: `Connected ${new Date(integration.created_at).toLocaleDateString()}`,
            hasMemory: ['gmail', 'google-drive', 'notion', 'slack', 'airtable', 'google-sheets', 'onedrive', 'dropbox', 'box'].includes(integration.provider)
          }
        })

        return jsonResponse(integrationOptions)
      }

      default:
        return errorResponse('Invalid type parameter' , 400)
    }
  } catch (error) {
    logger.error('Error fetching AI data:', error)
    return errorResponse('Failed to fetch data' , 500)
  }
}
