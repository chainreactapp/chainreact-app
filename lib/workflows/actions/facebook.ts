import { ActionResult } from './core/executeWait'
import { getDecryptedAccessToken } from './core/getDecryptedAccessToken'
import { resolveValue } from './core/resolveValue'
import { createClient } from '@supabase/supabase-js'

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

// Helper to create supabase client inside handlers
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

interface FacebookMediaUploadResult {
  id: string
  success: boolean
  error?: string
}

interface FacebookPostResult {
  id: string
  success: boolean
  error?: string
}

/**
 * Create a post on a Facebook page with proper media upload
 */
export async function createFacebookPost(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Resolve templated values
    const resolvedConfig = resolveValue(config, input)
    
    const {
      pageId,
      message,
      mediaFile,
      scheduledPublishTime,
      productLinkUrl,
      productLinkName,
      productPromoCode,
      paidPartnershipLabel
    } = resolvedConfig

    if (!pageId || !message) {
      throw new Error("Page ID and message are required")
    }

    // Get Facebook integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "facebook")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      throw new Error("Facebook integration not connected")
    }

    // Get decrypted access token
    const accessToken = await getDecryptedAccessToken(userId, "facebook")

    // Get page access token for the specific page
    const pageAccessToken = await getPageAccessToken(pageId, accessToken)

    logger.info('[Facebook] Starting create post action')
    logger.info('[Facebook] Parameters:', { pageId, message, mediaFile })

    // Step 1: Upload media files and collect their IDs
    const mediaIds: string[] = []
    
    if (mediaFile) {
      logger.debug("Processing media file")
      
      // Handle different media file formats
      let fileIds: string[] = []
      
      if (typeof mediaFile === 'string') {
        // Single file ID
        fileIds = [mediaFile]
      } else if (Array.isArray(mediaFile)) {
        // Array of file IDs
        fileIds = mediaFile
      } else if (mediaFile && typeof mediaFile === 'object') {
        // Object with file IDs or other properties
        if (mediaFile.fileIds) {
          fileIds = Array.isArray(mediaFile.fileIds) ? mediaFile.fileIds : [mediaFile.fileIds]
        } else if (mediaFile.id) {
          fileIds = [mediaFile.id]
        }
      }
      
      for (const fileId of fileIds) {
        logger.info(`[Facebook] Processing file ID: ${fileId}`)
        
        // Get file buffer from storage
        const fileBuffer = await getFileBuffer(fileId, userId)
        if (!fileBuffer) {
          logger.error(`[Facebook] Failed to get file buffer for ID: ${fileId}`)
          continue
        }

        // Determine file type and upload accordingly
        const fileName = `file_${fileId}.jpg` // Default filename
        
        // Try photo upload first, then video if it fails
        let uploadResult = await uploadPhotoToFacebook(pageAccessToken, pageId, fileBuffer, fileName)
        
        if (!uploadResult.success) {
          // Try as video if photo upload failed
          uploadResult = await uploadVideoToFacebook(pageAccessToken, pageId, fileBuffer, fileName)
        }
        
        if (uploadResult.success) {
          mediaIds.push(uploadResult.id)
          logger.info(`[Facebook] Media uploaded successfully: ${uploadResult.id}`)
        } else {
          logger.error(`[Facebook] Failed to upload media: ${uploadResult.error}`)
        }
      }
    }

    // Step 2: Create the post with attached media
    const payload: any = {
      message: message
    }
    
    // Add attached media if we have media IDs
    if (mediaIds.length > 0) {
      payload.attached_media = mediaIds.map(mediaId => ({
        media_fbid: mediaId
      }))
    }

    // Add scheduling if specified
    if (scheduledPublishTime) {
      const publishTime = new Date(scheduledPublishTime)
      if (publishTime > new Date()) {
        payload.published = false
        payload.scheduled_publish_time = Math.floor(publishTime.getTime() / 1000)
      }
    }

    // Add monetization features if specified
    if (productLinkUrl || productLinkName || productPromoCode || paidPartnershipLabel) {
      const monetizationData: any = {}
      
      if (productLinkUrl) {
        monetizationData.link = productLinkUrl
      }
      
      if (productLinkName) {
        monetizationData.name = productLinkName
      }
      
      if (productPromoCode) {
        monetizationData.promo_code = productPromoCode
      }
      
      if (paidPartnershipLabel) {
        monetizationData.paid_partnership_label = true
      }
      
      // Add monetization data to payload
      Object.assign(payload, monetizationData)
    }

    // Generate appsecret_proof for server-side calls
    const crypto = require('crypto')
    const appSecret = process.env.FACEBOOK_CLIENT_SECRET
    if (!appSecret) {
      throw new Error("Facebook app secret not configured")
    }
    const appsecretProof = crypto
      .createHmac('sha256', appSecret)
      .update(pageAccessToken)
      .digest('hex')

    // Create the post
    const response = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed?appsecret_proof=${appsecretProof}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const fbError = errorData.error
      throw new Error(`Facebook API error: ${response.status} - ${fbError?.message || response.statusText}${fbError?.error_user_msg ? ` (${fbError.error_user_msg})` : ''}${fbError?.error_subcode ? ` [subcode: ${fbError.error_subcode}]` : ''}`)
    }

    const result = await response.json()

    logger.info('[Facebook] Create post action completed successfully')
    
    return {
      success: true,
      output: {
        postId: result.id,
        pageId: pageId,
        message: message,
        scheduledPublishTime: scheduledPublishTime,
        published: !scheduledPublishTime || new Date(scheduledPublishTime) <= new Date(),
        facebookResponse: result,
        mediaIds: mediaIds,
        monetization: {
          productLinkUrl,
          productLinkName,
          productPromoCode,
          paidPartnershipLabel
        }
      },
      message: scheduledPublishTime 
        ? `Post scheduled successfully for ${new Date(scheduledPublishTime).toLocaleString()}`
        : "Post created successfully on Facebook"
    }

  } catch (error: any) {
    logger.error('[Facebook] Create post action failed:', error)
    return {
      success: false,
      error: error.message || "Failed to create Facebook post",
      output: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
}

/**
 * Get page access token for a specific Facebook page
 */
async function getPageAccessToken(pageId: string, userAccessToken: string): Promise<string> {
  const crypto = require('crypto')
  const appSecret = process.env.FACEBOOK_CLIENT_SECRET
  
  if (!appSecret) {
    throw new Error("Facebook app secret not configured")
  }
  
  const appsecretProof = crypto
    .createHmac('sha256', appSecret)
    .update(userAccessToken)
    .digest('hex')

  const response = await fetch(`https://graph.facebook.com/v19.0/me/accounts?appsecret_proof=${appsecretProof}`, {
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      "Content-Type": "application/json"
    }
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(`Failed to get page access token: ${response.status} - ${errorData.error?.message || response.statusText}`)
  }

  const data = await response.json()
  const page = data.data?.find((p: any) => p.id === pageId)
  
  if (!page) {
    throw new Error(`Page with ID ${pageId} not found or access denied`)
  }

  return page.access_token
}

/**
 * Upload a photo to Facebook and return the photo ID
 */
async function uploadPhotoToFacebook(
  accessToken: string,
  pageId: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<FacebookMediaUploadResult> {
  try {
    logger.info(`[Facebook] Uploading photo to page ${pageId}`)
    
    const formData = new FormData()
    // Convert Buffer to Blob for native FormData
    const blob = new Blob([fileBuffer], { type: 'image/jpeg' })
    formData.append('source', blob, fileName)
    formData.append('published', 'false') // Don't auto-publish
    
    const response = await fetch(`https://graph.facebook.com/v18.0/${pageId}/photos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
        // Don't set Content-Type header, let the browser set it with boundary
      },
      body: formData
    })

    const result = await response.json()
    
    if (!response.ok) {
      logger.error('[Facebook] Photo upload failed:', result)
      return {
        id: '',
        success: false,
        error: result.error?.message || 'Failed to upload photo'
      }
    }

    logger.info(`[Facebook] Photo uploaded successfully, ID: ${result.id}`)
    return {
      id: result.id,
      success: true
    }
  } catch (error) {
    logger.error('[Facebook] Photo upload error:', error)
    return {
      id: '',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Upload a video to Facebook and return the video ID
 */
async function uploadVideoToFacebook(
  accessToken: string,
  pageId: string,
  fileBuffer: Buffer,
  fileName: string,
  description?: string,
  title?: string
): Promise<FacebookMediaUploadResult> {
  try {
    logger.info(`[Facebook] Uploading video to page ${pageId}`)
    
    const formData = new FormData()
    // Convert Buffer to Blob for native FormData
    const blob = new Blob([fileBuffer], { type: 'video/mp4' })
    formData.append('source', blob, fileName)
    formData.append('published', 'false') // Don't auto-publish
    
    if (description) {
      formData.append('description', description)
    }
    if (title) {
      formData.append('title', title)
    }
    
    const response = await fetch(`https://graph.facebook.com/v18.0/${pageId}/videos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
        // Don't set Content-Type header, let the browser set it with boundary
      },
      body: formData
    })

    const result = await response.json()
    
    if (!response.ok) {
      logger.error('[Facebook] Video upload failed:', result)
      return {
        id: '',
        success: false,
        error: result.error?.message || 'Failed to upload video'
      }
    }

    logger.info(`[Facebook] Video uploaded successfully, ID: ${result.id}`)
    return {
      id: result.id,
      success: true
    }
  } catch (error) {
    logger.error('[Facebook] Video upload error:', error)
    return {
      id: '',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Create a Facebook post with attached media
 */
async function createFacebookPostWithMedia(
  accessToken: string,
  pageId: string,
  message: string,
  mediaIds: string[]
): Promise<FacebookPostResult> {
  try {
    logger.info(`[Facebook] Creating post with ${mediaIds.length} media items`)
    
    const payload: any = {
      message: message
    }
    
    // Add attached media if we have media IDs
    if (mediaIds.length > 0) {
      payload.attached_media = mediaIds.map(mediaId => ({
        media_fbid: mediaId
      }))
    }
    
    const response = await fetch(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const result = await response.json()
    
    if (!response.ok) {
      logger.error('[Facebook] Post creation failed:', result)
      return {
        id: '',
        success: false,
        error: result.error?.message || 'Failed to create post'
      }
    }

    logger.info(`[Facebook] Post created successfully, ID: ${result.id}`)
    return {
      id: result.id,
      success: true
    }
  } catch (error) {
    logger.error('[Facebook] Post creation error:', error)
    return {
      id: '',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get file buffer from file storage by ID
 */
async function getFileBuffer(fileId: string, userId: string): Promise<Buffer | null> {
  try {
    // Import and use FileStorageService to get the actual file
    const { FileStorageService } = await import("@/lib/storage/fileStorage")
    const fileResult = await FileStorageService.getFile(fileId, userId)
    
    if (!fileResult) {
      logger.error(`[Facebook] Failed to retrieve file for ID: ${fileId}`)
      return null
    }

    // Convert Blob to Buffer
    const arrayBuffer = await fileResult.file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    logger.info(`[Facebook] Successfully retrieved file: ${fileResult.metadata.fileName} (${buffer.length} bytes)`)
    return buffer
  } catch (error) {
    logger.error('[Facebook] Error getting file buffer:', error)
    return null
  }
}



// Legacy function for backward compatibility
export async function uploadMediaToFacebook(
  accessToken: string,
  pageId: string,
  mediaFileIds: string[],
  userId: string
): Promise<string[]> {
  logger.info('[Facebook] Legacy uploadMediaToFacebook called')
  
  const mediaIds: string[] = []
  
  for (const fileId of mediaFileIds) {
    const fileBuffer = await getFileBuffer(fileId, userId)
    if (!fileBuffer) {
      logger.error(`[Facebook] Failed to get file buffer for ID: ${fileId}`)
      continue
    }

    const fileName = `file_${fileId}.jpg`
    
    // Try photo upload first
    let uploadResult = await uploadPhotoToFacebook(accessToken, pageId, fileBuffer, fileName)
    
    if (!uploadResult.success) {
      // Try video upload
      uploadResult = await uploadVideoToFacebook(accessToken, pageId, fileBuffer, fileName)
    }
    
    if (uploadResult.success) {
      mediaIds.push(uploadResult.id)
    }
  }
  
  return mediaIds
}

/**
 * Get Facebook page insights
 */
export async function getFacebookPageInsights(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Resolve templated values
    const resolvedConfig = resolveValue(config, input)
    
    const {
      pageId,
      metric,
      period,
      periodCount,
      dateRange,
      since,
      until
    } = resolvedConfig

    if (!pageId || !metric || !period) {
      throw new Error("Page ID, metric, and period are required")
    }

    // Derive periodCount from dateRange if not explicitly provided
    let resolvedPeriodCount = periodCount
    if (!resolvedPeriodCount && dateRange) {
      switch (dateRange) {
        case 'today': resolvedPeriodCount = 1; break
        case 'yesterday': resolvedPeriodCount = 2; break
        case 'last_7_days': resolvedPeriodCount = 7; break
        case 'last_14_days': resolvedPeriodCount = 14; break
        case 'last_28_days': resolvedPeriodCount = 28; break
        case 'last_30_days': resolvedPeriodCount = 30; break
        case 'last_90_days': resolvedPeriodCount = 90; break
        case 'this_month': resolvedPeriodCount = new Date().getDate(); break
        case 'last_month': resolvedPeriodCount = 30; break
        case 'custom': resolvedPeriodCount = 30; break
        default: resolvedPeriodCount = 7; break
      }
    }
    if (!resolvedPeriodCount) {
      resolvedPeriodCount = 7 // Default to 7 days
    }

    // Get Facebook integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "facebook")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      throw new Error("Facebook integration not connected")
    }

    // Get decrypted access token
    const accessToken = await getDecryptedAccessToken(userId, "facebook")

    // Get page access token for the specific page
    const pageAccessToken = await getPageAccessToken(pageId, accessToken)

    // Generate appsecret_proof for server-side calls
    const crypto = require('crypto')
    const appSecret = process.env.FACEBOOK_CLIENT_SECRET
    
    if (!appSecret) {
      throw new Error("Facebook app secret not configured")
    }
    
    const appsecretProof = crypto
      .createHmac('sha256', appSecret)
      .update(pageAccessToken)
      .digest('hex')

    // Build the insights URL - calculate the since date based on resolvedPeriodCount
    const now = new Date();
    let sinceDate: Date;

    // Use custom since/until dates if provided
    if (since && until) {
      sinceDate = new Date(since);
    } else {
      switch (period) {
        case 'day':
          sinceDate = new Date(now.getTime() - (resolvedPeriodCount * 24 * 60 * 60 * 1000));
          break;
        case 'week':
          sinceDate = new Date(now.getTime() - (resolvedPeriodCount * 7 * 24 * 60 * 60 * 1000));
          break;
        case 'month':
          sinceDate = new Date(now.getTime() - (resolvedPeriodCount * 30 * 24 * 60 * 60 * 1000));
          break;
        default:
          sinceDate = new Date(now.getTime() - (resolvedPeriodCount * 24 * 60 * 60 * 1000));
      }
    }
    
    const sinceTimestamp = Math.floor(sinceDate.getTime() / 1000);
    const insightsUrl = `https://graph.facebook.com/v19.0/${pageId}/insights?metric=${metric}&period=${period}&since=${sinceTimestamp}&appsecret_proof=${appsecretProof}`

    const response = await fetch(insightsUrl, {
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        "Content-Type": "application/json"
      }
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Facebook API error: ${response.status} - ${errorData.error?.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        pageId: pageId,
        metric: metric,
        period: period,
        periodCount: resolvedPeriodCount,
        insights: result.data || [],
        facebookResponse: result
      },
      message: `Successfully retrieved ${metric} insights for the last ${resolvedPeriodCount} ${period}(s)`
    }

  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Failed to get Facebook page insights",
      output: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
}

/**
 * Send a message to a person who has a conversation with the Facebook page
 */
export async function sendFacebookMessage(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Resolve templated values
    const resolvedConfig = resolveValue(config, input)
    
    const {
      pageId,
      recipientId,
      message,
      quickReplies,
      typingIndicator = true
    } = resolvedConfig

    if (!pageId || !recipientId || !message) {
      throw new Error("Page ID, recipient ID, and message are required")
    }

    // Extract sender ID from conversation ID (format: conversationId:senderId)
    let senderId = recipientId
    if (recipientId.includes(':')) {
      const parts = recipientId.split(':')
      senderId = parts[1] || recipientId
    }

    // Get Facebook integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "facebook")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      throw new Error("Facebook integration not connected")
    }

    // Get decrypted access token
    const accessToken = await getDecryptedAccessToken(userId, "facebook")

    // Get page access token for the specific page
    const pageAccessToken = await getPageAccessToken(pageId, accessToken)

    // Generate appsecret_proof for server-side calls
    const crypto = require('crypto')
    const appSecret = process.env.FACEBOOK_CLIENT_SECRET
    
    if (!appSecret) {
      throw new Error("Facebook app secret not configured")
    }
    
    const appsecretProof = crypto
      .createHmac('sha256', appSecret)
      .update(pageAccessToken)
      .digest('hex')

    // Show typing indicator if enabled
    if (typingIndicator) {
      const typingUrl = `https://graph.facebook.com/v19.0/me/messages?appsecret_proof=${appsecretProof}`
      const typingPayload = {
        recipient: { id: senderId },
        sender_action: "typing_on"
      }

      await fetch(typingUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pageAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(typingPayload)
      })

      // Wait a bit to show typing indicator
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    // Prepare message payload
    const messagePayload: any = {
      recipient: { id: senderId },
      message: { text: message }
    }

    // Add quick replies if provided
    if (quickReplies && quickReplies.trim()) {
      const quickReplyOptions = quickReplies.split('\n').filter((line: string) => line.trim()).map((option: string) => ({
        content_type: "text",
        title: option.trim(),
        payload: option.trim().toUpperCase()
      }))

      if (quickReplyOptions.length > 0) {
        messagePayload.message.quick_replies = quickReplyOptions.slice(0, 11) // Facebook limit is 11 quick replies
      }
    }

    // Send the message
    const messageUrl = `https://graph.facebook.com/v19.0/me/messages?appsecret_proof=${appsecretProof}`
    
    const response = await fetch(messageUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(messagePayload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Facebook API error: ${response.status} - ${errorData.error?.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        messageId: result.message_id,
        pageId: pageId,
        recipientId: senderId,
        conversationId: recipientId,
        message: message,
        quickReplies: quickReplies ? quickReplies.split('\n').filter((line: string) => line.trim()) : [],
        typingIndicator: typingIndicator,
        facebookResponse: result
      },
      message: `Message sent successfully to ${senderId}`
    }

  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Failed to send Facebook message",
      output: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
}

/**
 * Add a comment to a Facebook post
 */
export async function commentOnFacebookPost(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Resolve templated values
    const resolvedConfig = resolveValue(config, input)
    
    const {
      pageId,
      postId,
      comment,
      attachmentUrl,
      attachmentType
    } = resolvedConfig

    if (!pageId || !postId || !comment) {
      throw new Error("Page ID, post ID, and comment are required")
    }

    // Get Facebook integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "facebook")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      throw new Error("Facebook integration not connected")
    }

    // Get decrypted access token
    const accessToken = await getDecryptedAccessToken(userId, "facebook")

    // Get page access token for the specific page
    const pageAccessToken = await getPageAccessToken(pageId, accessToken)

    // Generate appsecret_proof for server-side calls
    const crypto = require('crypto')
    const appSecret = process.env.FACEBOOK_CLIENT_SECRET
    
    if (!appSecret) {
      throw new Error("Facebook app secret not configured")
    }
    
    const appsecretProof = crypto
      .createHmac('sha256', appSecret)
      .update(pageAccessToken)
      .digest('hex')

    // Prepare comment payload
    const commentPayload: any = {
      message: comment
    }

    // Add attachment if provided
    if (attachmentUrl && attachmentType) {
      switch (attachmentType) {
        case 'photo':
          commentPayload.attachment_url = attachmentUrl
          break
        case 'video':
          commentPayload.attachment_url = attachmentUrl
          break
        case 'link':
          commentPayload.attachment_url = attachmentUrl
          break
        default:
          // If no specific type, just add as URL
          commentPayload.attachment_url = attachmentUrl
      }
    }

    // Send the comment
    const commentUrl = `https://graph.facebook.com/v19.0/${postId}/comments?appsecret_proof=${appsecretProof}`
    
    const response = await fetch(commentUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(commentPayload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Facebook API error: ${response.status} - ${errorData.error?.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        commentId: result.id,
        pageId: pageId,
        postId: postId,
        comment: comment,
        attachmentUrl: attachmentUrl || null,
        attachmentType: attachmentType || null,
        facebookResponse: result
      },
      message: `Comment added successfully to post ${postId}`
    }

  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Failed to comment on Facebook post",
      output: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
}

/**
 * Delete a post from a Facebook page
 */
export async function deleteFacebookPost(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)

    const { pageId, postId } = resolvedConfig

    if (!pageId || !postId) {
      throw new Error("Page ID and Post ID are required")
    }

    logger.info('[Facebook] Starting delete post action', { pageId, postId })

    // Get decrypted access token
    const accessToken = await getDecryptedAccessToken(userId, "facebook")

    // Get page access token
    const pageAccessToken = await getPageAccessToken(pageId, accessToken)

    // Create appsecret_proof
    const crypto = require('crypto')
    const appSecret = process.env.FACEBOOK_CLIENT_SECRET

    if (!appSecret) {
      throw new Error("Facebook app secret not configured")
    }

    const appsecretProof = crypto
      .createHmac('sha256', appSecret)
      .update(pageAccessToken)
      .digest('hex')

    // Delete the post
    const deleteUrl = `https://graph.facebook.com/v19.0/${postId}?appsecret_proof=${appsecretProof}`

    const response = await fetch(deleteUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${pageAccessToken}`
      }
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Facebook API error: ${response.status} - ${errorData.error?.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        postId: postId,
        pageId: pageId,
        deleted: result.success || true,
        facebookResponse: result
      },
      message: `Post ${postId} deleted successfully`
    }

  } catch (error: any) {
    logger.error('[Facebook] Delete post action failed:', error)
    return {
      success: false,
      error: error.message || "Failed to delete Facebook post",
      output: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
}

/**
 * Update an existing post on a Facebook page
 */
export async function updateFacebookPost(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)

    const {
      pageId,
      postId,
      message,
      scheduledPublishTime,
      isPublished
    } = resolvedConfig

    if (!pageId || !postId) {
      throw new Error("Page ID and Post ID are required")
    }

    logger.info('[Facebook] Starting update post action', { pageId, postId, message })

    // Get decrypted access token
    const accessToken = await getDecryptedAccessToken(userId, "facebook")

    // Get page access token
    const pageAccessToken = await getPageAccessToken(pageId, accessToken)

    // Create appsecret_proof
    const crypto = require('crypto')
    const appSecret = process.env.FACEBOOK_CLIENT_SECRET

    if (!appSecret) {
      throw new Error("Facebook app secret not configured")
    }

    const appsecretProof = crypto
      .createHmac('sha256', appSecret)
      .update(pageAccessToken)
      .digest('hex')

    // Build update payload
    const updatePayload: any = {}

    if (message !== undefined) {
      updatePayload.message = message
    }

    if (scheduledPublishTime) {
      const scheduledTime = new Date(scheduledPublishTime)
      updatePayload.scheduled_publish_time = Math.floor(scheduledTime.getTime() / 1000)
      updatePayload.published = false
    }

    if (isPublished !== undefined) {
      updatePayload.is_published = isPublished
    }

    // Update the post
    const updateUrl = `https://graph.facebook.com/v19.0/${postId}?appsecret_proof=${appsecretProof}`

    const response = await fetch(updateUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(updatePayload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Facebook API error: ${response.status} - ${errorData.error?.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        postId: postId,
        pageId: pageId,
        updated: result.success || true,
        message: message,
        scheduledPublishTime: scheduledPublishTime,
        facebookResponse: result
      },
      message: scheduledPublishTime
        ? `Post updated and rescheduled for ${new Date(scheduledPublishTime).toLocaleString()}`
        : "Post updated successfully on Facebook"
    }

  } catch (error: any) {
    logger.error('[Facebook] Update post action failed:', error)
    return {
      success: false,
      error: error.message || "Failed to update Facebook post",
      output: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
}

/**
 * Upload a photo to a Facebook page (standalone action)
 */
export async function uploadFacebookPhoto(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)

    const {
      pageId,
      photoFile,
      caption,
      targetAlbum,
      noStory,
      published
    } = resolvedConfig

    if (!pageId || !photoFile) {
      throw new Error("Page ID and photo file are required")
    }

    logger.info('[Facebook] Starting upload photo action', { pageId, photoFile, caption })

    // Get decrypted access token
    const accessToken = await getDecryptedAccessToken(userId, "facebook")

    // Get page access token
    const pageAccessToken = await getPageAccessToken(pageId, accessToken)

    // Download photo from Supabase storage
    const fileBuffer = await getFileBuffer(photoFile, userId)

    if (!fileBuffer) {
      throw new Error("Failed to retrieve photo file from storage")
    }

    // Create FormData for upload
    const formData = new FormData()
    const blob = new Blob([fileBuffer], { type: 'image/jpeg' })
    formData.append('source', blob, 'photo.jpg')

    if (caption) {
      formData.append('caption', caption)
    }

    if (published !== undefined) {
      formData.append('published', String(published))
    } else {
      formData.append('published', 'true')
    }

    if (noStory) {
      formData.append('no_story', 'true')
    }

    // Handle album selection: can be either an existing album ID or a new album name
    let albumId = targetAlbum

    if (targetAlbum) {
      // Check if targetAlbum is a numeric ID or a name
      // Facebook album IDs are numeric strings
      const isNumericId = /^\d+$/.test(targetAlbum)

      if (!isNumericId) {
        // It's a new album name - create the album first
        logger.info('[Facebook] Creating new album:', targetAlbum)

        const createAlbumResponse = await fetch(`https://graph.facebook.com/v19.0/${pageId}/albums`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${pageAccessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: targetAlbum,
            message: `Album created by ChainReact workflow`
          })
        })

        if (!createAlbumResponse.ok) {
          const errorData = await createAlbumResponse.json().catch(() => ({}))
          logger.warn('[Facebook] Failed to create album, uploading to Timeline Photos instead:', errorData.error?.message)
          albumId = null // Fall back to default album
        } else {
          const albumData = await createAlbumResponse.json()
          albumId = albumData.id
          logger.info('[Facebook] Album created successfully:', albumId)
        }
      }
    }

    // Determine upload endpoint
    const uploadEndpoint = albumId
      ? `https://graph.facebook.com/v19.0/${albumId}/photos`
      : `https://graph.facebook.com/v19.0/${pageId}/photos`

    logger.info('[Facebook] Uploading photo to:', uploadEndpoint)

    // Upload photo
    const response = await fetch(uploadEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pageAccessToken}`
      },
      body: formData
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Facebook API error: ${response.status} - ${errorData.error?.message || response.statusText}`)
    }

    const result = await response.json()

    logger.info('[Facebook] Photo uploaded successfully:', result)

    // Determine success message
    let successMessage = "Photo uploaded successfully to Facebook"
    if (albumId && albumId !== targetAlbum) {
      successMessage = `Photo uploaded successfully to newly created album "${targetAlbum}"`
    } else if (albumId) {
      successMessage = "Photo uploaded successfully to selected album"
    }

    return {
      success: true,
      output: {
        photoId: result.id,
        pageId: pageId,
        albumId: albumId || null,
        albumName: targetAlbum || null,
        albumCreated: albumId && albumId !== targetAlbum,
        postId: result.post_id || null,
        caption: caption,
        published: published !== false,
        facebookResponse: result
      },
      message: successMessage
    }

  } catch (error: any) {
    logger.error('[Facebook] Upload photo action failed:', error)
    return {
      success: false,
      error: error.message || "Failed to upload photo to Facebook",
      output: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
}

/**
 * Upload a video to a Facebook page (standalone action)
 */
export async function uploadFacebookVideo(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)

    const {
      pageId,
      videoFile,
      title,
      description,
      scheduledPublishTime,
      published,
      targeting,
      contentCategory,
      enableMonetization,
      customThumbnail,
      embeddable,
      allowSocialSharing,
      captionsFile
    } = resolvedConfig

    if (!pageId || !videoFile) {
      throw new Error("Page ID and video file are required")
    }

    logger.info('[Facebook] Starting upload video action', { pageId, videoFile, title })

    // Get decrypted access token
    const accessToken = await getDecryptedAccessToken(userId, "facebook")

    // Get page access token
    const pageAccessToken = await getPageAccessToken(pageId, accessToken)

    // Download video from Supabase storage
    const fileBuffer = await getFileBuffer(videoFile, userId)

    if (!fileBuffer) {
      throw new Error("Failed to retrieve video file from storage")
    }

    // Create FormData for upload
    const formData = new FormData()
    const blob = new Blob([fileBuffer], { type: 'video/mp4' })
    formData.append('source', blob, 'video.mp4')

    if (title) {
      formData.append('title', title)
    }

    if (description) {
      formData.append('description', description)
    }

    if (published !== undefined) {
      formData.append('published', String(published))
    } else {
      formData.append('published', 'true')
    }

    if (scheduledPublishTime) {
      const scheduledTime = new Date(scheduledPublishTime)
      formData.append('scheduled_publish_time', String(Math.floor(scheduledTime.getTime() / 1000)))
      formData.append('published', 'false')
    }

    if (targeting) {
      formData.append('targeting', JSON.stringify(targeting))
    }

    if (contentCategory) {
      formData.append('content_category', contentCategory)
    }

    // Video settings
    if (embeddable !== undefined) {
      formData.append('embeddable', String(embeddable))
    }

    if (allowSocialSharing !== undefined) {
      formData.append('social_actions', String(allowSocialSharing))
    }

    // Monetization
    if (enableMonetization === true) {
      formData.append('is_eligible_for_monetization', 'true')
      logger.info('[Facebook] Monetization enabled for video upload')
    }

    // Custom thumbnail
    if (customThumbnail) {
      formData.append('thumb', customThumbnail)
    }

    // Captions
    if (captionsFile) {
      formData.append('captions_file_url', captionsFile)
    }

    logger.info('[Facebook] Uploading video to page:', pageId)

    // Upload video
    const response = await fetch(`https://graph.facebook.com/v19.0/${pageId}/videos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pageAccessToken}`
      },
      body: formData
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Facebook API error: ${response.status} - ${errorData.error?.message || response.statusText}`)
    }

    const result = await response.json()

    logger.info('[Facebook] Video uploaded successfully:', result)

    // If monetization was requested, check if it was actually enabled
    let monetizationStatus = {
      requested: enableMonetization === true,
      enabled: false,
      eligibilityStatus: 'unknown' as 'unknown' | 'eligible' | 'not_eligible' | 'pending_review',
      rejectionReason: undefined as string | undefined
    }

    if (enableMonetization === true && result.id) {
      try {
        logger.info('[Facebook] Checking monetization status for video:', result.id)

        // Fetch video details to check monetization status
        const videoDetailsResponse = await fetch(
          `https://graph.facebook.com/v19.0/${result.id}?fields=id,is_eligible_for_monetization,monetization_status&access_token=${pageAccessToken}`,
          { method: 'GET' }
        )

        if (videoDetailsResponse.ok) {
          const videoDetails = await videoDetailsResponse.json()

          monetizationStatus.enabled = videoDetails.is_eligible_for_monetization === true

          // Check monetization_status field if available
          if (videoDetails.monetization_status) {
            monetizationStatus.eligibilityStatus = videoDetails.monetization_status
          } else if (videoDetails.is_eligible_for_monetization === true) {
            monetizationStatus.eligibilityStatus = 'eligible'
          } else if (videoDetails.is_eligible_for_monetization === false) {
            monetizationStatus.eligibilityStatus = 'not_eligible'
          }

          logger.info('[Facebook] Monetization status:', monetizationStatus)
        } else {
          logger.warn('[Facebook] Could not fetch monetization status')
        }
      } catch (error: any) {
        logger.error('[Facebook] Error checking monetization status:', error)
        // Continue without monetization status rather than failing the entire action
      }
    }

    // Build success message
    let successMessage = scheduledPublishTime
      ? `Video uploaded and scheduled for ${new Date(scheduledPublishTime).toLocaleString()}`
      : "Video uploaded successfully to Facebook"

    // Add monetization feedback to message
    if (monetizationStatus.requested) {
      if (monetizationStatus.enabled) {
        successMessage += ". ✅ Monetization enabled!"
      } else if (monetizationStatus.eligibilityStatus === 'not_eligible') {
        successMessage += ". ⚠️ Monetization was NOT enabled - Common reasons: video < 3 minutes, page doesn't meet requirements (10K+ followers, 600K+ watch minutes), content not advertiser-friendly, or copyright issues. Check Facebook Creator Studio > Monetization for detailed feedback and next steps."
      } else if (monetizationStatus.eligibilityStatus === 'pending_review') {
        successMessage += ". ⏳ Monetization pending review by Facebook - Check Creator Studio in 24-48 hours for approval status."
      } else {
        successMessage += ". ℹ️ Monetization status unclear - Check Facebook Creator Studio > Monetization tab for details. Status may update within 24 hours."
      }
    }

    return {
      success: true,
      output: {
        videoId: result.id,
        pageId: pageId,
        title: title,
        description: description,
        published: published !== false && !scheduledPublishTime,
        scheduledPublishTime: scheduledPublishTime,
        monetization: monetizationStatus,
        facebookResponse: result
      },
      message: successMessage
    }

  } catch (error: any) {
    logger.error('[Facebook] Upload video action failed:', error)
    return {
      success: false,
      error: error.message || "Failed to upload video to Facebook",
      output: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
} 