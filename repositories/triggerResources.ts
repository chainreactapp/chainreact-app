import { createClient } from "@/utils/supabase/server";
import { getServiceRoleClient } from "./supabase/serviceRoleClient";

/**
 * Repository for trigger_resources.
 *
 * Per docs/rules/database-security.md + workflow-lifecycle.md:
 *   - User-scoped writes (insert / delete) go through the SSR auth client
 *     so RLS gates per-user access.
 *   - Dispatcher lookups happen on inbound webhooks with no user session;
 *     they go through the service-role client (RLS bypass) and filter on
 *     the canonical (provider, eventType) index.
 */

export interface TriggerResourceRecord {
  id: string;
  workflowId: string;
  userId: string;
  provider: string;
  eventType: string;
  nodeId: string;
  config: Readonly<Record<string, unknown>>;
  accountId: string | null;
  registeredAt: string;
  expiresAt: string | null;
  lastRenewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TriggerResourcesRow {
  id: string;
  workflow_id: string;
  user_id: string;
  provider: string;
  event_type: string;
  node_id: string;
  config: Record<string, unknown>;
  account_id: string | null;
  registered_at: string;
  expires_at: string | null;
  last_renewed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: TriggerResourcesRow): TriggerResourceRecord {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    userId: row.user_id,
    provider: row.provider,
    eventType: row.event_type,
    nodeId: row.node_id,
    config: row.config,
    accountId: row.account_id,
    registeredAt: row.registered_at,
    expiresAt: row.expires_at,
    lastRenewedAt: row.last_renewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpsertTriggerResourceInput {
  workflowId: string;
  userId: string;
  provider: string;
  eventType: string;
  nodeId: string;
  config?: Record<string, unknown>;
  accountId?: string | null;
  expiresAt?: string | null;
}

/**
 * Insert or update a trigger registration. The unique index on
 * (workflow_id, node_id) means a re-register for the same trigger node
 * updates in place — useful when activate runs twice (e.g. retry after a
 * failed orchestrator persist).
 */
export async function upsert(
  input: UpsertTriggerResourceInput,
): Promise<TriggerResourceRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trigger_resources")
    .upsert(
      {
        workflow_id: input.workflowId,
        user_id: input.userId,
        provider: input.provider,
        event_type: input.eventType,
        node_id: input.nodeId,
        config: input.config ?? {},
        account_id: input.accountId ?? null,
        expires_at: input.expiresAt ?? null,
        last_renewed_at: null,
      },
      { onConflict: "workflow_id,node_id" },
    )
    .select()
    .single<TriggerResourcesRow>();
  if (error || !data) {
    throw new Error(
      `trigger_resources.upsert failed: ${error?.message ?? "no row returned"}`,
    );
  }
  return rowToRecord(data);
}

export async function deleteByWorkflow(workflowId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("trigger_resources")
    .delete()
    .eq("workflow_id", workflowId);
  if (error) {
    throw new Error(`trigger_resources.deleteByWorkflow failed: ${error.message}`);
  }
}

export async function listByWorkflow(
  workflowId: string,
): Promise<readonly TriggerResourceRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trigger_resources")
    .select("*")
    .eq("workflow_id", workflowId);
  if (error) {
    throw new Error(`trigger_resources.listByWorkflow failed: ${error.message}`);
  }
  return (data ?? []).map((r) => rowToRecord(r as TriggerResourcesRow));
}

/**
 * Dispatcher path: called from webhook receipt with no user session. Uses
 * the service-role client so RLS doesn't gate the lookup.
 */
export async function listForDispatch(
  provider: string,
  eventType: string,
): Promise<readonly TriggerResourceRecord[]> {
  const supabase = getServiceRoleClient(
    `webhook dispatcher: lookup trigger_resources for ${provider}/${eventType}`,
  );
  const { data, error } = await supabase
    .from("trigger_resources")
    .select("*")
    .eq("provider", provider)
    .eq("event_type", eventType);
  if (error) {
    throw new Error(`trigger_resources.listForDispatch failed: ${error.message}`);
  }
  return (data ?? []).map((r) => rowToRecord(r as TriggerResourcesRow));
}
