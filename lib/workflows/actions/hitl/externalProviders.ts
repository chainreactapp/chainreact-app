/**
 * External Provider Integration for HITL Memory & Knowledge Base
 * Handles loading and saving content to Google Docs, Notion, OneDrive
 */

import { createSupabaseServerClient } from '@/utils/supabase/server'
import { decrypt } from '@/lib/security/encryption'
import { logger } from '@/lib/utils/logger'
import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

const FETCH_TIMEOUT = 15000 // 15 seconds

interface DocumentInfo {
  provider: string
  id: string
  url?: string
  name?: string
}

interface ProviderCredentials {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
}

/**
 * Get decrypted credentials for a provider
 */
async function getProviderCredentials(
  userId: string,
  provider: string
): Promise<ProviderCredentials | null> {
  try {
    const supabase = await createSupabaseServerClient()

    // Map provider names to integration provider IDs
    const providerMapping: Record<string, string[]> = {
      'google_docs': ['google-docs', 'google-drive', 'google_docs', 'google_drive'],
      'notion': ['notion'],
      'onedrive': ['onedrive', 'microsoft-onedrive']
    }

    const providerIds = providerMapping[provider] || [provider]

    const { data: integration, error } = await supabase
      .from('integrations')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .in('provider', providerIds)
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (error || !integration) {
      logger.warn('[HITL External] No integration found', { userId, provider })
      return null
    }

    return {
      accessToken: decrypt(integration.access_token),
      refreshToken: integration.refresh_token ? decrypt(integration.refresh_token) : undefined,
      expiresAt: integration.expires_at
    }
  } catch (error: any) {
    logger.error('[HITL External] Failed to get credentials', { error: error.message, provider })
    return null
  }
}

// ============================================
// GOOGLE DOCS
// ============================================

/**
 * Load content from a Google Doc
 */
export async function loadGoogleDocsContent(
  userId: string,
  documentId: string
): Promise<string | null> {
  try {
    const credentials = await getProviderCredentials(userId, 'google_docs')
    if (!credentials) {
      logger.warn('[HITL Google Docs] No credentials available')
      return null
    }

    // Use Google Docs API to get document content
    const response = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${documentId}`,
      {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        }
      },
      FETCH_TIMEOUT
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Google Docs API error: ${response.status} - ${errorText}`)
    }

    const doc = await response.json()

    // Extract text content from the document structure
    const content = extractTextFromGoogleDoc(doc)

    logger.info('[HITL Google Docs] Content loaded successfully', {
      documentId,
      contentLength: content.length
    })

    return content
  } catch (error: any) {
    logger.error('[HITL Google Docs] Failed to load content', { error: error.message, documentId })
    return null
  }
}

/**
 * Extract plain text from Google Docs document structure
 */
function extractTextFromGoogleDoc(doc: any): string {
  const content: string[] = []

  if (!doc.body?.content) {
    return ''
  }

  for (const element of doc.body.content) {
    if (element.paragraph) {
      const paragraphText = element.paragraph.elements
        ?.map((el: any) => el.textRun?.content || '')
        .join('') || ''
      content.push(paragraphText)
    } else if (element.table) {
      // Handle tables - extract cell content
      for (const row of element.table.tableRows || []) {
        const rowText = row.tableCells
          ?.map((cell: any) => {
            return cell.content
              ?.map((c: any) => c.paragraph?.elements
                ?.map((el: any) => el.textRun?.content || '')
                .join('') || '')
              .join('') || ''
          })
          .join(' | ') || ''
        content.push(rowText)
      }
    }
  }

  return content.join('\n').trim()
}

/**
 * Save content to a Google Doc
 */
