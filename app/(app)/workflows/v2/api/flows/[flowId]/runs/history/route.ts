import { NextResponse } from "next/server"
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { logger } from "@/lib/utils/logger"

/**
 * GET /workflows/v2/api/flows/[flowId]/runs/history
 * Returns execution history for a workflow, mapped to FlowRunSummary shape.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ flowId: string }> }
) {
  try {
    const { flowId } = await params
    const supabase = await createSupabaseRouteHandlerClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    // Verify user owns the workflow
    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id, user_id")
      .eq("id", flowId)
      .single()

    if (workflowError || !workflow) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 })
    }

    if (workflow.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const { data: sessions, error } = await supabase
      .from("workflow_execution_sessions")
      .select(
        "id, status, started_at, completed_at, test_mode, session_type, error_message, error_classification"
      )
      .eq("workflow_id", flowId)
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(50)

    if (error) {
      logger.error("[v2/runs/history] Query error:", { error: error.message })
      return NextResponse.json({ runs: [] })
    }

    // Map to FlowRunSummary shape expected by WorkflowHistoryDialog
    const runs = (sessions || []).map((s) => ({
      id: s.id,
      status: s.status === "completed" ? "success" : s.status,
      startedAt: s.started_at,
      finishedAt: s.completed_at,
      revisionId: null,
      sessionType: s.session_type || "manual",
      errorMessage: s.error_message || null,
      errorClassification: s.error_classification || null,
      metadata: {
        ...(s.error_message ? { error: s.error_message } : {}),
      },
    }))

    return NextResponse.json({ runs })
  } catch (error) {
    logger.error("[v2/runs/history] Unexpected error:", error)
    return NextResponse.json({ runs: [] })
  }
}
