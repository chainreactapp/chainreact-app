import { ProviderOptionsLoader } from '../types'
import { getAuthHeader } from '@/lib/auth/getAuthHeader'

import { logger } from '@/lib/utils/logger'

export class GoogleDriveOptionsLoader implements ProviderOptionsLoader {
  private async getAuthHeaders(): Promise<HeadersInit> {
    // PR-AUTH-5: cached token path. Server returns 401 if token missing.
    return { 'Content-Type': 'application/json', ...(await getAuthHeader()) }
  }

  async loadOptions(params: {
    fieldName: string;
    providerId: string;
    integrationId?: string;
    nodeType?: string;
    dependsOn?: string;
    dependsOnValue?: any;
    forceRefresh?: boolean;
    extraOptions?: Record<string, any>;
  }): Promise<{ value: string; label: string; group?: string }[]> {
    const { fieldName, providerId, integrationId, nodeType, dependsOnValue, forceRefresh, extraOptions } = params;

    logger.info('[GoogleDriveOptionsLoader] Loading options for:', {
      fieldName,
      providerId,
      integrationId,
      nodeType,
      dependsOnValue,
      forceRefresh
    })

    // Get auth headers for all requests
    const headers = await this.getAuthHeaders()

    // For file preview, we need to fetch the file metadata
    if (fieldName === 'filePreview' && dependsOnValue) {
      try {
        const response = await fetch(`/api/integrations/google-drive/file-preview`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ fileId: dependsOnValue })
        })

        if (!response.ok) {
          logger.error('[GoogleDriveOptionsLoader] Failed to fetch file preview')
          return []
        }

        const data = await response.json()
        // Return preview as a single option (will be displayed in textarea)
        return [{
          value: data.preview || 'No preview available',
          label: 'Preview'
        }]
      } catch (error) {
        logger.error('[GoogleDriveOptionsLoader] Error fetching file preview:', error)
        return []
      }
    }

    // For file selection - determine data type based on node type
    if (fieldName === 'fileId') {
      try {
        // Determine data type based on node type
        const dataType = this.getDataTypeForField(fieldName, nodeType)

        // Get integration from Supabase
        if (!integrationId) {
          logger.error('[GoogleDriveOptionsLoader] No integration ID provided')
          return []
        }

        logger.info('[GoogleDriveOptionsLoader] Using data type:', dataType)

        // Use unified fetch-user-data endpoint
        const response = await fetch(`/api/integrations/fetch-user-data`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            integrationId,
            dataType,
            options: {
              folderId: dependsOnValue || undefined
            }
          })
        })

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'unknown')
          logger.error('[GoogleDriveOptionsLoader] Failed to fetch files:', {
            status: response.status,
            statusText: response.statusText,
            body: errorBody
          })
          return []
        }

        const result = await response.json()
        const items = result.data || result

        // Map to options format, preserving group property for grouped display
        return items.map((item: any) => ({
          value: item.value || item.id,
          label: item.label || item.name,
          ...(item.group && { group: item.group })
        }))
      } catch (error) {
        logger.error('[GoogleDriveOptionsLoader] Error fetching files:', error)
        return []
      }
    }

    // Default: Use the POST endpoint for other fields (like folders)
    const dataType = this.getDataTypeForField(fieldName, nodeType)
    if (!dataType) {
      logger.warn(`[GoogleDriveOptionsLoader] No data type mapping for field: ${fieldName}`)
      return []
    }

    if (!integrationId) {
      logger.error('[GoogleDriveOptionsLoader] No integration ID provided')
      return []
    }

    try {
      const response = await fetch(`/api/integrations/fetch-user-data`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          integrationId,
          dataType,
          options: {}
        })
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown')
        logger.error(`[GoogleDriveOptionsLoader] Failed to fetch ${dataType}:`, {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        })
        return []
      }

      const result = await response.json()
      const items = result.data || result

      return items.map((item: any) => ({
        value: item.value || item.id,
        label: item.label || item.name,
        ...(item.group && { group: item.group })
      }))
    } catch (error) {
      logger.error(`[GoogleDriveOptionsLoader] Error fetching ${dataType}:`, error)
      return []
    }
  }

  private getDataTypeForField(fieldName: string, nodeType?: string): string | null {
    // For fileId field, check if it's an action that needs grouped data
    if (fieldName === 'fileId' && (
      nodeType === 'google-drive:move_file' ||
      nodeType === 'google-drive:delete_file'
    )) {
      return 'google-drive-files-and-folders'
    }

    const fieldDataTypeMap: Record<string, string> = {
      folderId: 'google-drive-folders',
      parentFolderId: 'google-drive-folders',
      destinationFolderId: 'google-drive-folders',
      fileId: 'google-drive-files',
    }

    return fieldDataTypeMap[fieldName] || null
  }

  shouldReloadOnDependencyChange(fieldName: string, dependencyFieldName: string): boolean {
    // File selection should reload when folder changes
    if (fieldName === 'fileId' && dependencyFieldName === 'folderId') {
      return true
    }

    // File preview should reload when file selection changes
    if (fieldName === 'filePreview' && dependencyFieldName === 'fileId') {
      return true
    }

    return false
  }

  canHandle(fieldName: string, providerId: string): boolean {
    // This loader handles all Google Drive fields
    const supportedFields = [
      'folderId',
      'parentFolderId',
      'destinationFolderId',
      'fileId',
      'filePreview'
    ]

    return providerId === 'google-drive' && supportedFields.includes(fieldName)
  }
}