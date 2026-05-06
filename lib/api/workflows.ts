import type {
  CreateWorkflowRequest,
  DisableWorkflowRequest,
  UpdateWorkflowRequest,
  WorkflowDetail,
  WorkflowRunSummary,
  WorkflowSummary,
} from "@/contracts/workflow";

/**
 * Typed client for the workflows API.
 *
 * Per project-structure-and-module-boundaries.md §5: components and feature
 * hooks call this module, never `fetch()` directly. Errors carry the
 * lifecycle code (when present) so UIs can branch — `WorkflowApiError.code`
 * is one of LifecycleErrorCode plus the literal "BAD_REQUEST" / "HTTP_<status>"
 * for non-lifecycle failures.
 */

export type WorkflowApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "WORKFLOW_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "MISSING_PRECONDITIONS"
  | "TRIGGER_REGISTRATION_FAILED"
  | "LIFECYCLE_CONFLICT"
  | "SERVER_ERROR"
  | "UNKNOWN";

export class WorkflowApiError extends Error {
  readonly code: WorkflowApiErrorCode;
  readonly status: number;
  constructor(message: string, code: WorkflowApiErrorCode, status: number) {
    super(message);
    this.name = "WorkflowApiError";
    this.code = code;
    this.status = status;
  }
}

interface ServerErrorBody {
  error?: string;
  code?: string;
}

async function parseError(res: Response): Promise<WorkflowApiError> {
  let body: ServerErrorBody = {};
  try {
    body = (await res.json()) as ServerErrorBody;
  } catch {
    /* not json */
  }
  const message = body.error ?? `Workflow request failed (HTTP ${res.status}).`;
  const code = pickCode(body.code, res.status);
  return new WorkflowApiError(message, code, res.status);
}

function pickCode(serverCode: string | undefined, status: number): WorkflowApiErrorCode {
  if (serverCode) {
    switch (serverCode) {
      case "WORKFLOW_NOT_FOUND":
      case "INVALID_TRANSITION":
      case "MISSING_PRECONDITIONS":
      case "TRIGGER_REGISTRATION_FAILED":
      case "LIFECYCLE_CONFLICT":
        return serverCode;
      default:
        return "UNKNOWN";
    }
  }
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 404) return "WORKFLOW_NOT_FOUND";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

async function postJson<TResp>(
  url: string,
  body: unknown,
): Promise<TResp> {
  const res = await fetch(url, {
    method: "POST",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as TResp;
}

async function patchJson<TResp>(url: string, body: unknown): Promise<TResp> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as TResp;
}

// ── operations ──────────────────────────────────────────────────────────────

export async function createWorkflow(
  input: CreateWorkflowRequest,
): Promise<WorkflowSummary> {
  return postJson<WorkflowSummary>("/api/workflows", input);
}

export async function listWorkflows(): Promise<readonly WorkflowSummary[]> {
  const res = await fetch("/api/workflows");
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { workflows: WorkflowSummary[] };
  return body.workflows;
}

export async function getWorkflow(id: string): Promise<WorkflowDetail> {
  const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as WorkflowDetail;
}

export async function updateWorkflow(
  id: string,
  input: UpdateWorkflowRequest,
): Promise<WorkflowDetail> {
  return patchJson<WorkflowDetail>(
    `/api/workflows/${encodeURIComponent(id)}`,
    input,
  );
}

export interface ListRunsOptions {
  /** Defaults to server-side default (25); server caps at 100. */
  limit?: number;
}

export async function listWorkflowRuns(
  id: string,
  opts: ListRunsOptions = {},
): Promise<readonly WorkflowRunSummary[]> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const url = `/api/workflows/${encodeURIComponent(id)}/runs${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { runs: WorkflowRunSummary[] };
  return body.runs;
}

export async function activateWorkflow(id: string): Promise<WorkflowSummary> {
  return postJson<WorkflowSummary>(
    `/api/workflows/${encodeURIComponent(id)}/activate`,
    undefined,
  );
}

export async function pauseWorkflow(id: string): Promise<WorkflowSummary> {
  return postJson<WorkflowSummary>(
    `/api/workflows/${encodeURIComponent(id)}/pause`,
    undefined,
  );
}

export async function resumeWorkflow(id: string): Promise<WorkflowSummary> {
  return postJson<WorkflowSummary>(
    `/api/workflows/${encodeURIComponent(id)}/resume`,
    undefined,
  );
}

export async function disableWorkflow(
  id: string,
  input: DisableWorkflowRequest,
): Promise<WorkflowSummary> {
  return postJson<WorkflowSummary>(
    `/api/workflows/${encodeURIComponent(id)}/disable`,
    input,
  );
}
