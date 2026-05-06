import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { LifecycleError } from "@/core/workflows/lifecycle";
import type { WorkflowRecord } from "@/repositories/workflows";
import type { WorkflowDetail, WorkflowSummary } from "@/contracts/workflow";

/**
 * Shared route-layer helpers for /api/workflows.
 *
 * Per project-structure-and-module-boundaries.md §5: route handlers stay
 * thin. This file owns the shape of cross-cutting concerns (auth gate,
 * LifecycleError → HTTP, summary mapping) so each route file is a 5–10 line
 * "validate input → call orchestrator → format response."
 *
 * Underscore-prefixed file: not a route. Importable from sibling route.ts
 * files only.
 */

export interface AuthSuccess {
  ok: true;
  userId: string;
}
export interface AuthFailure {
  ok: false;
  response: NextResponse;
}

export async function requireUser(): Promise<AuthSuccess | AuthFailure> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthenticated" },
        { status: 401 },
      ),
    };
  }
  return { ok: true, userId: user.id };
}

/**
 * LifecycleError → HTTP. Code-stable for client UIs that branch on
 * `code`; status carries the user-actionable distinction (404 vs 409 vs 422).
 */
export function lifecycleErrorResponse(err: LifecycleError): NextResponse {
  const status = LIFECYCLE_HTTP_STATUS[err.code];
  return NextResponse.json(
    {
      error: err.message,
      code: err.code,
      details: err.details,
    },
    { status },
  );
}

const LIFECYCLE_HTTP_STATUS: Readonly<Record<LifecycleError["code"], number>> = {
  WORKFLOW_NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  LIFECYCLE_CONFLICT: 409,
  MISSING_PRECONDITIONS: 422,
  TRIGGER_REGISTRATION_FAILED: 502,
};

/** Wraps an orchestrator call and converts LifecycleError → JSON response. */
export async function runLifecycle<T>(
  fn: () => Promise<T>,
  toResponse: (result: T) => NextResponse,
): Promise<NextResponse> {
  try {
    const result = await fn();
    return toResponse(result);
  } catch (err) {
    if (err instanceof LifecycleError) {
      return lifecycleErrorResponse(err);
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export function toWorkflowSummary(record: WorkflowRecord): WorkflowSummary {
  return {
    id: record.id,
    name: record.name,
    state: record.state,
    disabledReason: record.disabledReason,
    disabledContext: record.disabledContext,
    deletedAt: record.deletedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toWorkflowDetail(record: WorkflowRecord): WorkflowDetail {
  return {
    ...toWorkflowSummary(record),
    activeRevisionId: record.activeRevisionId,
    draftDefinition: record.draftDefinition,
  };
}

/** Parses request body with the supplied Zod schema; returns a 400 response on failure. */
export async function parseJsonBody<T>(
  request: Request,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ message: string; path: ReadonlyArray<string | number> }> } } },
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      ),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid request body.",
          issues: parsed.error.issues,
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: parsed.data };
}
