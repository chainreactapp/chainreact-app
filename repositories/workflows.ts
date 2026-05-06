import { createClient } from "@/utils/supabase/server";
import type {
  WorkflowState,
  WorkflowDisabledReason,
  WorkflowDefinition,
} from "@/contracts/workflow";

/**
 * Repository for workflows + workflow_revisions.
 *
 * Per docs/rules/database-security.md: server-side only. Lifecycle transition
 * logic lives in core/workflows/lifecycle.ts and services/workflows/lifecycleOrchestrator.ts;
 * this layer only persists what those decide.
 */

export interface WorkflowRecord {
  id: string;
  userId: string;
  name: string;
  state: WorkflowState;
  disabledReason: WorkflowDisabledReason | null;
  disabledContext: string | null;
  activeRevisionId: string | null;
  draftDefinition: WorkflowDefinition;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRevisionRecord {
  id: string;
  workflowId: string;
  userId: string;
  definition: WorkflowDefinition;
  createdAt: string;
}

interface WorkflowsRow {
  id: string;
  user_id: string;
  name: string;
  state: WorkflowState;
  disabled_reason: WorkflowDisabledReason | null;
  disabled_context: string | null;
  active_revision_id: string | null;
  draft_definition: unknown;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowRevisionsRow {
  id: string;
  workflow_id: string;
  user_id: string;
  definition: unknown;
  created_at: string;
}

function rowToRecord(row: WorkflowsRow): WorkflowRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    state: row.state,
    disabledReason: row.disabled_reason,
    disabledContext: row.disabled_context,
    activeRevisionId: row.active_revision_id,
    draftDefinition: (row.draft_definition ?? {}) as WorkflowDefinition,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function revisionRowToRecord(row: WorkflowRevisionsRow): WorkflowRevisionRecord {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    userId: row.user_id,
    definition: (row.definition ?? {}) as WorkflowDefinition,
    createdAt: row.created_at,
  };
}

// ── workflows ──────────────────────────────────────────────────────────────

export interface CreateWorkflowInput {
  userId: string;
  name: string;
  draftDefinition?: WorkflowDefinition;
}

export async function create(input: CreateWorkflowInput): Promise<WorkflowRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflows")
    .insert({
      user_id: input.userId,
      name: input.name,
      draft_definition: input.draftDefinition ?? { nodes: [], edges: [] },
    })
    .select()
    .single<WorkflowsRow>();
  if (error || !data) {
    throw new Error(`workflows.create failed: ${error?.message ?? "no row returned"}`);
  }
  return rowToRecord(data);
}

export async function getById(workflowId: string): Promise<WorkflowRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .maybeSingle<WorkflowsRow>();
  if (error) throw new Error(`workflows.getById failed: ${error.message}`);
  return data ? rowToRecord(data) : null;
}

export async function listByUser(
  userId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<readonly WorkflowRecord[]> {
  const supabase = await createClient();
  let query = supabase.from("workflows").select("*").eq("user_id", userId);
  if (!opts.includeDeleted) {
    query = query.neq("state", "deleted");
  }
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) throw new Error(`workflows.listByUser failed: ${error.message}`);
  return (data ?? []).map((r) => rowToRecord(r as WorkflowsRow));
}

export async function updateName(
  workflowId: string,
  name: string,
): Promise<WorkflowRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflows")
    .update({ name })
    .eq("id", workflowId)
    .select()
    .single<WorkflowsRow>();
  if (error || !data) {
    throw new Error(`workflows.updateName failed: ${error?.message ?? "no row returned"}`);
  }
  return rowToRecord(data);
}

export async function updateDraftDefinition(
  workflowId: string,
  definition: WorkflowDefinition,
): Promise<WorkflowRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflows")
    .update({ draft_definition: definition })
    .eq("id", workflowId)
    .select()
    .single<WorkflowsRow>();
  if (error || !data) {
    throw new Error(`workflows.updateDraftDefinition failed: ${error?.message ?? "no row returned"}`);
  }
  return rowToRecord(data);
}

// ── workflow_revisions ─────────────────────────────────────────────────────

export interface CreateRevisionInput {
  workflowId: string;
  userId: string;
  definition: WorkflowDefinition;
}

export async function createRevision(
  input: CreateRevisionInput,
): Promise<WorkflowRevisionRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_revisions")
    .insert({
      workflow_id: input.workflowId,
      user_id: input.userId,
      definition: input.definition,
    })
    .select()
    .single<WorkflowRevisionsRow>();
  if (error || !data) {
    throw new Error(
      `workflow_revisions.create failed: ${error?.message ?? "no row returned"}`,
    );
  }
  return revisionRowToRecord(data);
}

export async function setActiveRevision(
  workflowId: string,
  revisionId: string,
): Promise<WorkflowRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflows")
    .update({ active_revision_id: revisionId })
    .eq("id", workflowId)
    .select()
    .single<WorkflowsRow>();
  if (error || !data) {
    throw new Error(`workflows.setActiveRevision failed: ${error?.message ?? "no row returned"}`);
  }
  return rowToRecord(data);
}
