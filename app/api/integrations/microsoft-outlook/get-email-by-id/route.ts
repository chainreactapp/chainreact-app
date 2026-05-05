import { NextRequest } from "next/server"
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { decryptToken } from "@/lib/integrations/tokenUtils"
import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Fetch a single email by ID with its attachment list
 * Used for previewing email in Download Attachments action
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { emailId } = body

    if (!emailId) {
      return errorResponse('Email ID is required', 400)
    }

    // Debug: Log what we receive
    logger.info('[Outlook Get Email By ID] Request received', {
      emailIdLength: emailId?.length,
      emailIdStart: emailId?.substring(0, 30),
      emailIdEnd: emailId?.substring(emailId.length - 30)
    })

    const supabase = await createSupabaseRouteHandlerClient()
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return errorResponse("Unauthorized", 401)
    }

    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("*")
      .eq("provider", "microsoft-outlook")
      .eq("user_id", user.id)
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (integrationError || !integration) {
      return errorResponse("No connected Microsoft Outlook integration found", 404)
    }

    if (!integration.access_token) {
      return errorResponse("No access token available for Microsoft Outlook integration", 401)
    }

    const accessToken = await decryptToken(integration.access_token)

    if (!accessToken) {
      return errorResponse("Failed to decrypt Microsoft Outlook access token", 401)
    }

    // Fetch the email details
    const emailEndpoint = `https://graph.microsoft.com/v1.0/me/messages/${emailId}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,hasAttachments,importance`

    const emailResponse = await fetch(emailEndpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    })

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text()
      logger.error("[Outlook Get Email By ID] API Error:", emailResponse.status, errorText)

      if (emailResponse.status === 401) {
        return errorResponse("Microsoft Outlook authentication failed. Please reconnect your account.", 401)
      }

      if (emailResponse.status === 404) {
        return errorResponse("Email not found. The email ID may be invalid or the email may have been deleted.", 404)
      }

      return errorResponse("Failed to fetch email details", emailResponse.status)
    }

    const email = await emailResponse.json()

    // Fetch attachments list
    const attachmentsEndpoint = `https://graph.microsoft.com/v1.0/me/messages/${emailId}/attachments?$select=id,name,contentType,size,isInline,lastModifiedDateTime`

    const attachmentsResponse = await fetch(attachmentsEndpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    })

    let attachments: any[] = []
    if (attachmentsResponse.ok) {
      const attachmentsData = await attachmentsResponse.json()
      attachments = (attachmentsData.value || []).map((att: any) => ({
        id: att.id,
        name: att.name,
        contentType: att.contentType,
        size: att.size,
        isInline: att.isInline,
        type: att['@odata.type']?.replace('#microsoft.graph.', '') || 'fileAttachment'
      }))
    }

    // Format the response
    return jsonResponse({
      email: {
        id: email.id,
        subject: email.subject || '(No subject)',
        from: email.from?.emailAddress?.address || 'Unknown sender',
        fromName: email.from?.emailAddress?.name,
        to: email.toRecipients?.map((r: any) => r.emailAddress?.address).filter(Boolean) || [],
        cc: email.ccRecipients?.map((r: any) => r.emailAddress?.address).filter(Boolean) || [],
        receivedDateTime: email.receivedDateTime,
        bodyPreview: email.bodyPreview,
        hasAttachments: email.hasAttachments,
        importance: email.importance
      },
      attachments,
      attachmentCount: attachments.length,
      inlineCount: attachments.filter((a: any) => a.isInline).length,
      fileCount: attachments.filter((a: any) => !a.isInline).length
    })
  } catch (error: any) {
    logger.error("[Outlook Get Email By ID] Error:", error)
    return errorResponse(error.message || "Failed to fetch email", 500)
  }
}
