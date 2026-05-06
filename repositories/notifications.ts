import { createClient } from "@/utils/supabase/server";
import { getServiceRoleClient } from "./supabase/serviceRoleClient";

/**
 * Repository for notifications.
 *
 * Engine path (create) writes via service-role — notifications are inserted
 * from background workflow execution, with no user session.
 *
 * UI path (listForUser, countUnreadForUser, markRead) uses the SSR-cookie
 * client so RLS gates by auth.uid() = user_id.
 */

export type NotificationType = "workflow_failed";
export type NotificationSeverity = "warning" | "error";

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  actionUrl: string | null;
  metadata: Readonly<Record<string, unknown>>;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsRow {
  id: string;
  user_id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  action_url: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

function rowToRecord(row: NotificationsRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    actionUrl: row.action_url,
    metadata: row.metadata,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export async function create(input: CreateNotificationInput): Promise<NotificationRecord> {
  const supabase = getServiceRoleClient(
    `engine: notification create (${input.type}) for user ${input.userId}`,
  );
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: input.userId,
      type: input.type,
      severity: input.severity,
      title: input.title,
      body: input.body,
      action_url: input.actionUrl ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single<NotificationsRow>();
  if (error || !data) {
    throw new Error(`notifications.create failed: ${error?.message ?? "no row returned"}`);
  }
  return rowToRecord(data);
}

export interface ListOptions {
  /** Default 50, capped at 200. */
  limit?: number;
  /** When true, only return rows where read_at IS NULL. */
  unreadOnly?: boolean;
}

export async function listForUser(
  userId: string,
  opts: ListOptions = {},
): Promise<readonly NotificationRecord[]> {
  const supabase = await createClient();
  const limit = Math.min(opts.limit ?? 50, 200);
  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts.unreadOnly) query = query.is("read_at", null);
  const { data, error } = await query;
  if (error) throw new Error(`notifications.listForUser failed: ${error.message}`);
  return (data ?? []).map((r) => rowToRecord(r as NotificationsRow));
}

export async function countUnreadForUser(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw new Error(`notifications.countUnreadForUser failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Mark a single notification read for the calling user. RLS gates the UPDATE
 * — a request with user A's session cannot touch user B's row even with the
 * right id. Returns the updated record (or null if RLS blocked / id missing).
 */
export async function markRead(notificationId: string): Promise<NotificationRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .select()
    .maybeSingle<NotificationsRow>();
  if (error) throw new Error(`notifications.markRead failed: ${error.message}`);
  return data ? rowToRecord(data) : null;
}

/**
 * Mark all notifications read for an explicitly-supplied userId. The RLS
 * predicate also enforces auth.uid() = user_id; this overload is for code
 * paths that already know the userId from another source (cron, admin).
 */
export async function markAllReadForUser(userId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");
  if (error) throw new Error(`notifications.markAllReadForUser failed: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * Mark all unread notifications for the *calling user* read — no explicit
 * userId required because RLS auto-scopes to `auth.uid() = user_id`.
 *
 * Used by the /notifications server action (`markAllNotificationsRead`).
 * Anonymous callers see auth.uid() = NULL → zero rows match → 0 returned.
 */
export async function markAllReadForCallingUser(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null)
    .select("id");
  if (error) throw new Error(`notifications.markAllReadForCallingUser failed: ${error.message}`);
  return data?.length ?? 0;
}
