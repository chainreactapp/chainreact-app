import { NextResponse } from "next/server";
import { CreateWorkflowRequestSchema } from "@/contracts/workflow";
import * as workflowsRepo from "@/repositories/workflows";
import {
  parseJsonBody,
  requireUser,
  toWorkflowSummary,
} from "./_shared";

/**
 * POST /api/workflows — create a new draft workflow.
 * GET  /api/workflows — list the authenticated user's workflows (deleted hidden).
 *
 * Thin handler per project-structure-and-module-boundaries.md §5.
 */

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody(request, CreateWorkflowRequestSchema);
  if (!parsed.ok) return parsed.response;

  const record = await workflowsRepo.create({
    userId: auth.userId,
    name: parsed.data.name,
  });
  return NextResponse.json(toWorkflowSummary(record), { status: 201 });
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const records = await workflowsRepo.listByUser(auth.userId);
  return NextResponse.json({
    workflows: records.map(toWorkflowSummary),
  });
}
