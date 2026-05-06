import { createClient } from "@/utils/supabase/server";
import { getServiceRoleClient } from "./supabase/serviceRoleClient";

/**
 * Repository for user_billing.
 *
 * deductTasks → service-role RPC. The gate runs server-side without a user
 *   session (the engine fires from the webhook dispatcher in background),
 *   and the deduction must be atomic per row, so the helper goes through
 *   deduct_tasks_if_available rather than read-modify-write.
 *
 * getUsage → SSR-cookie client. RLS gates by auth.uid() = user_id, so a
 *   call with another user's id returns null. Used by future UI surfaces.
 */

export type DeductTasksResult =
  | { ok: true; used: number; limit: number }
  | { ok: false; used: number; limit: number };

interface DeductRpcResponse {
  ok: boolean;
  used: number;
  limit: number;
}

export async function deductTasks(
  userId: string,
  amount: number,
): Promise<DeductTasksResult> {
  const supabase = getServiceRoleClient(
    `billing gate: deductTasks ${amount} for user ${userId}`,
  );
  const { data, error } = await supabase.rpc("deduct_tasks_if_available", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (error) {
    throw new Error(`deduct_tasks_if_available RPC failed: ${error.message}`);
  }
  const response = data as DeductRpcResponse;
  return response.ok
    ? { ok: true, used: response.used, limit: response.limit }
    : { ok: false, used: response.used, limit: response.limit };
}

export interface UserBillingUsage {
  tasksUsed: number;
  tasksLimit: number;
  periodStartedAt: string;
}

interface UserBillingRow {
  tasks_used: number;
  tasks_limit: number;
  period_started_at: string;
}

export async function getUsage(userId: string): Promise<UserBillingUsage | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_billing")
    .select("tasks_used, tasks_limit, period_started_at")
    .eq("user_id", userId)
    .maybeSingle<UserBillingRow>();
  if (error) {
    throw new Error(`user_billing.getUsage failed: ${error.message}`);
  }
  if (!data) return null;
  return {
    tasksUsed: data.tasks_used,
    tasksLimit: data.tasks_limit,
    periodStartedAt: data.period_started_at,
  };
}
