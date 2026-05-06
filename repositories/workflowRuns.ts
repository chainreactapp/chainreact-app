import { createClient } from "@/utils/supabase/server";
import { getServiceRoleClient } from "./supabase/serviceRoleClient";
import type { TriggerEvent } from "@/contracts/triggerEvent";

/**
 * Repository for workflow_runs.
 *
 * Engine path (recordRun) writes via service-role — runs persist in
 * background after a webhook returns 200, with no user session.
 *
 * UI path (listByWorkflow) reads via the SSR-cookie client so RLS gates
 * per-user access.
 */

export type WorkflowRunStatus = "succeeded" | "failed";

export interface WorkflowRunStep {
  nodeId: string;
  status: "succeeded" | "failed" | "skipped";
  output?: Readonly<Record<string, unknown>>;
  error?: {
    code: string;
    message: string;
    details?: Readonly<Record<string, unknown>>;
  };
}

export interface WorkflowRunFatalError {
  code: string;
  message: string;
}

export interface WorkflowRunErrorClassification {
  title: string;
  description: string;
  hint?: string;
  action?: "reconnect" | "open_node" | "upgrade_plan";
  severity: "warning" | "error";
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  userId: string;
  status: WorkflowRunStatus;
  triggerNodeId: string;
  triggerEvent: TriggerEvent;
  steps: readonly WorkflowRunStep[];
  fatalError: WorkflowRunFatalError | null;
  errorClassification: WorkflowRunErrorClassification | null;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}

interface WorkflowRunsRow {
  id: string;
  workflow_id: string;
  user_id: string;
  status: WorkflowRunStatus;
  trigger_node_id: string;
  trigger_event: TriggerEvent;
  steps: WorkflowRunStep[];
  fatal_error: WorkflowRunFatalError | null;
  error_classification: WorkflowRunErrorClassification | null;
  started_at: string;
  finished_at: string;
  created_at: string;
}

function rowToRecord(row: WorkflowRunsRow): WorkflowRunRecord {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    userId: row.user_id,
    status: row.status,
    triggerNodeId: row.trigger_node_id,
    triggerEvent: row.trigger_event,
    steps: row.steps,
    fatalError: row.fatal_error,
    errorClassification: row.error_classification,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export interface RecordRunInput {
  /** Engine-assigned run id (also the row's id). */
  runId: string;
  workflowId: string;
  userId: string;
  status: WorkflowRunStatus;
  triggerNodeId: string;
  triggerEvent: TriggerEvent;
  steps: readonly WorkflowRunStep[];
  fatalError?: WorkflowRunFatalError | null;
  errorClassification?: WorkflowRunErrorClassification | null;
  startedAt: string;
  finishedAt: string;
}

export async function recordRun(input: RecordRunInput): Promise<void> {
  const supabase = getServiceRoleClient(
    `engine: recordRun ${input.runId} (workflow ${input.workflowId})`,
  );
  const { error } = await supabase.from("workflow_runs").insert({
    id: input.runId,
    workflow_id: input.workflowId,
    user_id: input.userId,
    status: input.status,
    trigger_node_id: input.triggerNodeId,
    trigger_event: input.triggerEvent,
    steps: input.steps as readonly WorkflowRunStep[],
    fatal_error: input.fatalError ?? null,
    error_classification: input.errorClassification ?? null,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
  });
  if (error) {
    throw new Error(`workflow_runs.recordRun failed: ${error.message}`);
  }
}

export interface ListRunsOptions {
  /** Defaults to 25; capped at 100 to keep UI list pages snappy. */
  limit?: number;
}

/**
 * Atomically claim the notification-fanout slot for a run.
 *
 * Returns true if THIS call won the claim (caller proceeds to fan out
 * notifications). Returns false if the slot was already claimed (caller
 * skips silently — another invocation already fanned out).
 *
 * Race-safe via the WHERE error_notifications_sent_at IS NULL predicate
 * combined with the row's PK lock during UPDATE — concurrent claims
 * collapse to one winner. Service-role: this runs from background
 * execution (engine.persistRun) with no user session.
 *
 * Per V2 notifications platform plan §3 (Dedup strategy).
 */
export async function claimNotificationFanout(runId: string): Promise<boolean> {
  const supabase = getServiceRoleClient(
    `notifications: claimNotificationFanout ${runId}`,
  );
  const { data, error } = await supabase
    .from("workflow_runs")
    .update({ error_notifications_sent_at: new Date().toISOString() })
    .eq("id", runId)
    .is("error_notifications_sent_at", null)
    .select("id");
  if (error) {
    throw new Error(`workflow_runs.claimNotificationFanout failed: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

export async function listByWorkflow(
  workflowId: string,
  opts: ListRunsOptions = {},
): Promise<readonly WorkflowRunRecord[]> {
  const supabase = await createClient();
  const limit = Math.min(opts.limit ?? 25, 100);
  const { data, error } = await supabase
    .from("workflow_runs")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`workflow_runs.listByWorkflow failed: ${error.message}`);
  }
  return (data ?? []).map((r) => rowToRecord(r as WorkflowRunsRow));
}
