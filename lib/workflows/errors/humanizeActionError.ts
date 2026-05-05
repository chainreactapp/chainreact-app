/**
 * Humanize an ActionResult-shaped failure into a user-facing summary.
 *
 * Pure function — no I/O, deterministic, unit-testable. Maps the Q1
 * ActionResult.category contract (provider | config | auth | validation |
 * idempotency | billing | internal) to a plain-english title + hint + CTA.
 *
 * Falls back to heuristic classification when category is absent (raw thrown
 * Error from older handlers, or engine-level catch). Heuristics never raise.
 */

export type ErrorCategory =
  | "auth"
  | "config"
  | "validation"
  | "idempotency"
  | "billing"
  | "provider"
  | "internal"

export type ErrorAction = "reconnect" | "open_node" | "upgrade_plan" | null

export type ErrorSeverity = "error" | "warning"

export interface HumanizedError {
  category: ErrorCategory
  code: string | null
  provider: string | null
  path: string | null
  title: string
  description: string
  hint: string
  action: ErrorAction
  severity: ErrorSeverity
  nodeId: string | null
  nodeName: string | null
}

export interface HumanizeInput {
  category?: string | null
  error?: string | { code?: string; path?: string } | null
  message?: string | null
  provider?: string | null
  nodeId?: string | null
  nodeName?: string | null
  rawErrorDetails?: any
}

const PROVIDER_DISPLAY: Record<string, string> = {
  gmail: "Gmail",
  google: "Google",
  "google-calendar": "Google Calendar",
  "google-drive": "Google Drive",
  "google-sheets": "Google Sheets",
  "google-docs": "Google Docs",
  microsoft: "Microsoft",
  outlook: "Outlook",
  onedrive: "OneDrive",
  "microsoft-teams": "Microsoft Teams",
  slack: "Slack",
  discord: "Discord",
  github: "GitHub",
  notion: "Notion",
  hubspot: "HubSpot",
  airtable: "Airtable",
  trello: "Trello",
  stripe: "Stripe",
  shopify: "Shopify",
}

function providerName(provider: string | null | undefined): string {
  if (!provider) return "the integration"
  return (
    PROVIDER_DISPLAY[provider] ||
    provider.charAt(0).toUpperCase() + provider.slice(1)
  )
}

function extractCode(error: HumanizeInput["error"]): string | null {
  if (!error) return null
  if (typeof error === "string") return error
  if (typeof error === "object" && typeof error.code === "string") return error.code
  return null
}

function extractPath(error: HumanizeInput["error"]): string | null {
  if (!error || typeof error === "string") return null
  if (typeof error === "object" && typeof error.path === "string") return error.path
  return null
}

function isValidCategory(c: unknown): c is ErrorCategory {
  return (
    c === "auth" ||
    c === "config" ||
    c === "validation" ||
    c === "idempotency" ||
    c === "billing" ||
    c === "provider" ||
    c === "internal"
  )
}

/**
 * Heuristic category inference when the upstream caller didn't provide one.
 * Looks at code + raw message + raw error details. Conservative: defaults to
 * `internal` so nothing else gets a misleading CTA.
 */
function inferCategory(
  code: string | null,
  message: string | null,
  rawErrorDetails: any
): ErrorCategory {
  const lower = (s: string | null | undefined) => (s || "").toLowerCase()
  const codeLower = lower(code)
  const msgLower = lower(message)
  const detailsLower = (() => {
    try {
      return lower(JSON.stringify(rawErrorDetails || ""))
    } catch {
      return ""
    }
  })()
  const haystack = `${codeLower} ${msgLower} ${detailsLower}`

  // Auth signals
  if (
    codeLower === "auth_reconnect_required" ||
    codeLower === "token_revoked" ||
    codeLower === "invalid_grant" ||
    haystack.includes("401") ||
    haystack.includes("unauthorized") ||
    haystack.includes("invalid_grant") ||
    haystack.includes("token has been expired") ||
    haystack.includes("token expired") ||
    haystack.includes("token_revoked")
  ) {
    return "auth"
  }

  // Config signals
  if (
    codeLower === "missing_variable" ||
    codeLower === "missing_required_field" ||
    codeLower === "invalid_time_format"
  ) {
    return "config"
  }

  // Idempotency signals
  if (codeLower === "payload_mismatch") {
    return "idempotency"
  }

  // Billing signals
  if (
    codeLower === "insufficient_balance" ||
    haystack.includes("insufficient_balance") ||
    haystack.includes("insufficient task") ||
    (haystack.includes("402") && haystack.includes("payment"))
  ) {
    return "billing"
  }

  // Provider signals (rate limits, 5xx, generic provider error codes)
  if (
    haystack.includes("rate limit") ||
    haystack.includes("ratelimited") ||
    haystack.includes("429") ||
    /\b5\d\d\b/.test(haystack)
  ) {
    return "provider"
  }

  return "internal"
}

