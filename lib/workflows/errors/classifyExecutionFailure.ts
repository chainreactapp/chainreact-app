/**
 * Build the persisted error_classification snapshot for a failed
 * workflow_execution_sessions row.
 *
 * Strategy:
 *   - If execution_steps has at least one row with status='failed', pick
 *     the first one (lowest step_number) and humanize it. Adds
 *     firstFailedNodeId + failedNodeCount metadata.
 *   - Otherwise (engine-level crash with no step rows), humanize from the
 *     fallback message — which becomes category='internal' unless the
 *     message itself surfaces a recognizable signal (401, 429, etc).
 *
 * Pure-ish: takes a Supabase client so callers can pass either the
 * service-role or cookie-bound client. Never throws — returns a
 * minimally-populated `internal` classification on lookup failures.
 */

import { humanizeActionError, type HumanizedError } from "./humanizeActionError"
import { logger } from "@/lib/utils/logger"

export interface PersistedErrorClassification extends HumanizedError {
  firstFailedNodeId: string | null
  failedNodeCount: number
}

/**
 * Extract a provider slug from a node_type identifier.
 * "gmail_action_send" → "gmail"
 * "google-calendar_action_create_event" → "google-calendar"
 * "core_logic_branch" → null (logic nodes have no provider)
 */
function providerFromNodeType(nodeType: string | null | undefined): string | null {
  if (!nodeType) return null
  const idx = nodeType.indexOf("_")
  if (idx <= 0) return null
  const head = nodeType.slice(0, idx)
  // Filter out non-provider prefixes
  if (head === "core" || head === "logic" || head === "ai") return null
  return head
}

export async function classifyExecutionFailure(
  supabase: any,
  executionId: string,
  fallbackErrorMessage: string | null
): Promise<PersistedErrorClassification> {
  let failedSteps: any[] = []

  try {
    const { data, error } = await supabase
      .from("execution_steps")
      .select("node_id, node_type, node_name, error_message, error_details, step_number")
      .eq("execution_id", executionId)
      .eq("status", "failed")
      .order("step_number", { ascending: true })

    if (error) {
      logger.warn(
        "[classifyExecutionFailure] Failed to load failed steps; falling back to engine message",
        { executionId, error: error.message }
      )
    } else {
      failedSteps = data || []
    }
  } catch (lookupError) {
    logger.warn(
      "[classifyExecutionFailure] execution_steps lookup threw; falling back to engine message",
      { executionId, error: lookupError instanceof Error ? lookupError.message : String(lookupError) }
    )
  }

  const failedNodeCount = failedSteps.length

  if (failedSteps.length === 0) {
    // No step rows — engine-level crash or test-mode path that doesn't record steps.
    const humanized = humanizeActionError({
      message: fallbackErrorMessage || null,
    })
    return {
      ...humanized,
      firstFailedNodeId: null,
      failedNodeCount: 0,
    }
  }

  const first = failedSteps[0]
  const errorDetails = first.error_details
  // ActionResult-shaped failure may have stashed { code, path, category, provider }
  // into error_details under various keys. Be liberal about where we look.
  const structuredError =
    (errorDetails && typeof errorDetails === "object"
      ? errorDetails.error || errorDetails.classifiedError || null
      : null) || null

  const category =
    (errorDetails && typeof errorDetails === "object" && typeof errorDetails.category === "string"
      ? errorDetails.category
      : null) ||
    (structuredError && typeof structuredError === "object" && typeof structuredError.category === "string"
      ? structuredError.category
      : null)

  const errorPayload =
    structuredError && (typeof structuredError === "object" || typeof structuredError === "string")
      ? structuredError
      : first.error_message || null

  const provider =
    (errorDetails && typeof errorDetails === "object" && typeof errorDetails.provider === "string"
      ? errorDetails.provider
      : null) || providerFromNodeType(first.node_type)

  const humanized = humanizeActionError({
    category,
    error: errorPayload,
    message: first.error_message || null,
    provider,
    nodeId: first.node_id || null,
    nodeName: first.node_name || null,
    rawErrorDetails: errorDetails,
  })

  return {
    ...humanized,
    firstFailedNodeId: first.node_id || null,
    failedNodeCount,
  }
}
