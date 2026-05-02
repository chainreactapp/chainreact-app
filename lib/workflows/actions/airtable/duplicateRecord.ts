import { getDecryptedAccessToken, resolveValue, ActionResult } from '@/lib/workflows/actions/core'
import { refreshAndRetry } from '@/lib/workflows/actions/core/refreshAndRetry'
import { logger } from '@/lib/utils/logger'

/**
 * Duplicate an Airtable record with optional field selection and overrides
 *
 * This action:
 * 1. Fetches the source record
 * 2. Copies selected fields (from duplicateConfig.fieldsToCopy)
 * 3. Applies field overrides (from duplicateConfig.fieldsToOverride)
 * 4. Creates a new record with the duplicated + overridden values
 */
export async function duplicateAirtableRecord(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info("📋 [Airtable] Duplicating record...");

    // Validate config
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid configuration provided');
    }

    const accessToken = await getDecryptedAccessToken(userId, "airtable");

    const baseId = resolveValue(config.baseId, input);
    const tableName = resolveValue(config.tableName, input);
    const recordId = resolveValue(config.recordId, input);

    // Get duplication configuration
    const duplicateConfig = config.duplicateConfig || {
      fieldsToCopy: [], // If not set, copy no fields
      fieldsToOverride: {}
    };

    const { fieldsToCopy = [], fieldsToOverride = {} } = duplicateConfig;

    if (!baseId || !tableName || !recordId) {
      const missingFields = [];
      if (!baseId) missingFields.push("Base ID");
      if (!tableName) missingFields.push("Table Name");
      if (!recordId) missingFields.push("Record ID");

      const message = `Missing required fields for duplicating record: ${missingFields.join(", ")}`;
      logger.error(message);
      return { success: false, message };
    }

    logger.info(`📋 [Airtable] Fetching source record ${recordId} from ${tableName}...`);

    // Step 1: Fetch the source record
    const fetchResponse = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}/${recordId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text().catch(() => fetchResponse.statusText);
      logger.error(`❌ [Airtable] Failed to fetch source record: ${errorText}`);
      return {
        success: false,
        message: `Failed to fetch source record: ${fetchResponse.status} ${errorText}`
      };
    }

    const sourceRecord = await fetchResponse.json();
    const sourceFields = sourceRecord.fields || {};

    logger.info(`📋 [Airtable] Source record fetched. Fields: ${Object.keys(sourceFields).join(', ')}`);

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

    // Step 2: Build new record fields
    const newFields: Record<string, any> = {};

    // Copy selected fields
    if (fieldsToCopy.length === 0) {
      logger.warn(`⚠️ [Airtable] No fields selected to copy. Duplicate will be empty.`);
    } else {
      fieldsToCopy.forEach((fieldName: string) => {
        if (sourceFields.hasOwnProperty(fieldName)) {
          let fieldValue = sourceFields[fieldName];

          // Get field info from schema
          const fieldInfo = tableSchema?.fields?.find((f: any) => f.id === fieldName || f.name === fieldName)

          // Clean attachment fields - Airtable only accepts url and filename
          if (fieldInfo && (fieldInfo.type === 'multipleAttachments' || fieldInfo.type === 'attachment')) {
            if (Array.isArray(fieldValue)) {
              fieldValue = fieldValue.map((att: any) => ({
                url: att.url,
                filename: att.filename
              }));
              logger.info(`📎 [Airtable] Cleaned attachment field: ${fieldName} (${fieldValue.length} attachments)`);
            }
          }
          // Format date/datetime fields based on schema
          else if (fieldInfo && (fieldInfo.type === 'date' || fieldInfo.type === 'dateTime')) {
            fieldValue = formatDateForAirtable(fieldValue, fieldInfo)
          }

          newFields[fieldName] = fieldValue;
          logger.info(`✅ [Airtable] Copying field: ${fieldName}`);
        } else {
          logger.info(`⚠️ [Airtable] Field not found in source record: ${fieldName}`);
        }
      });
    }

    // Apply overrides
    Object.entries(fieldsToOverride).forEach(([fieldName, overrideValue]) => {
      let resolved = resolveValue(overrideValue, input);

      // Format date/datetime fields based on schema
      const fieldInfo = tableSchema?.fields?.find((f: any) => f.id === fieldName || f.name === fieldName)
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

      newFields[fieldName] = resolved;
      logger.debug(`[Airtable] Overriding field: ${fieldName}`);
    });

    logger.info(`📋 [Airtable] Creating duplicate with ${Object.keys(newFields).length} fields...`);

    // Step 3: Create the new record
    const createResponse = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: newFields }),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text().catch(() => createResponse.statusText);
      logger.error(`❌ [Airtable] Failed to create duplicate record: ${errorText}`);
      return {
        success: false,
        message: `Failed to create duplicate record: ${createResponse.status} ${errorText}`
      };
    }

    const newRecord = await createResponse.json();

    logger.info(`✅ [Airtable] Record duplicated successfully. New ID: ${newRecord.id}`);

    return {
      success: true,
      message: 'Record duplicated successfully',
      data: {
        newRecordId: newRecord.id,
        originalRecordId: recordId,
        fields: newRecord.fields,
        createdTime: newRecord.createdTime,
        copiedFieldCount: fieldsToCopy.length,
        overriddenFieldCount: Object.keys(fieldsToOverride).length
      }
    };

  } catch (error: any) {
    logger.error("❌ [Airtable] Error duplicating record:", error);
    return {
      success: false,
      message: error.message || 'Failed to duplicate record',
      error: error.message
    };
  }
}
