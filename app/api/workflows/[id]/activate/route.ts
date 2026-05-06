import { NextResponse } from "next/server";
import { LifecycleOrchestrator } from "@/services/workflows/lifecycleOrchestrator";
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
  const orch = new LifecycleOrchestrator();
  return runLifecycle(
    () => orch.activate(id),
    (record) => NextResponse.json(toWorkflowSummary(record)),
  );
}
