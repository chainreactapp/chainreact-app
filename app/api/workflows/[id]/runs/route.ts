import { NextResponse } from "next/server";
import * as workflowRunsRepo from "@/repositories/workflowRuns";
import { requireUser, toWorkflowRunSummary } from "../../_shared";

/**
 * GET /api/workflows/[id]/runs — list this workflow's recent runs.
 *
 * RLS gates the read by user_id; the query implicitly returns only the
 * authenticated user's runs (workflowRuns.listByWorkflow uses the
 * SSR-cookie client). Defaults to 25; ?limit=N caps at 100 (enforced in
 * the repository).
 *
 * Workflow ownership is also gated by RLS: a workflow_id that doesn't
 * belong to the user produces an empty list, never a leak.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : null;
  const limit =
    parsedLimit !== null && Number.isFinite(parsedLimit) && parsedLimit > 0
      ? parsedLimit
      : undefined;

  const records = await workflowRunsRepo.listByWorkflow(
    id,
    limit !== undefined ? { limit } : {},
  );
  return NextResponse.json({
    runs: records.map(toWorkflowRunSummary),
  });
}
