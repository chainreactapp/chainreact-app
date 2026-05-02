import { getDecryptedAccessToken, resolveValue, ActionResult } from '@/lib/workflows/actions/core'
import { refreshAndRetry } from '@/lib/workflows/actions/core/refreshAndRetry'
import { logger } from '@/lib/utils/logger'

/**
 * Gets the complete schema for an Airtable base (all tables and their structures)
 */
export async function getAirtableBaseSchema(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(userId, "airtable")

    const baseId = resolveValue(config.baseId, input)
    const includeTableViews = resolveValue(config.includeTableViews, input) ?? false

    if (!baseId) {
      const message = "Missing required field: Base ID"
      logger.error(message)
      return { success: false, message }
    }

    // Fetch the base schema from Airtable. Wrapped in `refreshAndRetry`
    // (Q3, §A5).
    const fetchResult = await refreshAndRetry({
      provider: 'airtable',
      userId,
      accessToken,
      call: async (token) =>
        fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }),
    })

    if (!fetchResult.success) {
      return { success: false, message: fetchResult.message }
    }
    const response = fetchResult.data

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Failed to get base schema: ${response.status} - ${errorData.error?.message || response.statusText}`)
    }

    const result = await response.json()
    const tables = result.tables || []

    // Process tables based on includeTableViews setting
    const processedTables = tables.map((table: any) => {
      const processedTable: any = {
        id: table.id,
        name: table.name,
        primaryFieldId: table.primaryFieldId,
        fields: table.fields || []
      }

      // Only include views if requested
      if (includeTableViews) {
        processedTable.views = table.views || []
      }

      return processedTable
    })

    // Calculate totals
    const totalFieldCount = processedTables.reduce((sum: number, table: any) =>
      sum + (table.fields?.length || 0), 0
    )

    const output = {
      baseId: baseId,
      baseName: result.name || baseId, // API might not return base name
      tables: processedTables,
      tableCount: processedTables.length,
      totalFieldCount
    }

    return {
      success: true,
      output,
      message: `Successfully retrieved schema for base with ${processedTables.length} tables and ${totalFieldCount} total fields`
    }

  } catch (error: any) {
    logger.error("Airtable get base schema error:", error)
    return {
      success: false,
      error: error.message || "An unexpected error occurred while getting base schema"
    }
  }
}
