import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { decideV2LiveDispatch } from "@/lib/execution/v2LiveExecutionDispatch"
import { FEATURE_FLAGS } from "@/lib/featureFlags"
import { createAdminClient } from "@/lib/supabase/admin"

import { logger } from '@/lib/utils/logger'

/**
 * /api/workflows/execute-advanced — manual workflow execution with the
 * legacy "advanced" knobs (enableParallel / maxConcurrency /
 * enableSubWorkflows).
 *
 * **Note (2026-05-05, v2 canonical engine consolidation):** the v1
 * "advanced" knobs are dead code per `learning/docs/v1-prod-audit.md` §2:
 * `enableParallel`, `maxConcurrency`, `executeParallelBranches`, and
 * `executeSubWorkflows` (with `workflow_compositions`) are never actually
 * exercised by v1's runtime path. The route accepts them for backward
 * compat but they're no-ops on either engine. Phase 5 stage 5 deletes
 * the v1 implementations entirely; this route stays as a thin alias for
 * manual execution.
 *
 * PR-V2-EXECUTE-ADVANCED: routes through v2 (WorkflowExecutionService)
 * when flag + per-user opt-in are set; otherwise falls through to v1.
 */

export async function POST(request: Request) {
  cookies()
  const supabase = await createSupabaseRouteHandlerClient()

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return errorResponse("Not authenticated" , 401)
    }

    const { workflowId, inputData = {}, options = {}, startNodeId } = await request.json()

    if (!workflowId) {
      return errorResponse("Workflow ID is required" , 400)
    }

    // Verify workflow ownership
    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("*")
      .eq("id", workflowId)
      .eq("user_id", user.id)
      .single()

    if (workflowError || !workflow) {
      return errorResponse("Workflow not found" , 404)
    }

    // Resolve dispatch decision (v1 vs v2). Mirrors the main execute
    // route's pattern: per-user opt-in is read from user_profiles by
    // the admin client.
    let userOptedIntoV2Execution = false
    try {
      const adminSupabase = createAdminClient()
      const { data: profile } = await adminSupabase
        .from('user_profiles')
        .select('opt_in_v2_execution')
        .eq('id', user.id)
        .maybeSingle()
      userOptedIntoV2Execution = !!(profile as any)?.opt_in_v2_execution
    } catch (lookupError: any) {
      logger.warn('[execute-advanced] opt-in lookup failed; defaulting to v1', {
        userId: user.id,
        error: lookupError?.message,
      })
    }

    const v2Dispatch = decideV2LiveDispatch({
      executionMode: 'live',
      flagEnabled: FEATURE_FLAGS.V2_LIVE_EXECUTION,
      userOptedIn: userOptedIntoV2Execution,
    })
    logger.info('[execute-advanced] Engine dispatch', {
      workflowId,
      userId: user.id,
      ...v2Dispatch.log,
    })

    if (v2Dispatch.useV2) {
      // v2 path: lazy-import the service so v1-only consumers don't pay
      // for v2's transitive `server-only` import cost.
      const { WorkflowExecutionService } = await import('@/lib/services/workflowExecutionService')
      const service = new WorkflowExecutionService()
      const v2Result: any = await service.executeWorkflow(
        workflow,
        inputData,
        user.id,
        false, // testMode
        undefined, // workflowData — v2 loads from normalized tables
        false, // skipTriggers
        undefined, // testModeConfig
        supabase,
      )

      if (v2Result?.billingFailed === true) {
        const errorMsg = v2Result.billingOutcome?.error ?? 'Billing rejected execution.'
        return errorResponse(errorMsg, v2Result.billingOutcome?.kind === 'subscription_inactive' ? 503 : 402)
      }

      return jsonResponse({
        success: !!v2Result?.success,
        sessionId: v2Result?.executionId,
        result: v2Result,
      })
    }

    // v1 path (default while flag/opt-in are off). Lazy-import to keep
    // v1's heavy module graph out of the v2 path.
    const { AdvancedExecutionEngine } = await import('@/lib/execution/advancedExecutionEngine')
    const executionEngine = new AdvancedExecutionEngine()

    const executionSession = await executionEngine.createExecutionSession(workflowId, user.id, "manual", {
      inputData,
      options,
    })

    const result = await executionEngine.executeWorkflowAdvanced(executionSession.id, inputData, {
      enableParallel: options.enableParallel ?? true,
      maxConcurrency: options.maxConcurrency ?? 3,
      enableSubWorkflows: options.enableSubWorkflows ?? true,
      startNodeId,
    })

    return jsonResponse({
      success: true,
      sessionId: executionSession.id,
      result,
    })
  } catch (error: any) {
    logger.error("Advanced workflow execution error:", error)
    return errorResponse(error.message || "Internal server error" , 500)
  }
}
