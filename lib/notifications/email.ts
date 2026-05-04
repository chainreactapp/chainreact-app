/**
 * Email Notification Service using Resend
 */

import { Resend } from 'resend'
import { logger } from '@/lib/utils/logger'

let _resend: Resend | null = null
function getResendClient(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY environment variable is not set')
    }
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

interface EmailOptions {
  to: string
  subject: string
  text?: string
  html?: string
}

/**
 * Send email notification
 */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string
): Promise<boolean> {
  try {
    // Validate environment
    if (!process.env.RESEND_API_KEY) {
      logger.error('Resend API key not configured')
      return false
    }

    // Validate email
    if (!to || !to.includes('@')) {
      logger.error('Invalid email address:', to)
      return false
    }

    // Send email
    const result = await getResendClient().emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'ChainReact <notifications@chainreact.app>',
      to: [to],
      subject,
      text,
      html: html || generateErrorEmailHTML(subject, text),
    })

    logger.info('Email sent successfully:', {
      to,
      subject,
      id: result.data?.id
    })

    return true
  } catch (error: any) {
    logger.error('Failed to send email:', {
      error: error.message,
      to,
      subject
    })
    return false
  }
}

/**
 * Generate HTML email template for errors
 */
function generateErrorEmailHTML(subject: string, body: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">⚠️ Workflow Error Alert</h1>
  </div>

  <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 10px 10px;">
    <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545;">
      <pre style="white-space: pre-wrap; word-wrap: break-word; background: #f8f9fa; padding: 15px; border-radius: 5px; font-size: 13px; margin: 0;">${body}</pre>
    </div>

    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; text-align: center;">
      <p style="color: #6c757d; font-size: 12px; margin: 0;">
        This is an automated notification from ChainReact
      </p>
      <p style="color: #6c757d; font-size: 12px; margin: 5px 0 0 0;">
        <a href="https://chainreact.app/workflows" style="color: #667eea; text-decoration: none;">View Workflow →</a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim()
}

/**
 * Send workflow error email with humanized classified payload.
 * The plain-text variant carries the full content; the HTML variant uses
 * the title + description + hint + CTA button + collapsed Technical Details.
 */
import type { WorkflowFailurePayload } from './workflowFailurePayload'

export async function sendWorkflowErrorEmail(
  to: string,
  payload: WorkflowFailurePayload
): Promise<boolean> {
  const { subject, title, description, hint, cta, workflowName, technicalDetails } = payload

  const textLines = [
    `${title} — workflow "${workflowName}"`,
    "",
    description,
  ]
  if (hint) {
    textLines.push("", hint)
  }
  if (cta) {
    textLines.push("", `${cta.label}: ${cta.url}`)
  }
  if (technicalDetails) {
    textLines.push("", "---", "Technical details:", technicalDetails)
  }
  const text = textLines.join("\n")

  const html = renderWorkflowErrorEmailHtml(payload)
  return sendEmail(to, subject, text, html)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function renderWorkflowErrorEmailHtml(p: WorkflowFailurePayload): string {
  const accent = p.severity === "warning" ? "#d97706" : "#dc2626"
  const accentBg = p.severity === "warning" ? "#fffbeb" : "#fef2f2"
  const accentBorder = p.severity === "warning" ? "#fde68a" : "#fecaca"

  const ctaButton = p.cta
    ? `<div style="margin-top: 20px;">
         <a href="${escapeHtml(p.cta.url)}" style="display: inline-block; background: ${accent}; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">${escapeHtml(p.cta.label)}</a>
       </div>`
    : ""

  const hintBlock = p.hint
    ? `<p style="margin: 12px 0 0; color: #4b5563; font-size: 14px; font-style: italic;">${escapeHtml(p.hint)}</p>`
    : ""

  const failedStep = p.failedStepName
    ? `<p style="margin: 12px 0 0; color: #6b7280; font-size: 13px;">Failed step: <strong style="color: #111827;">${escapeHtml(p.failedStepName)}</strong></p>`
    : ""

  const technicalBlock = p.technicalDetails
    ? `<details style="margin-top: 24px; padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;">
         <summary style="cursor: pointer; color: #6b7280; font-size: 12px; font-weight: 600;">Technical details</summary>
         <pre style="margin: 12px 0 0; padding: 10px; background: white; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 12px; white-space: pre-wrap; word-wrap: break-word; color: #111827; font-family: ui-monospace, monospace;">${escapeHtml(p.technicalDetails)}</pre>
       </details>`
    : ""

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(p.subject)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.5; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px;">
  <div style="background: ${accentBg}; border: 1px solid ${accentBorder}; border-left: 4px solid ${accent}; padding: 20px; border-radius: 8px;">
    <p style="margin: 0; color: ${accent}; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Workflow failed</p>
    <h1 style="margin: 8px 0 0; font-size: 20px; color: #111827;">${escapeHtml(p.title)}</h1>
    <p style="margin: 12px 0 0; color: #374151; font-size: 14px;">${escapeHtml(p.description)}</p>
    ${failedStep}
    ${hintBlock}
    ${ctaButton}
  </div>
  <p style="margin: 20px 0 0; color: #6b7280; font-size: 13px;">
    Workflow: <strong>${escapeHtml(p.workflowName)}</strong><br>
    ${p.executionId ? `Execution ID: <code style="font-size: 12px;">${escapeHtml(p.executionId)}</code><br>` : ""}
    Time: ${new Date().toLocaleString()}
  </p>
  ${technicalBlock}
  <p style="margin: 32px 0 0; color: #9ca3af; font-size: 11px; text-align: center;">
    This is an automated notification from ChainReact.
  </p>
</body>
</html>`
}
