/**
 * OneNote Polling Trigger Handler
 *
 * Polls OneNote for new pages in specified notebooks/sections
 */

import { createSupabaseServiceClient } from '@/utils/supabase/server'
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

interface OneNotePollingConfig {
  notebookId: string
  sectionId?: string
  pollingInterval?: string
}

/**
 * Get Microsoft Graph access token for OneNote
 */
async function getOneNoteAccessToken(userId: string): Promise<string | null> {
  const supabase = await createSupabaseServiceClient()

  const providerCandidates = [
    'microsoft-onenote',
    'microsoft_onenote',
    'onenote',
  ]

  for (const provider of providerCandidates) {
    const { data: integration } = await supabase
      .from('integrations')
      .select('access_token')
      .eq('user_id', userId)
      .eq('provider', provider)
      .in('status', CONNECTED_STATUSES_LIST)
      .maybeSingle()

    if (integration?.access_token) {
      return integration.access_token as string
    }
  }

  return null
}

/**
 * Fetch new notes from OneNote since last poll
 */
export async function pollOneNoteForNewNotes(
  userId: string,
  workflowId: string,
  config: OneNotePollingConfig,
  lastPollTime?: string
): Promise<any[]> {
  try {
    const accessToken = await getOneNoteAccessToken(userId)
    if (!accessToken) {
      logger.error('[OneNote Poll] No access token found for user:', { userId })
      return []
    }

    // Build the API URL based on configuration
    let apiUrl = 'https://graph.microsoft.com/v1.0/me/onenote/pages'

    if (config.sectionId) {
      apiUrl = `https://graph.microsoft.com/v1.0/me/onenote/sections/${config.sectionId}/pages`
    } else if (config.notebookId) {
      // Get all sections in the notebook
      const sectionsUrl = `https://graph.microsoft.com/v1.0/me/onenote/notebooks/${config.notebookId}/sections`
      const sectionsResponse = await fetch(sectionsUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })

      if (!sectionsResponse.ok) {
        logger.error('[OneNote Poll] Failed to fetch sections:', {
          status: sectionsResponse.status,
          statusText: sectionsResponse.statusText
        })
        return []
      }

      const sectionsData = await sectionsResponse.json()
      const sections = sectionsData.value || []

      // Fetch pages from all sections in parallel
      const allPages: any[] = []

      for (const section of sections) {
        const sectionApiUrl = `https://graph.microsoft.com/v1.0/me/onenote/sections/${section.id}/pages`

        // Add filter for creation time if lastPollTime exists
        const filter = lastPollTime
          ? `?$filter=createdDateTime gt ${lastPollTime}&$orderby=createdDateTime desc&$top=50`
          : '?$orderby=createdDateTime desc&$top=50'

        const pagesResponse = await fetch(sectionApiUrl + filter, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        })

        if (pagesResponse.ok) {
          const pagesData = await pagesResponse.json()
          allPages.push(...(pagesData.value || []))
        }
      }

      return allPages.map(page => formatPageOutput(page, config.notebookId, null))
    }

    // Add filter for creation time if lastPollTime exists
    const filter = lastPollTime
      ? `?$filter=createdDateTime gt ${lastPollTime}&$orderby=createdDateTime desc&$top=50`
      : '?$orderby=createdDateTime desc&$top=50'

    const response = await fetch(apiUrl + filter, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      logger.error('[OneNote Poll] Failed to fetch pages:', {
        status: response.status,
        statusText: response.statusText
      })
      return []
    }

    const data = await response.json()
    const pages = data.value || []

    logger.info('[OneNote Poll] Found new pages:', {
      count: pages.length,
      userId,
      workflowId
    })

    // Format pages for workflow execution
    return pages.map((page: any) => formatPageOutput(page, config.notebookId, config.sectionId))

  } catch (error: any) {
    logger.error('[OneNote Poll] Error polling for new notes:', {
      error: error.message,
      userId,
      workflowId
    })
    return []
  }
}

/**
 * Format page output to match the trigger output schema
 */
function formatPageOutput(page: any, notebookId?: string, sectionId?: string) {
  return {
    id: page.id,
    title: page.title,
    content: page.content || '',
    contentUrl: page.contentUrl,
    webUrl: page.links?.oneNoteWebUrl?.href || page.webUrl,
    createdDateTime: page.createdDateTime,
    lastModifiedDateTime: page.lastModifiedDateTime,
    level: page.level || 0,
    order: page.order || 0,
    notebookId: notebookId,
    notebookName: '', // Would need additional API call to get name
    sectionId: sectionId || page.parentSection?.id,
    sectionName: page.parentSection?.displayName || ''
  }
}

/**
 * Get or create last poll timestamp for a workflow trigger
 */
export async function getLastPollTime(workflowId: string, nodeId: string): Promise<string | null> {
  const supabase = await createSupabaseServiceClient()

  const { data } = await supabase
    .from('trigger_poll_state')
    .select('last_poll_time')
    .eq('workflow_id', workflowId)
    .eq('node_id', nodeId)
    .maybeSingle()

  return data?.last_poll_time || null
}

/**
 * Update last poll timestamp for a workflow trigger
 */
export async function updateLastPollTime(workflowId: string, nodeId: string): Promise<void> {
  const supabase = await createSupabaseServiceClient()

  await supabase
    .from('trigger_poll_state')
    .upsert({
      workflow_id: workflowId,
      node_id: nodeId,
      last_poll_time: new Date().toISOString()
    }, {
      onConflict: 'workflow_id,node_id'
    })
}