export async function saveGoogleDocsContent(
  userId: string,
  documentId: string,
  content: string
): Promise<boolean> {
  try {
    const credentials = await getProviderCredentials(userId, 'google_docs')
    if (!credentials) {
      logger.warn('[HITL Google Docs] No credentials available for saving')
      return false
    }

    // First, get the document to find the end index
    const getResponse = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${documentId}`,
      {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        }
      },
      FETCH_TIMEOUT
    )

    if (!getResponse.ok) {
      throw new Error(`Failed to get document: ${getResponse.status}`)
    }

    const doc = await getResponse.json()
    const endIndex = doc.body?.content?.slice(-1)?.[0]?.endIndex || 1

    // Build batch update requests to replace content
    const requests = []

    // Delete existing content (except the first character which is structural)
    if (endIndex > 2) {
      requests.push({
        deleteContentRange: {
          range: {
            startIndex: 1,
            endIndex: endIndex - 1
          }
        }
      })
    }

    // Insert new content
    requests.push({
      insertText: {
        location: { index: 1 },
        text: content
      }
    })

    // Execute batch update
    const updateResponse = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests })
      },
      FETCH_TIMEOUT
    )

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      throw new Error(`Google Docs update failed: ${updateResponse.status} - ${errorText}`)
    }

    logger.info('[HITL Google Docs] Content saved successfully', {
      documentId,
      contentLength: content.length
    })

    return true
  } catch (error: any) {
    logger.error('[HITL Google Docs] Failed to save content', { error: error.message, documentId })
    return false
  }
}

// ============================================
// NOTION
// ============================================

/**
 * Load content from a Notion page
 */
export async function loadNotionContent(
  userId: string,
  pageId: string
): Promise<string | null> {
  try {
    const credentials = await getProviderCredentials(userId, 'notion')
    if (!credentials) {
      logger.warn('[HITL Notion] No credentials available')
      return null
    }

    // Get page blocks (content)
    const response = await fetchWithTimeout(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
      {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        }
      },
      FETCH_TIMEOUT
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Notion API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const blocks = data.results || []

    // Extract text content from blocks
    const content = extractTextFromNotionBlocks(blocks)

    logger.info('[HITL Notion] Content loaded successfully', {
      pageId,
      blockCount: blocks.length,
      contentLength: content.length
    })

    return content
  } catch (error: any) {
    logger.error('[HITL Notion] Failed to load content', { error: error.message, pageId })
    return null
  }
}

/**
 * Extract plain text from Notion blocks
 */
function extractTextFromNotionBlocks(blocks: any[]): string {
  const content: string[] = []

  for (const block of blocks) {
    const blockType = block.type
    const blockContent = block[blockType]

    if (!blockContent) continue

    // Extract rich text content
    const richText = blockContent.rich_text || blockContent.text || []
    const text = richText.map((rt: any) => rt.plain_text || '').join('')

    switch (blockType) {
      case 'paragraph':
      case 'quote':
      case 'callout':
        content.push(text)
        break
      case 'heading_1':
        content.push(`# ${text}`)
        break
      case 'heading_2':
        content.push(`## ${text}`)
        break
      case 'heading_3':
        content.push(`### ${text}`)
        break
      case 'bulleted_list_item':
        content.push(`• ${text}`)
        break
      case 'numbered_list_item':
        content.push(`- ${text}`)
        break
      case 'to_do':
        const checked = blockContent.checked ? '✓' : '○'
        content.push(`${checked} ${text}`)
        break
      case 'toggle':
        content.push(`▶ ${text}`)
        break
      case 'code':
        content.push(`\`\`\`\n${text}\n\`\`\``)
        break
      case 'divider':
        content.push('---')
        break
      default:
        if (text) content.push(text)
    }
  }

  return content.join('\n').trim()
}

/**
 * Save content to a Notion page (appends blocks)
 */
export async function saveNotionContent(
  userId: string,
  pageId: string,
  content: string
): Promise<boolean> {
  try {
    const credentials = await getProviderCredentials(userId, 'notion')
    if (!credentials) {
      logger.warn('[HITL Notion] No credentials available for saving')
      return false
    }

    // Convert content to Notion blocks
    const blocks = contentToNotionBlocks(content)

    // First, archive existing content by deleting all blocks
    // Get existing blocks
    const getResponse = await fetchWithTimeout(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
      {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Notion-Version': '2022-06-28'
        }
      },
      FETCH_TIMEOUT
    )

    if (getResponse.ok) {
      const existingData = await getResponse.json()
      const existingBlocks = existingData.results || []

      // Delete existing blocks (in batches if needed)
      for (const block of existingBlocks) {
        await fetchWithTimeout(
          `https://api.notion.com/v1/blocks/${block.id}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${credentials.accessToken}`,
              'Notion-Version': '2022-06-28'
            }
          },
          FETCH_TIMEOUT
        )
      }
    }

    // Append new blocks
    const appendResponse = await fetchWithTimeout(
      `https://api.notion.com/v1/blocks/${pageId}/children`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ children: blocks })
      },
      FETCH_TIMEOUT
    )

    if (!appendResponse.ok) {
      const errorText = await appendResponse.text()
      throw new Error(`Notion append failed: ${appendResponse.status} - ${errorText}`)
    }

    logger.info('[HITL Notion] Content saved successfully', {
      pageId,
      blockCount: blocks.length
    })

    return true
  } catch (error: any) {
    logger.error('[HITL Notion] Failed to save content', { error: error.message, pageId })
    return false
  }
}

