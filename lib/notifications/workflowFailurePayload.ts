/**
 * Shared structured payload for workflow failure notifications.
 *
 * One classification → one payload → fanned out to email / Slack / Discord /
 * SMS / in-app. Builds a sensible CTA URL from the classification's `action`:
 *
 *   - 'reconnect'    → /integrations
 *   - 'open_node'    → /workflows/builder/{workflowId}?focusNode={nodeId}
 *                      &historyExecution={executionId}
 *   - 'upgrade_plan' → /subscription
 *   - null           → deep link to History modal
 *
 * Pure builder — no I/O. Uses NEXT_PUBLIC_APP_URL when set, falls back to
 * https://chainreact.app for absolute URLs in email / Slack / Discord.
 */

import type { PersistedErrorClassification } from "@/lib/workflows/errors/classifyExecutionFailure"

export interface WorkflowFailurePayload {
  /** Subject line for email; first line for Slack/Discord. */
  subject: string
  /** Humanized headline (e.g. "Reconnect Gmail"). */
  title: string
  /** One-sentence explanation of what went wrong. */
  description: string
  /** What the user can do (e.g. "Reconnect Gmail, then retry the workflow."). */
  hint: string | null
  /** Channel-agnostic CTA. Always present — falls back to the History deep-link. */
  cta: { label: string; url: string } | null
  /** Used by Slack/Discord blocks to colorize. */
  severity: "error" | "warning"
  /** Workflow context. */
  workflowId: string
  workflowName: string
  /** Execution context. */
  executionId: string | null
  /** Raw error message — included in email Technical Details, omitted from SMS. */
  technicalDetails: string | null
  /** Failed step name, when available. */
  failedStepName: string | null
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://chainreact.app"
  )
}

function buildHistoryDeepLink(workflowId: string, executionId: string | null): string {
  const base = `${appBaseUrl()}/workflows/builder/${workflowId}`
  return executionId ? `${base}?historyExecution=${executionId}` : base
}

function buildCta(
  classification: PersistedErrorClassification | null,
  workflowId: string,
  executionId: string | null
): { label: string; url: string } | null {
  if (!classification?.action) {
    // No specific action — link to the History modal so users can see details + retry
    return {
      label: "View execution",
      url: buildHistoryDeepLink(workflowId, executionId),
    }
  }

  const base = appBaseUrl()
  if (classification.action === "reconnect") {
    return {
      label: classification.provider
        ? `Reconnect ${capitalize(classification.provider)}`
        : "Reconnect integration",
      url: `${base}/integrations`,
    }
  }
  if (classification.action === "open_node") {
    const params = new URLSearchParams()
    if (classification.nodeId) params.set("focusNode", classification.nodeId)
    if (executionId) params.set("historyExecution", executionId)
    const qs = params.toString()
    return {
      label: "Open failing node",
      url: `${base}/workflows/builder/${workflowId}${qs ? `?${qs}` : ""}`,
    }
  }
  if (classification.action === "upgrade_plan") {
    return { label: "Manage billing", url: `${base}/subscription` }
  }
  return null
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function buildWorkflowFailurePayload(input: {
  workflowId: string
  workflowName: string
  executionId: string | null
  classification: PersistedErrorClassification | null
  rawErrorMessage: string | null
}): WorkflowFailurePayload {
  const { workflowId, workflowName, executionId, classification, rawErrorMessage } = input

  const title = classification?.title || "Workflow failed"
  const description =
    classification?.description ||
    rawErrorMessage ||
    "The workflow run did not complete."
  const hint = classification?.hint || null
  const severity: "error" | "warning" = classification?.severity || "error"
  const cta = buildCta(classification, workflowId, executionId)
  const subject = `${title}: ${workflowName}`

  return {
    subject,
    title,
    description,
    hint,
    cta,
    severity,
    workflowId,
    workflowName,
    executionId,
    technicalDetails: rawErrorMessage,
    failedStepName: classification?.nodeName || null,
  }
}
