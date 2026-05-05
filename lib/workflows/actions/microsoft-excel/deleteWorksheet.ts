/**
 * Delete Worksheet in Excel Action
 * Deletes an existing worksheet (tab) from an Excel workbook
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { logger } from '@/lib/utils/logger'
import type { ActionResult } from '@/lib/workflows/actions/core/executeWait'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'

interface DeleteWorksheetConfig {
  workbookId: string
  worksheetName: string
}

/**
 * Delete a worksheet from an Excel workbook
 */
export async function deleteMicrosoftExcelWorksheet(
  config: DeleteWorksheetConfig,
  context: { userId: string }
): Promise<ActionResult> {
  const { workbookId, worksheetName } = config
  const { userId } = context

  logger.info('[Microsoft Excel] Deleting worksheet:', { workbookId, worksheetName })

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

    // Delete the worksheet using Microsoft Graph API
    // Encode worksheet name for URL safety (handles spaces and special chars)
    const encodedWorksheetName = encodeURIComponent(worksheetName)
    const deleteUrl = `${GRAPH_API_BASE}/me/drive/items/${workbookId}/workbook/worksheets('${encodedWorksheetName}')`

    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text()
      return {
        success: false,
        output: {},
        message: `Failed to delete worksheet: ${errorText}`
      }
    }

    logger.info('[Microsoft Excel] Successfully deleted worksheet')

    return {
      success: true,
      output: {
        deleted: true,
        worksheetName,
        workbookId,
        timestamp: new Date().toISOString()
      },
      message: `Successfully deleted worksheet "${worksheetName}"`
    }

  } catch (error: any) {
    logger.error('[Microsoft Excel] Error deleting worksheet:', error)
    return {
      success: false,
      output: {},
      message: `Failed to delete worksheet: ${error.message}`
    }
  }
}