/**
 * Pretty path string for error.path. Examples:
 *   "to" → "To"
 *   "config.body" → "Body"
 *   "attendees[0].email" → "Attendees → Email"
 */
function prettifyPath(path: string | null): string | null {
  if (!path) return null
  // Strip a leading "config." prefix that handlers tend to emit
  const stripped = path.replace(/^config\./, "")
  if (!stripped) return null
  // Take the last meaningful segment, drop array indices
  const segments = stripped
    .split(".")
    .map((s) => s.replace(/\[\d+\]/g, ""))
    .filter(Boolean)
  if (segments.length === 0) return null
  const last = segments[segments.length - 1]
  return last.charAt(0).toUpperCase() + last.slice(1)
}

export function humanizeActionError(input: HumanizeInput): HumanizedError {
  const code = extractCode(input.error)
  const path = extractPath(input.error)
  const provider = input.provider || null
  const message = input.message || (typeof input.error === "string" ? input.error : null)

  const category: ErrorCategory = isValidCategory(input.category)
    ? input.category
    : inferCategory(code, message, input.rawErrorDetails)

  const display = providerName(provider)
  const fieldLabel = prettifyPath(path)

  let title: string
  let description: string
  let hint: string
  let action: ErrorAction
  let severity: ErrorSeverity = "error"

  switch (category) {
    case "auth": {
      title = `Reconnect ${display}`
      description = `Your ${display} connection expired or was revoked.`
      hint = `Reconnect ${display} from the integrations page, then retry the workflow.`
      action = "reconnect"
      break
    }
    case "config": {
      if (code === "MISSING_VARIABLE") {
        title = "Missing variable"
        description = fieldLabel
          ? `The field "${fieldLabel}" references upstream data that wasn't available at runtime.`
          : "A field references upstream data that wasn't available at runtime."
        hint = "Open the failing node and either map the field to a different source or set a fallback value."
      } else if (code === "MISSING_REQUIRED_FIELD") {
        title = "Required field missing"
        description = fieldLabel
          ? `The field "${fieldLabel}" must be set explicitly — no default is provided.`
          : "A required field must be set explicitly — no default is provided."
        hint = "Open the failing node and fill in the required field."
      } else if (code === "INVALID_TIME_FORMAT") {
        title = "Invalid time format"
        description = fieldLabel
          ? `The field "${fieldLabel}" must be a 24-hour HH:MM time (e.g. 09:00).`
          : "A time field must be a 24-hour HH:MM time (e.g. 09:00)."
        hint = "Open the failing node and correct the time value."
      } else {
        title = "Configuration error"
        description = fieldLabel
          ? `The field "${fieldLabel}" is misconfigured.`
          : message || "A node is misconfigured."
        hint = "Open the failing node and review its configuration."
      }
      action = "open_node"
      break
    }
    case "validation": {
      title = "Invalid input"
      description = message || "The handler rejected the input as invalid."
      hint = "Open the failing node and adjust the input that caused the validation failure."
      action = "open_node"
      break
    }
    case "idempotency": {
      title = "Duplicate run with different inputs"
      description =
        "This step was already run in this session with different inputs. To avoid double-charging or duplicate side-effects, the run was blocked."
      hint =
        "Start a new workflow run instead of re-running the same step with new inputs."
      action = null
      severity = "warning"
      break
    }
    case "billing": {
      title = "Insufficient task balance"
      description =
        "Your plan ran out of tasks for this period and overage / packs are not enabled."
      hint =
        "Upgrade your plan, enable overage billing, or buy a task pack to continue."
      action = "upgrade_plan"
      break
    }
    case "provider": {
      title = `${display} returned an error`
      description = message || `${display} rejected the request.`
      hint = `Check ${display} status and any rate limits. Retrying may succeed.`
      action = null
      break
    }
    case "internal":
    default: {
      title = "Unexpected error"
      description = message || "The workflow engine hit an unexpected error."
      hint = "Retrying may succeed. If the error persists, contact support."
      action = null
      break
    }
  }

  return {
    category,
    code: code,
    provider,
    path,
    title,
    description,
    hint,
    action,
    severity,
    nodeId: input.nodeId || null,
    nodeName: input.nodeName || null,
  }
}
