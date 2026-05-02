import { getDecryptedAccessToken, resolveValue, ActionResult } from '@/lib/workflows/actions/core'
import { refreshAndRetry } from '@/lib/workflows/actions/core/refreshAndRetry'
import {
  AirtableAttachment,
  ensureArray,
  extractAttachmentCandidates,
  resolveAttachmentEntry,
  resolveTableId,
  UploadContext
} from './createRecord'
import { deleteTempAttachments, scheduleTempAttachmentCleanup } from './supabaseAttachment'

import { logger } from '@/lib/utils/logger'

/**
 * Updates an existing record in an Airtable table
 */
export async function updateAirtableRecord(
  config: any, 
  userId: string, 
  input: Record<string, any>
): Promise<ActionResult> {
  const cleanupPaths: string[] = []
  let recordUpdated = false

  try {
    const accessToken = await getDecryptedAccessToken(userId, "airtable")

    const baseId = resolveValue(config.baseId, input)
    const tableName = resolveValue(config.tableName, input)
    const recordId = resolveValue(config.recordId, input)
    const status = resolveValue(config.status, input)
    const tableId = resolveValue(config.tableId, input)

    const fields: Record<string, any> = {}

    try {
      for (const [key, value] of Object.entries(config || {})) {
        if (key.startsWith('airtable_field_')) {
          // Skip metadata fields (labels, bubbles, etc.) - they're not actual Airtable fields
          if (key.endsWith('_labels') || key.endsWith('_bubbles')) {
            continue
          }

          // Extract field name - use the exact field name from config
          // The field name in the config key is already the correct Airtable field name
          const fieldName = key.replace('airtable_field_', '')

          if (value !== undefined && typeof value !== 'function') {
            fields[fieldName] = value
          }
        }
      }
    } catch (err) {
      logger.error('Error extracting update fields from config:', err)
    }

    const directFields = config.fields || {}
    if (Object.keys(directFields).length > 0) {
      Object.assign(fields, directFields)
    }

    if (!baseId || !tableName || !recordId) {
      const missingFields = []
      if (!baseId) missingFields.push("Base ID")
      if (!tableName) missingFields.push("Table Name")
      if (!recordId) missingFields.push("Record ID")

      const message = `Missing required fields for updating record: ${missingFields.join(", ")}`
      logger.error(message)
      return { success: false, message }
    }

    const resolvedTableId = await resolveTableId(baseId, tableName, tableId, accessToken, userId)
    const uploadContext: UploadContext = {
      accessToken,
      baseId,
      tableId: resolvedTableId || tableId || tableName,
      tableName
    }

    // Fetch table schema to get field types and date formats. Auxiliary
    // schema GET wrapped in `refreshAndRetry` (Q3, §A5).
    let tableSchema: any = null
    try {
      const schemaResult = await refreshAndRetry({
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

      if (schemaResult.success) {
        const schemaResponse = schemaResult.data
        if (schemaResponse.ok) {
          const schemaJson = await schemaResponse.json()
          tableSchema = schemaJson.tables?.find((t: any) => t.name === tableName)
          if (tableSchema) {
            logger.info(`📊 [Airtable] Retrieved table schema with ${tableSchema.fields?.length || 0} fields`)
          }
        }
      }
    } catch (error) {
      logger.info('📊 [Airtable] Could not fetch table schema, proceeding without field type information')
    }

    const resolvedFields: Record<string, any> = {}
    const attachmentErrors: string[] = []
    const skippedFields: string[] = []

    // Get preserveExistingAttachments setting (default to true for append mode)
    const preserveExistingAttachments = config.preserveExistingAttachments === "false" ? false : true

    // Helper function to format date/datetime values based on field schema
    const formatDateForAirtable = (value: any, fieldInfo: any): any => {
      if (!fieldInfo || !value) return value

      const fieldType = fieldInfo.type

      // Only process date and dateTime fields
      if (fieldType !== 'date' && fieldType !== 'dateTime') {
        return value
      }

      // Convert to Date object if it's a string
      let date: Date
      if (typeof value === 'string') {
        date = new Date(value)
        if (isNaN(date.getTime())) {
          logger.info(`📊 [Airtable] Invalid date value for field "${fieldInfo.name}": ${value}`)
          return value
        }
      } else if (value instanceof Date) {
        date = value
      } else {
        return value
      }

      // Format based on field type
      if (fieldType === 'date') {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const formatted = `${year}-${month}-${day}`
        logger.info(`📊 [Airtable] Formatted date field "${fieldInfo.name}": ${formatted}`)
        return formatted
      } else if (fieldType === 'dateTime') {
        const formatted = date.toISOString()
        logger.info(`📊 [Airtable] Formatted datetime field "${fieldInfo.name}": ${formatted}`)
        return formatted
      }

      return value
    }

    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
        continue
      }

      let resolved = resolveValue(fieldValue, input)

      // Check if we have schema information for this field
      const fieldInfo = tableSchema?.fields?.find((f: any) => f.id === fieldName || f.name === fieldName)

      // Format date/datetime fields based on schema
      if (fieldInfo && (fieldInfo.type === 'date' || fieldInfo.type === 'dateTime')) {
        resolved = formatDateForAirtable(resolved, fieldInfo)
      }

      // Check if this field should remain as array (linked records)
      const shouldStayArray = Array.isArray(resolved) && (
        resolved.length > 1 ||
        (resolved.length > 0 && resolved.every((v: any) => typeof v === 'string' && v.startsWith('rec')))
      )

      // Don't unwrap arrays for linked record fields
      if (Array.isArray(resolved) && resolved.length === 1 && !shouldStayArray) {
        resolved = resolved[0]
        logger.info(`📊 [Airtable] Unwrapped single-element array for field "${fieldName}"`)
      }

      const normalizedFieldName = fieldName.replace(/_/g, ' ').toLowerCase()
      const isLikelyAttachment =
        normalizedFieldName.includes('image') ||
        normalizedFieldName.includes('photo') ||
        normalizedFieldName.includes('attachment') ||
        normalizedFieldName.includes('file') ||
        normalizedFieldName.includes('document') ||
        normalizedFieldName.includes('picture') ||
        normalizedFieldName.includes('media')

      const candidateEntries = extractAttachmentCandidates(resolved)

      if ((isLikelyAttachment || candidateEntries) && resolved) {
        const entries = candidateEntries ?? ensureArray(resolved)
        const attachments: AirtableAttachment[] = []
        let hadAttachmentIssue = false

        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index]
          try {
            const attachment = await resolveAttachmentEntry(
              entry,
              fieldName,
              index,
              uploadContext,
              cleanupPaths
            )

            if (attachment) {
              attachments.push(attachment)
            }
          } catch (attachmentError) {
            hadAttachmentIssue = true
            attachmentErrors.push(fieldName)
            logger.error(`❌ [Airtable] Error processing attachment for field "${fieldName}":`, attachmentError)
          }
        }

        if (attachments.length > 0) {
          // If preserving existing attachments, fetch current record and merge
          if (preserveExistingAttachments) {
            try {
              const currentRecordResponse = await fetch(
                `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}/${recordId}`,
                {
                  method: "GET",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                  },
                }
              )

              if (currentRecordResponse.ok) {
                const currentRecord = await currentRecordResponse.json()
                const existingAttachments = currentRecord.fields?.[fieldName]

                if (Array.isArray(existingAttachments) && existingAttachments.length > 0) {
                  // Merge existing attachments with new ones
                  resolvedFields[fieldName] = [...existingAttachments, ...attachments]
                  logger.info(`📎 [Airtable] Appending ${attachments.length} attachment(s) to ${existingAttachments.length} existing attachment(s) for field "${fieldName}"`)
                } else {
                  resolvedFields[fieldName] = attachments
                }
              } else {
                // If we can't fetch the current record, just use the new attachments
                resolvedFields[fieldName] = attachments
                logger.info(`📎 [Airtable] Could not fetch existing attachments, using new attachments only for field "${fieldName}"`)
              }
            } catch (fetchError) {
              // If fetching fails, just use the new attachments
              resolvedFields[fieldName] = attachments
              logger.info(`📎 [Airtable] Error fetching existing attachments, using new attachments only for field "${fieldName}"`)
            }
          } else {
            // Replace mode - just use the new attachments
            resolvedFields[fieldName] = attachments
            logger.info(`📎 [Airtable] Replacing existing attachments with ${attachments.length} new attachment(s) for field "${fieldName}"`)
          }
          continue
        }

        if (hadAttachmentIssue) {
          skippedFields.push(fieldName)
          continue
        }
      }

      if (typeof resolved === 'string' && resolved.startsWith('data:') && resolved.includes('base64,')) {
        skippedFields.push(fieldName)
        continue
      }

      resolvedFields[fieldName] = resolved
    }

    if (status) {
      resolvedFields.Status = status
    }

    if (Object.keys(resolvedFields).length === 0) {
      logger.info('📊 [Airtable] No fields to update for record', recordId)
    }

    if (attachmentErrors.length > 0) {
      logger.info(`📊 [Airtable] Encountered attachment issues with: ${[...new Set(attachmentErrors)].join(', ')}`)
    }

    if (skippedFields.length > 0) {
      logger.info(`📊 [Airtable] Skipped fields during update: ${skippedFields.join(', ')}`)
    }

    const response = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}/${recordId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: resolvedFields,
        }),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Failed to update record: ${response.status} - ${errorData.error?.message || response.statusText}`)
    }

    const result = await response.json()
    recordUpdated = true

    return {
      success: true,
      output: {
        recordId: result.id,
        fields: result.fields,
        updatedTime: new Date().toISOString(),
        tableName: tableName,
        baseId: baseId,
        status: status,
      },
      message: `Successfully updated record in ${tableName}`
    }

  } catch (error: any) {
    logger.error("Airtable update record error:", error)
    return {
      success: false,
      error: error.message || "An unexpected error occurred while updating the record"
    }
  } finally {
    if (cleanupPaths.length > 0) {
      if (recordUpdated) {
        scheduleTempAttachmentCleanup(cleanupPaths)
      } else {
        try {
          await deleteTempAttachments(cleanupPaths)
        } catch (cleanupError) {
          logger.error('❌ [Airtable] Failed to remove temporary attachments after update failure:', cleanupError)
        }
      }
    }
  }
}
