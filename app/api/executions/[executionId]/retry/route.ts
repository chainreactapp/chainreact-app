/**
 * POST /api/executions/[executionId]/retry
 *
 * Retry a failed workflow execution as a full rerun:
 *   - Loads original trigger_data from the failed session row
 *   - Verifies the caller owns the execution + workflow
 *   - Forwards to /api/workflows/execute with retryOf=originalExecutionId,
 *     source='retry', inputData=originalTriggerData
 *
 * Forwarding (vs reimplementing) keeps the auth, billing, cost-gate,
 * rate-limit, team-suspension, and circuit-breaker checks in a single
 * place. The original execution row is never mutated.
 *
 * Limitations (v1, see CLAUDE.md §10 follow-up):
 *   - Full rerun only. No resume-from-failed-node.
 *   - Side-effect dedupe is session-scoped: prior successful provider calls
 *     may fire again on retry. The UI shows a warning before kicking this off.
 *   - Runs the *current* workflow, not the snapshot the original execution ran.
 */

import { NextRequest } from "next/server"
import { jsonResponse, errorResponse } from "@/lib/utils/api-response"
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { logger } from "@/lib/utils/logger"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const supabase = await createSupabaseRouteHandlerClient()

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return errorResponse("Unauthorized", 401)
    }

    const { executionId } = await params

    // Load original execution row
    const { data: original, error: lookupError } = await supabase
      .from("workflow_execution_sessions")
      .select("id, user_id, workflow_id, status, trigger_data")
      .eq("id", executionId)
      .single()

    if (lookupError || !original) {
      return errorResponse("Execution not found", 404)
    }

    if (original.user_id !== user.id) {
      return errorResponse("Forbidden", 403)
    }

    // Only failed / cancelled executions are retryable. A completed run isn't
    // an "error to retry"; a paused run has its own resume flow.
    if (original.status !== "failed" && original.status !== "cancelled") {
      return errorResponse(
        `Execution is not in a retryable state (status: ${original.status})`,
        400,
        { status: original.status }
      )
    }

    // Verify workflow still exists and is active. The execute route also
    // checks this, but we want a clean error before forwarding.
    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id, status")
      .eq("id", original.workflow_id)
      .single()

    if (workflowError || !workflow) {
      return errorResponse("Workflow no longer exists", 404)
    }

    if (workflow.status !== "active") {
      return errorResponse(
        `Workflow is not active (status: ${workflow.status}). Activate it before retrying.`,
        400,
        { workflowId: workflow.id, status: workflow.status }
      )
    }

    logger.info("[Retry Route] Forwarding retry to execute pipeline", {
      executionId,
      workflowId: original.workflow_id,
      userId: user.id,
    })

    // Forward to the canonical execute route. We pass the cookie header so the
    // forwarded request authenticates as the same user. This guarantees the
    // execute route runs the same auth + billing + cost-gate checks for retries
    // as it does for fresh executions.
    const cookieHeader = request.headers.get("cookie") || ""
    const origin = request.nextUrl.origin

    const forwardResponse = await fetch(`${origin}/api/workflows/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify({
        workflowId: original.workflow_id,
        executionMode: "live",
        inputData: original.trigger_data || {},
        retryOf: executionId,
      }),
    })

    const forwardBody = await forwardResponse.json().catch(() => ({}))

    if (!forwardResponse.ok) {
      logger.warn("[Retry Route] Forwarded execute returned non-OK", {
        executionId,
        status: forwardResponse.status,
        body: forwardBody,
      })
      return jsonResponse(forwardBody, { status: forwardResponse.status })
    }

    return jsonResponse({
      success: true,
      retryOf: executionId,
      ...forwardBody,
    })
  } catch (error) {
    logger.error("[Retry Route] Unexpected error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return errorResponse("Failed to retry execution", 500)
  }
}
