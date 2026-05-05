/**
 * Add Row to Excel Table Action
 * Adds a new row to an Excel table using Microsoft Graph API
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/security/encryption'
import { logger } from '@/lib/utils/logger'
import type { ActionResult } from '@/lib/workflows/actions/core/executeWait'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'

interface AddTableRowConfig {
  workbookId: string
  tableName: string
  columnMapping: Record<string, any>
}

/**
 * Add a row to an Excel table
 */
export async function addMicrosoftExcelTableRow(
  config: AddTableRowConfig,
  context: { userId: string }
): Promise<ActionResult> {
  let { workbookId, tableName, columnMapping } = config
  const { userId } = context

  // Transform columnMapping from array format to object format if needed
  // The UI component (MicrosoftExcelColumnMapper) outputs: [{ column: "Name", value: "John" }]
  // But we need: { "Name": "John" }
  if (Array.isArray(columnMapping)) {
    logger.info('[Microsoft Excel] Converting array format to object format');
    const mappingObject: Record<string, any> = {};
    for (const item of columnMapping) {
      if (item && item.column && item.value !== undefined) {
        mappingObject[item.column] = item.value;
      }
    }
    columnMapping = mappingObject;
  }

  logger.info('[Microsoft Excel] Adding row to table:', { workbookId, tableName })

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

    // First, get the table columns to ensure correct order
    const columnsUrl = `${GRAPH_API_BASE}/me/drive/items/${workbookId}/workbook/tables/${tableName}/columns`

    const columnsResponse = await fetch(columnsUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!columnsResponse.ok) {
      const errorText = await columnsResponse.text()
      return {
        success: false,
        output: {},
        message: `Failed to fetch table columns: ${errorText}`
      }
    }

    const columnsData = await columnsResponse.json()
    const columns = columnsData.value || []

    // Build the row values array in the correct column order
    const rowValues: any[] = columns.map((column: any) => {
      const columnName = column.name
      return columnMapping[columnName] !== undefined ? columnMapping[columnName] : ''
    })

    // Add the row to the table
    const addRowUrl = `${GRAPH_API_BASE}/me/drive/items/${workbookId}/workbook/tables/${tableName}/rows`

    const addRowResponse = await fetch(addRowUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [rowValues]
      })
    })

    if (!addRowResponse.ok) {
      const errorText = await addRowResponse.text()
      return {
        success: false,
        output: {},
        message: `Failed to add row to table: ${errorText}`
      }
    }

    const result = await addRowResponse.json()

    logger.info('[Microsoft Excel] Successfully added row to table')

    return {
      success: true,
      output: {
        rowIndex: result.index || 0,
        values: result.values || [rowValues],
        tableName,
        workbookId,
        timestamp: new Date().toISOString()
      },
      message: `Successfully added row to table "${tableName}"`
    }

  } catch (error: any) {
    logger.error('[Microsoft Excel] Error adding row to table:', error)
    return {
      success: false,
      output: {},
      message: `Failed to add row to table: ${error.message}`
    }
  }
}
