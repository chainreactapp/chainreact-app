import { ActionResult } from '../index'
import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { requireExplicitField } from '../core/requireExplicitField'
import { ExecutionContext } from '../../execution/types'
import { logger } from '@/lib/utils/logger'

/**
 * Create a sharing link for a file or folder in OneDrive
 */
export async function createOnedriveSharingLink(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    // Q11 — linkScope controls how broadly the link can be shared.
    // 'anonymous' is too permissive for a hidden default; previous silent
    // `|| 'anonymous'` removed. Workflow author must explicitly choose
    // 'anonymous' (external) or 'organization' (internal). UI recommends
    // 'organization' for internal flows.
    const missingRequired = requireExplicitField(config, 'linkScope')
    if (missingRequired) return missingRequired as unknown as ActionResult

    const accessToken = await getDecryptedAccessToken(context.userId, "onedrive")

    // Resolve dynamic values
    const itemType = context.dataFlowManager.resolveVariable(config.itemType) || 'file'
    const fileId = context.dataFlowManager.resolveVariable(config.fileId)
    const folderIdToShare = context.dataFlowManager.resolveVariable(config.folderIdToShare)
    const linkType = context.dataFlowManager.resolveVariable(config.linkType) || 'view'
    const linkScope = context.dataFlowManager.resolveVariable(config.linkScope)
    const expirationDateTime = context.dataFlowManager.resolveVariable(config.expirationDateTime)
    const password = context.dataFlowManager.resolveVariable(config.password)

    // Determine which item to share
    // Note: 'root' is a virtual folder ID - cannot share root directly, select a specific folder
    let targetItemId: string | null = null
    if (itemType === 'file' && fileId) {
      targetItemId = fileId
    } else if (itemType === 'folder' && folderIdToShare && folderIdToShare !== 'root') {
      targetItemId = folderIdToShare
    }

    // Check if user tried to select root folder
    if (folderIdToShare === 'root') {
      throw new Error("Cannot create a sharing link for the root folder. Please select a specific folder.")
    }

    if (!targetItemId) {
      throw new Error("Please select an item to share")
    }

    // Build sharing link request payload
    const payload: any = {
      type: linkType, // view or edit
      scope: linkScope // anonymous or organization
    }

    if (expirationDateTime) {
      payload.expirationDateTime = expirationDateTime
    }

    if (password) {
      payload.password = password
    }

    logger.info('[OneDrive] Creating sharing link:', {
      itemId: targetItemId,
      linkType,
      linkScope,
      expirationDateTime
    })

    const sharingUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${targetItemId}/createLink`

    const response = await fetch(sharingUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OneDrive API error: ${response.status} - ${errorText}`)
    }

    const sharingResult = await response.json()

    // Get item details for the response
    const itemResponse = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${targetItemId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    let itemName = 'Unknown'
    if (itemResponse.ok) {
      const itemDetails = await itemResponse.json()
      itemName = itemDetails.name
    }

    return {
      success: true,
      output: {
        link: sharingResult.link?.webUrl,
        linkId: sharingResult.id,
        type: linkType,
        scope: linkScope,
        expirationDateTime: sharingResult.expirationDateTime,
        itemName,
        createdTime: new Date().toISOString()
      },
      message: `Successfully created sharing link for: ${itemName}`
    }
  } catch (error: any) {
    logger.error('OneDrive Create Sharing Link error:', error)
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to create sharing link in OneDrive'
    }
  }
}
