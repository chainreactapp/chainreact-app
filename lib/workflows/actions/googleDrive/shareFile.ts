import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { refreshAndRetry } from '../core/refreshAndRetry'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import { requireExplicitField } from '../core/requireExplicitField'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Share a file or folder in Google Drive
 */
export async function shareGoogleDriveFile(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)

    // Q11 — sendNotification has user-facing side effects (auto-emails the
    // shared-with user). Previous silent default `true` removed; workflow
    // author must explicitly choose. Existing workflows are backfilled to
    // `true` (matches prior behavior) via the backfill registry.
    const missingRequired = requireExplicitField(resolvedConfig, 'sendNotification')
    if (missingRequired) return missingRequired as unknown as ActionResult

    const {
      fileId,
      shareType = 'user',
      emailAddress,
      role = 'reader',
      sendNotification,
      emailMessage
    } = resolvedConfig

    if (!fileId) {
      return {
        success: false,
        output: {},
        message: 'File or folder ID is required'
      }
    }

    if (shareType === 'user' && !emailAddress) {
      return {
        success: false,
        output: {},
        message: 'Email address is required when sharing with a specific person'
      }
    }

    const accessToken = await getDecryptedAccessToken(userId, "google-drive")
    const buildDriveClient = (token: string) => {
      const oauth2Client = new google.auth.OAuth2()
      oauth2Client.setCredentials({ access_token: token })
      return google.drive({ version: 'v3', auth: oauth2Client })
    }

    // Build permission request
    const permission: any = {
      role,
      type: shareType
    }

    if (shareType === 'user') {
      permission.emailAddress = emailAddress
    } else if (shareType === 'domain') {
      // Get user's domain. Auxiliary call wrapped in `refreshAndRetry`
      // (Q3, §A5).
      const aboutResult = await refreshAndRetry({
        provider: 'google-drive',
        userId,
        accessToken,
        call: async (token) =>
          buildDriveClient(token).about.get({ fields: 'user' }),
      })
      if (!aboutResult.success) {
        return { success: false, output: {}, message: aboutResult.message }
      }
      const userEmail = aboutResult.data.data.user?.emailAddress || ''
      const domain = userEmail.split('@')[1]
      if (domain) {
        permission.domain = domain
      }
    }

    // Create the permission. Principal call wrapped in `refreshAndRetry`
    // (Q3, §A5).
    const permResult = await refreshAndRetry({
      provider: 'google-drive',
      userId,
      accessToken,
      call: async (token) =>
        buildDriveClient(token).permissions.create({
          fileId,
          requestBody: permission,
          sendNotificationEmail: sendNotification,
          emailMessage: emailMessage || undefined,
          transferOwnership: role === 'owner' ? true : undefined,
          fields: 'id, role, type, emailAddress'
        }),
    })
    if (!permResult.success) {
      return { success: false, output: {}, message: permResult.message }
    }
    const permResponse = permResult.data

    // Get the file's webViewLink for the share link. Auxiliary call wrapped
    // in `refreshAndRetry` (Q3, §A5).
    const fileResult = await refreshAndRetry({
      provider: 'google-drive',
      userId,
      accessToken,
      call: async (token) =>
        buildDriveClient(token).files.get({
          fileId,
          fields: 'webViewLink, name'
        }),
    })
    if (!fileResult.success) {
      return { success: false, output: {}, message: fileResult.message }
    }
    const fileResponse = fileResult.data

    const sharedWith = shareType === 'user'
      ? emailAddress
      : shareType === 'domain'
        ? 'Organization'
        : 'Anyone with the link'

    logger.info('🔗 [Google Drive] Shared file', {
      fileId,
      fileName: fileResponse.data.name,
      sharedWith,
      role
    })

    return {
      success: true,
      output: {
        permissionId: permResponse.data.id,
        role: permResponse.data.role,
        shareLink: fileResponse.data.webViewLink,
        sharedWith
      },
      message: `Shared with ${sharedWith} as ${role}`
    }
  } catch (error: any) {
    logger.error('❌ [Google Drive] Error sharing file:', error)

    if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.code === 401) {
      throw new Error('Google Drive authentication failed. Please reconnect your account.')
    }
    if (error.message?.includes('404') || error.code === 404) {
      throw new Error('File not found. It may have been deleted.')
    }
    if (error.message?.includes('403') || error.code === 403) {
      throw new Error('Insufficient permissions to share this file.')
    }

    return {
      success: false,
      output: {},
      message: error.message || 'Failed to share file in Google Drive'
    }
  }
}