/**
 * Convert plain text/markdown content to Notion blocks
 */
function contentToNotionBlocks(content: string): any[] {
  const lines = content.split('\n')
  const blocks: any[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Detect block type from line content
    if (trimmed.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }]
        }
      })
    } else if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(3) } }]
        }
      })
    } else if (trimmed.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(4) } }]
        }
      })
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }]
        }
      })
    } else if (trimmed === '---') {
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      })
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: trimmed } }]
        }
      })
    }
  }

  return blocks
}

// ============================================
// ONEDRIVE
// ============================================

/**
 * Load content from a OneDrive file (text-based files only)
 */
export async function loadOneDriveContent(
  userId: string,
  fileId: string
): Promise<string | null> {
  try {
    const credentials = await getProviderCredentials(userId, 'onedrive')
    if (!credentials) {
      logger.warn('[HITL OneDrive] No credentials available')
      return null
    }

    // Get file content using Microsoft Graph API
    const response = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`,
      {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`
        }
      },
      FETCH_TIMEOUT
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OneDrive API error: ${response.status} - ${errorText}`)
    }

    const content = await response.text()

    logger.info('[HITL OneDrive] Content loaded successfully', {
      fileId,
      contentLength: content.length
    })

    return content
  } catch (error: any) {
    logger.error('[HITL OneDrive] Failed to load content', { error: error.message, fileId })
    return null
  }
}

/**
 * Save content to a OneDrive file
 */
export async function saveOneDriveContent(
  userId: string,
  fileId: string,
  content: string
): Promise<boolean> {
  try {
    const credentials = await getProviderCredentials(userId, 'onedrive')
    if (!credentials) {
      logger.warn('[HITL OneDrive] No credentials available for saving')
      return false
    }

    // Update file content using Microsoft Graph API
    const response = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'text/plain'
        },
        body: content
      },
      FETCH_TIMEOUT
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OneDrive update failed: ${response.status} - ${errorText}`)
    }

    logger.info('[HITL OneDrive] Content saved successfully', {
      fileId,
      contentLength: content.length
    })

    return true
  } catch (error: any) {
    logger.error('[HITL OneDrive] Failed to save content', { error: error.message, fileId })
    return false
  }
}

// ============================================
// UNIFIED INTERFACE
// ============================================

/**
 * Load content from any supported external provider
 */
export async function loadExternalProviderContent(
  docInfo: DocumentInfo,
  userId: string
): Promise<string | null> {
  const { provider, id } = docInfo

  logger.info('[HITL External] Loading content from provider', { provider, documentId: id })

  switch (provider) {
    case 'google_docs':
    case 'google-docs':
      return await loadGoogleDocsContent(userId, id)

    case 'notion':
      return await loadNotionContent(userId, id)

    case 'onedrive':
    case 'microsoft-onedrive':
      return await loadOneDriveContent(userId, id)

    default:
      logger.warn('[HITL External] Unsupported provider for loading', { provider })
      return null
  }
}

/**
 * Save content to any supported external provider
 */
export async function saveExternalProviderContent(
  docInfo: DocumentInfo,
  content: string,
  userId: string
): Promise<boolean> {
  const { provider, id } = docInfo

  logger.info('[HITL External] Saving content to provider', {
    provider,
    documentId: id,
    contentLength: content.length
  })

  switch (provider) {
    case 'google_docs':
    case 'google-docs':
      return await saveGoogleDocsContent(userId, id, content)

    case 'notion':
      return await saveNotionContent(userId, id, content)

    case 'onedrive':
    case 'microsoft-onedrive':
      return await saveOneDriveContent(userId, id, content)

    default:
      logger.warn('[HITL External] Unsupported provider for saving', { provider })
      return false
  }
}
