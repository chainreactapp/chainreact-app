import { NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient, createSupabaseServiceClient } from "@/utils/supabase/server"
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

async function getServiceClient() {
  return await createSupabaseServiceClient()
}

async function fetchIntegration({
  integrationId,
  userId
}: {
  integrationId?: string
  userId?: string
}) {
  const supabase = await getServiceClient()
  let query = supabase
    .from('integrations')
    .select('*')
    .eq('provider', 'microsoft-onenote')
    .in('status', CONNECTED_STATUSES_LIST)

  if (integrationId) {
    query = query.eq('id', integrationId)
  }
  if (userId) {
    query = query.eq('user_id', userId)
  }

  return query.single()
}

async function buildResponse(
  dataType: string,
  integration: any,
  options: { notebookId?: string; sectionId?: string } = {}
) {
  const { access_token } = integration

  switch (dataType) {
    case 'onenote_notebooks': {
      // Fetch notebooks from Microsoft Graph
      const response = await fetch('https://graph.microsoft.com/v1.0/me/onenote/notebooks', {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        logger.error('Failed to fetch OneNote notebooks', {
          status: response.status,
          statusText: response.statusText
        })
        throw new Error(`Failed to fetch notebooks: ${response.statusText}`)
      }

      const data = await response.json()
      return data.value.map((notebook: any) => ({
        value: notebook.id,
        label: notebook.displayName
      }))
    }

    case 'onenote_sections': {
      if (!options.notebookId) {
        return []
      }

      // Fetch sections for the specified notebook
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/onenote/notebooks/${options.notebookId}/sections`,
        {
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json'
          }
        }
      )

      if (!response.ok) {
        logger.error('Failed to fetch OneNote sections', {
          status: response.status,
          statusText: response.statusText,
          notebookId: options.notebookId
        })
        throw new Error(`Failed to fetch sections: ${response.statusText}`)
      }

      const data = await response.json()
      return data.value.map((section: any) => ({
        value: section.id,
        label: section.displayName
      }))
    }

    case 'onenote_pages': {
      // Pages must be fetched from a section, not a notebook
      if (!options.sectionId) {
        return []
      }

      // Fetch pages from the section
      const endpoint = `https://graph.microsoft.com/v1.0/me/onenote/sections/${options.sectionId}/pages`

      const response = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        logger.error('Failed to fetch OneNote pages', {
          status: response.status,
          statusText: response.statusText,
          sectionId: options.sectionId
        })
        throw new Error(`Failed to fetch pages: ${response.statusText}`)
      }

      const data = await response.json()
      return data.value.map((page: any) => ({
        value: page.id,
        label: page.title
      }))
    }

    default:
      throw new Error(`Unknown data type: ${dataType}`)
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseRouteHandlerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return errorResponse('Unauthorized' , 401)
    }

    const searchParams = request.nextUrl.searchParams
    const dataType = searchParams.get('dataType')
    const integrationId = searchParams.get('integrationId')
    const notebookId = searchParams.get('notebookId')

    if (!dataType) {
      return errorResponse('Missing dataType parameter' , 400)
    }

    logger.info('OneNote data request', { dataType, integrationId, notebookId })

    const { data: integration, error } = await fetchIntegration({
      integrationId: integrationId || undefined,
      userId: user.id
    })

    if (error || !integration) {
      logger.error('Integration not found or not connected', { error })
      return errorResponse('OneNote integration not connected' , 404)
    }

    const result = await buildResponse(dataType, integration, { notebookId: notebookId || undefined })

    return jsonResponse(result)
  } catch (error) {
    logger.error('Error in OneNote data endpoint:', error)
    return errorResponse(error instanceof Error ? error.message : 'Internal server error' , 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseRouteHandlerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { integrationId, dataType, options = {} } = body

    if (!dataType) {
      return errorResponse('Missing dataType parameter', 400)
    }

    logger.info('OneNote data POST request', { dataType, integrationId, options })

    const { data: integration, error } = await fetchIntegration({
      integrationId: integrationId || undefined,
      userId: user.id
    })

    if (error || !integration) {
      logger.error('Integration not found or not connected', { error })
      return errorResponse('OneNote integration not connected', 404)
    }

    // Extract notebookId from options - it could come from various parent fields
    const notebookId = options.notebookId || options.sourceNotebookId || options.targetNotebookId

    // Extract sectionId from options - it could come from various parent fields
    const sectionId = options.sectionId || options.sourceSectionId || options.targetSectionId

    const result = await buildResponse(dataType, integration, {
      notebookId: notebookId || undefined,
      sectionId: sectionId || undefined
    })

    // POST endpoint returns data wrapped in { data: [...] } format
    return jsonResponse({ data: result })
  } catch (error) {
    logger.error('Error in OneNote data POST endpoint:', error)
    return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500)
  }
}
