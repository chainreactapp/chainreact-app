import { NextResponse } from "next/server";
import { createLifecycleOrchestrator } from "@/services/workflows/orchestratorFactory";
import {
  requireUser,
  runLifecycle,
  toWorkflowSummary,
} from "../../_shared";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const orch = createLifecycleOrchestrator();
  return runLifecycle(
    () => orch.resume(id),
    (record) => NextResponse.json(toWorkflowSummary(record)),
  );
}
