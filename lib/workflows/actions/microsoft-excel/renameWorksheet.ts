/**
 * Rename Worksheet in Excel Action
 * Renames an existing worksheet (tab) in an Excel workbook
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { logger } from '@/lib/utils/logger'
import type { ActionResult } from '@/lib/workflows/actions/core/executeWait'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'

interface RenameWorksheetConfig {
  workbookId: string
  worksheetName: string
  newWorksheetName: string
}

/**
 * Rename an existing worksheet in an Excel workbook
 */
export async function renameMicrosoftExcelWorksheet(
  config: RenameWorksheetConfig,
  context: { userId: string }
): Promise<ActionResult> {
  const { workbookId, worksheetName, newWorksheetName } = config
  const { userId } = context

  logger.info('[Microsoft Excel] Renaming worksheet:', { workbookId, worksheetName, newWorksheetName })

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

    // Rename the worksheet using Microsoft Graph API
    // Encode worksheet name for URL safety (handles spaces and special chars)
    const encodedWorksheetName = encodeURIComponent(worksheetName)
    const renameUrl = `${GRAPH_API_BASE}/me/drive/items/${workbookId}/workbook/worksheets('${encodedWorksheetName}')`

    const renameResponse = await fetch(renameUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: newWorksheetName
      })
    })

    if (!renameResponse.ok) {
      const errorText = await renameResponse.text()
      return {
        success: false,
        output: {},
        message: `Failed to rename worksheet: ${errorText}`
      }
    }

    const result = await renameResponse.json()

    logger.info('[Microsoft Excel] Successfully renamed worksheet')

    return {
      success: true,
      output: {
        worksheetId: result.id,
        oldName: worksheetName,
        newName: result.name,
        position: result.position,
        workbookId,
        timestamp: new Date().toISOString()
      },
      message: `Successfully renamed worksheet from "${worksheetName}" to "${result.name}"`
    }

  } catch (error: any) {
    logger.error('[Microsoft Excel] Error renaming worksheet:', error)
    return {
      success: false,
      output: {},
      message: `Failed to rename worksheet: ${error.message}`
    }
  }
}
