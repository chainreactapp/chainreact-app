import { ActionResult } from './core/executeWait'
import { getDecryptedAccessToken } from './core/getDecryptedAccessToken'
import { resolveValue } from './core/resolveValue'

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Send an email through Microsoft Outlook
 */
export async function sendOutlookEmail(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)

    const {
      to,
      cc,
      bcc,
      subject,
      body,
      attachments = []
    } = resolvedConfig

    if (!to || !subject || !body) {
      throw new Error("To, subject, and body are required")
    }

    // Get Outlook/Microsoft integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()

    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "microsoft-outlook")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      throw new Error("Microsoft Outlook integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "microsoft-outlook")

    // Parse recipients - handle both string and array formats
    const parseRecipients = (recipients: string | string[]): Array<{emailAddress: {address: string}}> => {
      if (!recipients) return []
      const emailArray = Array.isArray(recipients) ? recipients : recipients.split(',').map(e => e.trim())
      return emailArray.filter(e => e).map(email => ({ emailAddress: { address: email } }))
    }

    // Create email message payload
    const message: any = {
      subject: subject,
      body: {
        contentType: "HTML",
        content: body
      },
      toRecipients: parseRecipients(to)
    }

    if (cc) {
      message.ccRecipients = parseRecipients(cc)
    }

    if (bcc) {
      message.bccRecipients = parseRecipients(bcc)
    }

    // TODO: Add attachment support in future iteration
    // if (attachments && attachments.length > 0) {
    //   message.attachments = attachments.map(att => ({
    //     "@odata.type": "#microsoft.graph.fileAttachment",
    //     name: att.name,
    //     contentBytes: att.contentBytes
    //   }))
    // }

    // Send email using Microsoft Graph API
    const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message, saveToSentItems: true })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Microsoft Graph API error: ${response.status} - ${errorData.error?.message || response.statusText}`)
    }

    return {
      success: true,
      output: {
        to: to,
        cc: cc || "",
        bcc: bcc || "",
        subject: subject,
        sent: true,
        sentAt: new Date().toISOString()
      },
      message: `Email sent successfully to ${to}`
    }

  } catch (error: any) {
    logger.error("Outlook send email error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to send Outlook email"
    }
  }
}
