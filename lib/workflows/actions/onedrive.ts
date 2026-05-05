/**
 * OneDrive Actions
 */

import { ActionResult } from './core/executeWait'
import { getDecryptedAccessToken } from './core/getDecryptedAccessToken'
import { resolveValue } from './core/resolveValue'

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Upload a file to OneDrive
 */
export async function uploadFileToOneDrive(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info('📤 [OneDrive] Starting file upload with config:', {
      fileName: config.fileName,
      sourceType: config.sourceType,
      folderId: config.folderId
    })

    const resolvedConfig = resolveValue(config, input)

    // Extract configuration
    const sourceType = resolvedConfig.sourceType || 'file'
    const folderId = resolvedConfig.folderId || null
    const userProvidedFileName = resolvedConfig.fileName // User's desired filename (may or may not have extension)

    // Get the file content based on source type
    let fileContent: any
    let mimeType = 'application/octet-stream'
    let originalFileName = '' // Original filename with extension
    let actualFileName = 'untitled.txt' // Final filename to use

    switch (sourceType) {
      case 'file':
        // Handle uploaded files
        if (resolvedConfig.uploadedFiles) {
          // uploadedFiles should be an array of file objects from the file upload
          const files = Array.isArray(resolvedConfig.uploadedFiles) ? resolvedConfig.uploadedFiles : [resolvedConfig.uploadedFiles]
          if (files.length > 0) {
            const file = files[0] // For now, handle single file upload

            // Check if it's a temporary file object with filePath
            if (file.filePath && file.isTemporary) {
              // For temporary files, fetch directly from Supabase storage
              logger.info('📂 [OneDrive] Fetching temporary file from storage:', {
                nodeId: file.nodeId || file.id,
                filePath: file.filePath,
                fileName: file.fileName,
                isTemp: true
              })

              const { createSupabaseServerClient } = await import('@/utils/supabase/server')
              const supabase = await createSupabaseServerClient()

              const { data: downloadedFile, error: downloadError } = await supabase.storage
                .from('workflow-files')
                .download(file.filePath)

              if (downloadError || !downloadedFile) {
                throw new Error(`Failed to download file from storage: ${downloadError?.message || 'Unknown error'}`)
              }

              // Convert blob to buffer
              const arrayBuffer = await downloadedFile.arrayBuffer()
              fileContent = Buffer.from(arrayBuffer)

              // Store original filename and preserve mime type
              originalFileName = file.fileName || 'untitled.txt'
              mimeType = file.mimeType || file.fileType || 'application/octet-stream'
            }
            // If it's a file ID string or object with ID, use FileStorageService
            else if (typeof file === 'string' || file.id) {
              const fileId = typeof file === 'string' ? file : file.id
              logger.info('📁 [OneDrive] Fetching permanent file using FileStorageService:', fileId)

              const { FileStorageService } = await import('@/lib/storage/fileStorage')
              const fileStorage = new FileStorageService()
              const storedFile = await fileStorage.getFile(fileId, userId)

              if (!storedFile) {
                throw new Error(`File not found in storage: ${fileId}`)
              }

              fileContent = Buffer.from(storedFile.content, 'base64')

              // Store original filename and preserve mime type from stored file
              originalFileName = storedFile.name || file.fileName || 'untitled.txt'
              mimeType = storedFile.mimeType || storedFile.type || 'application/octet-stream'
            } else if (file.content) {
              // Direct file content
              fileContent = Buffer.from(file.content, 'base64')

              // Store original filename and preserve mime type
              originalFileName = file.fileName || file.name || 'untitled.txt'
              mimeType = file.mimeType || file.type || 'application/octet-stream'
            }
          } else {
            throw new Error('No file uploaded')
          }
        } else {
          throw new Error('No file provided for upload')
        }
        break

      case 'url':
        // Download file from URL
        const fileUrl = resolvedConfig.fileUrl
        if (!fileUrl) {
          throw new Error('File URL is required')
        }

        logger.info('📥 [OneDrive] Downloading file from URL:', fileUrl)
        const urlResponse = await fetch(fileUrl)
        if (!urlResponse.ok) {
          throw new Error(`Failed to download file from URL: ${urlResponse.statusText}`)
        }

        const arrayBuffer = await urlResponse.arrayBuffer()
        fileContent = Buffer.from(arrayBuffer)
        mimeType = urlResponse.headers.get('content-type') || 'application/octet-stream'

        // Extract filename from URL
        const urlPath = new URL(fileUrl).pathname
        const urlFileName = urlPath.split('/').pop()
        if (urlFileName) {
          originalFileName = decodeURIComponent(urlFileName)
        }
        break

      case 'text':
        // Create text file from content
        const textContent = resolvedConfig.fileContent
        if (!textContent) {
          throw new Error('Text content is required')
        }

        fileContent = Buffer.from(textContent, 'utf-8')
        mimeType = 'text/plain'

        // Text files default to .txt
        originalFileName = 'document.txt'
        break

      case 'node':
        // Get file from previous node output
        const fileVar = resolvedConfig.fileFromNode
        if (!fileVar) {
          throw new Error('File variable is required')
        }

        // Handle different file formats from nodes
        if (typeof fileVar === 'string') {
          // Base64 encoded content
          fileContent = Buffer.from(fileVar, 'base64')
          originalFileName = 'file-from-node'
        } else if (fileVar.content) {
          // File object with content
          fileContent = Buffer.from(fileVar.content, fileVar.encoding || 'base64')
          mimeType = fileVar.mimeType || fileVar.type || 'application/octet-stream'
          // Preserve filename from node if available
          originalFileName = fileVar.fileName || fileVar.name || 'file-from-node'
        } else if (Buffer.isBuffer(fileVar)) {
          fileContent = fileVar
          originalFileName = 'file-from-node'
        } else {
          throw new Error('Invalid file format from previous node')
        }
        break

      default:
        throw new Error(`Unknown source type: ${sourceType}`)
    }

    // Validate file content
    if (!fileContent) {
      throw new Error('No file content to upload')
    }

    // Determine the final filename
    if (userProvidedFileName) {
      // Extract extension from original filename
      const originalExt = originalFileName.includes('.')
        ? originalFileName.substring(originalFileName.lastIndexOf('.'))
        : ''

      // Check if user's filename already has an extension
      const userHasExt = userProvidedFileName.includes('.')

      if (userHasExt) {
        // User provided their own extension, use as-is
        actualFileName = userProvidedFileName
      } else if (originalExt) {
        // User didn't provide extension, add the original one
        actualFileName = userProvidedFileName + originalExt
      } else {
        // No original extension and user didn't provide one
        actualFileName = userProvidedFileName
      }
    } else {
      // No user-provided name, use the original filename
      actualFileName = originalFileName || 'untitled.txt'
    }

    // Get file size
    const fileSizeInBytes = fileContent.length
    const fileSizeInMB = fileSizeInBytes / (1024 * 1024)

    logger.info('📊 [OneDrive] File info:', {
      name: actualFileName,
      originalName: originalFileName,
      userProvidedName: userProvidedFileName,
      size: `${fileSizeInMB.toFixed(2)} MB`,
      mimeType
    })

    // Check file size limit (100MB for OneDrive)
    if (fileSizeInMB > 100) {
      throw new Error(`File size (${fileSizeInMB.toFixed(2)} MB) exceeds OneDrive limit of 100 MB`)
    }

    // Get OneDrive integration
    const { createSupabaseServerClient } = await import('@/utils/supabase/server')
    const supabase = await createSupabaseServerClient()

    const { data: integration } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .in('provider', ['onedrive', 'microsoft-onedrive'])
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      throw new Error('OneDrive integration not connected')
    }

    // Get decrypted access token
    const { getDecryptedAccessToken } = await import('./core/getDecryptedAccessToken')
    const accessToken = await getDecryptedAccessToken(userId, integration.provider)

    if (!accessToken) {
      throw new Error('Failed to get OneDrive access token')
    }

    // Construct upload URL
    let uploadUrl: string
    if (folderId) {
      // Upload to specific folder
      uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}:/${encodeURIComponent(actualFileName)}:/content`
    } else {
      // Upload to root
      uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(actualFileName)}:/content`
    }

    logger.info('🚀 [OneDrive] Uploading file to:', uploadUrl)

    // Upload file to OneDrive
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': mimeType,
        'Content-Length': fileSizeInBytes.toString()
      },
      body: fileContent
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      logger.error('❌ [OneDrive] Upload failed:', {
        status: uploadResponse.status,
        error: errorText
      })

      if (uploadResponse.status === 401) {
        throw new Error('OneDrive authentication expired. Please reconnect your account.')
      } else if (uploadResponse.status === 403) {
        throw new Error('Permission denied. Check your OneDrive permissions.')
      } else if (uploadResponse.status === 507) {
        throw new Error('OneDrive storage quota exceeded')
      } else {
        throw new Error(`Failed to upload file: ${uploadResponse.statusText}`)
      }
    }

    const uploadResult = await uploadResponse.json()

    logger.info('✅ [OneDrive] File uploaded successfully:', {
      id: uploadResult.id,
      name: uploadResult.name,
      size: uploadResult.size,
      webUrl: uploadResult.webUrl
    })

    // Return file details in ActionResult format
    return {
      success: true,
      output: {
        fileId: uploadResult.id,
        fileName: uploadResult.name,
        fileSize: uploadResult.size,
        mimeType: uploadResult.file?.mimeType || mimeType,
        webUrl: uploadResult.webUrl,
        downloadUrl: uploadResult['@microsoft.graph.downloadUrl'],
        createdDateTime: uploadResult.createdDateTime,
        lastModifiedDateTime: uploadResult.lastModifiedDateTime,
        path: uploadResult.parentReference?.path,
        folderId: uploadResult.parentReference?.id
      },
      message: `File "${uploadResult.name}" uploaded successfully to OneDrive`
    }
  } catch (error: any) {
    logger.error('❌ [OneDrive] Upload error:', error)
    return {
      success: false,
      output: {},
      message: `OneDrive upload failed: ${error.message}`
    }
  }
}