/**
 * Create Worksheet in Excel Action
 * Creates a new worksheet (tab) in an Excel workbook
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { logger } from '@/lib/utils/logger'
import type { ActionResult } from '@/lib/workflows/actions/core/executeWait'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'

interface CreateWorksheetConfig {
  workbookId: string
  worksheetName: string
}

/**
 * Create a new worksheet in an Excel workbook
 */
export async function createMicrosoftExcelWorksheet(
  config: CreateWorksheetConfig,
  context: { userId: string }
): Promise<ActionResult> {
  const { workbookId, worksheetName } = config
  const { userId } = context

  logger.info('[Microsoft Excel] Creating worksheet:', { workbookId, worksheetName })

  try {
    // Get Microsoft Excel integration
    const supabase = createAdminClient()
    const { data: integration, error } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'microsoft-excel')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (error || !integration) {
      return {
        success: false,
        output: {},
        message: 'Microsoft Excel integration not found or not connected'
      }
    }

    // Decrypt access token
    const accessToken = await decrypt(integration.access_token)

    // Sanitize worksheet name: Excel forbids \ / ? * [ ] and names > 31 chars
    const sanitizedName = (worksheetName || 'Sheet')
      .replace(/[\\/?*\[\]]/g, '')
      .trim()
      .slice(0, 31) || 'Sheet'

    // Create the worksheet using Microsoft Graph API
    const createUrl = `${GRAPH_API_BASE}/me/drive/items/${workbookId}/workbook/worksheets`

    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: sanitizedName
      })
    })

    if (!createResponse.ok) {
      const errorText = await createResponse.text()
      return {
        success: false,
        output: {},
        message: `Failed to create worksheet: ${errorText}`
      }
    }

    const result = await createResponse.json()

    logger.info('[Microsoft Excel] Successfully created worksheet')

    return {
      success: true,
      output: {
        worksheetId: result.id,
        worksheetName: result.name,
        position: result.position,
        visibility: result.visibility,
        workbookId,
        timestamp: new Date().toISOString()
      },
      message: `Successfully created worksheet "${result.name}" in workbook`
    }

  } catch (error: any) {
    logger.error('[Microsoft Excel] Error creating worksheet:', error)
    return {
      success: false,
      output: {},
      message: `Failed to create worksheet: ${error.message}`
    }
  }
}
