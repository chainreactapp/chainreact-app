import { createClient } from '@supabase/supabase-js';

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "../connectionStatus"

// Helper to create supabase client inside handlers
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const tableNameCache = new Map<string, string>() // baseId:tableId -> tableName

async function resolveAirtableTableName(
  accessToken: string,
  baseId: string,
  tableId?: string
): Promise<string | null> {
  if (!tableId) return null

  const cacheKey = `${baseId}:${tableId}`
  if (tableNameCache.has(cacheKey)) {
    return tableNameCache.get(cacheKey) || null
  }

  try {
    const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) {
      logger.warn(`⚠️ Failed to resolve Airtable table name (${response.status}) for table ${tableId}`)
      return null
    }

    const data = await response.json()
    const table = data?.tables?.find((t: any) => t.id === tableId)

    if (table?.name) {
      tableNameCache.set(cacheKey, table.name)
      return table.name
    }
  } catch (error) {
    logger.error('❌ Error resolving Airtable table name:', error)
  }

  return null
}

/**
 * Verify if an Airtable record still exists using the user's OAuth token
 * @param userId - The user ID who owns the integration
 * @param baseId - The Airtable base ID
 * @param tableIdOrName - The Airtable table identifier (ID or name)
 * @param recordId - The Airtable record ID to verify
 * @param tableName - Optional table name fallback when tableIdOrName is an ID
 * @returns true if record exists, false if deleted or error
 */
export async function verifyAirtableRecord(
  userId: string,
  baseId: string,
  tableIdOrName: string,
  recordId: string,
  tableName?: string
): Promise<boolean> {
  try {
    // Get user's Airtable integration and access token
    const { data: integration, error: integrationError } = await getSupabase()
      .from('integrations')
      .select('access_token, status')
      .eq('user_id', userId)
      .eq('provider', 'airtable')
      .in('status', CONNECTED_STATUSES_LIST)
      .single();

    if (integrationError || !integration) {
      logger.error('❌ Failed to get Airtable integration:', integrationError);
      return false; // Can't verify, assume doesn't exist
    }

    // Decrypt the access token
    const { decryptToken } = await import('../tokenUtils');
    const accessToken = await decryptToken(integration.access_token);

    if (!accessToken) {
      logger.error('❌ Failed to decrypt Airtable access token');
      return false;
    }

    // Call Airtable API to check if record exists
    const initialCandidates = [
      tableName && tableName !== 'Unknown Table' ? tableName : null,
      tableIdOrName
    ].filter((candidate): candidate is string => !!candidate && candidate.trim().length > 0)

    const tried = new Set<string>()
    const queue: string[] = [...new Set(initialCandidates)]

    if (queue.length === 0) {
      logger.warn('⚠️ No table identifier provided for Airtable record verification');
      return true;
    }

    let metadataLookupAttempted = false

    while (true) {
      if (queue.length === 0) {
        if (!metadataLookupAttempted && tableIdOrName?.startsWith('tbl')) {
          metadataLookupAttempted = true
          const resolvedName = await resolveAirtableTableName(accessToken, baseId, tableIdOrName)

          if (resolvedName && !tried.has(resolvedName)) {
            logger.info(`🔁 Retrying verification with resolved table name: ${resolvedName}`)
            queue.push(resolvedName)
            continue
          }
        }

        break
      }

      const candidate = queue.shift()!

      if (tried.has(candidate)) {
        continue
      }

      tried.add(candidate)
      const encodedTable = encodeURIComponent(candidate);
      const encodedRecord = encodeURIComponent(recordId);

      const response = await fetch(
        `https://api.airtable.com/v0/${baseId}/${encodedTable}/${encodedRecord}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.status === 200) {
        logger.info(`✅ Record ${recordId} still exists (path: ${candidate})`);
        return true;
      }

      if (response.status === 404) {
        logger.info(`🗑️ Record ${recordId} not found via path ${candidate}`);
        // Try next candidate (e.g., table ID vs table name)
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        logger.warn(`🚫 Record ${recordId} not accessible (status ${response.status}) using path ${candidate}.`);

        if (!metadataLookupAttempted && tableIdOrName?.startsWith('tbl')) {
          metadataLookupAttempted = true
          const resolvedName = await resolveAirtableTableName(accessToken, baseId, tableIdOrName)

          if (resolvedName && !tried.has(resolvedName)) {
            logger.info(`🔁 Retrying verification with resolved table name: ${resolvedName}`)
            queue.push(resolvedName)
            continue
          }
        }

        logger.warn('   Assuming record is deleted or permissions revoked. Skipping execution.')
        return false;
      }

      if (response.status >= 500) {
        logger.error(`❌ Airtable server error (${response.status}) while verifying record ${recordId}. Proceeding to avoid dropping valid data.`);
        return true;
      }

      logger.warn(`⚠️ Unexpected status (${response.status}) verifying record ${recordId} via path ${candidate}. Proceeding cautiously.`);
      return true;
    }

    // If all candidates return 404 (and any metadata lookup failed), treat as deleted
    logger.info(`🗑️ Record ${recordId} missing across all table paths, skipping execution.`);
    return false;
  } catch (error) {
    logger.error('❌ Error verifying Airtable record:', error);
    // On error, process anyway to avoid losing legitimate records
    return true;
  }
}
