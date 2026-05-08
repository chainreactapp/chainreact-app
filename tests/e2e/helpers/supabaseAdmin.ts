import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase admin client for e2e test setup + cleanup.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY directly (the test runner is server-side
 * and has access to the secret). NOT routed through
 * repositories/supabase/serviceRoleClient.ts because that's wired for app
 * server-side use, not test runners.
 *
 * Tests use this to:
 *   - Create a fresh user with email_confirm: true (bypasses the
 *     confirmation step that interactive sign-up would require).
 *   - Delete the user at teardown so cascades clean every related row
 *     (user_profiles, integrations, workflows, workflow_runs,
 *     notifications, oauth_states, trigger_resources).
 *   - Read DB state for assertions (integration row shape, oauth_states
 *     consumption, run status, notification count).
 */

let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("e2e: NEXT_PUBLIC_SUPABASE_URL not set.");
  if (!key) throw new Error("e2e: SUPABASE_SERVICE_ROLE_KEY not set.");
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export async function createTestUser(): Promise<TestUser> {
  const id = crypto.randomUUID();
  const email = `e2e-${id}@chainreact.test`;
  const password = `e2e-${id}-pw!`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true, // bypass email-confirmation flow in tests
  });
  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message ?? "no user"}`);
  }
  return { id: data.user.id, email, password };
}

export async function deleteTestUser(userId: string): Promise<void> {
  const { error } = await adminClient().auth.admin.deleteUser(userId);
  if (error) {
    // Don't throw — teardown is best-effort. Log so the test runner shows it.
    console.warn(`[e2e cleanup] deleteTestUser ${userId} failed: ${error.message}`);
  }
}

export async function getIntegrationsForUser(
  userId: string,
  provider: string,
): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await adminClient()
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw new Error(`getIntegrationsForUser: ${error.message}`);
  return data ?? [];
}

export async function getOAuthStateRowCount(): Promise<number> {
  const { count, error } = await adminClient()
    .from("oauth_states")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`getOAuthStateRowCount: ${error.message}`);
  return count ?? 0;
}

export async function getWorkflowRunsForUser(
  userId: string,
): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await adminClient()
    .from("workflow_runs")
    .select("*")
    .eq("user_id", userId);
  if (error) throw new Error(`getWorkflowRunsForUser: ${error.message}`);
  return data ?? [];
}

export async function getNotificationsForUser(
  userId: string,
): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await adminClient()
    .from("notifications")
    .select("*")
    .eq("user_id", userId);
  if (error) throw new Error(`getNotificationsForUser: ${error.message}`);
  return data ?? [];
}

/**
 * Slice 2f: read trigger_resources rows for the test user. Used to
 * assert the activation hook populated `config.snapshot.historyId` and
 * that the polling cycle advanced the cursor + bumped lastPolledAt.
 */
export async function getTriggerResourcesForUser(
  userId: string,
): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await adminClient()
    .from("trigger_resources")
    .select("*")
    .eq("user_id", userId);
  if (error) throw new Error(`getTriggerResourcesForUser: ${error.message}`);
  return data ?? [];
}

/**
 * Slice 2f: read a single webhook_event_dedup row by (provider, event_id).
 * Used to assert dedup actually wrote on the first poll AND that the
 * row is what blocks the duplicate run on the second poll. Returns null
 * when no row matches. System table — service-role only.
 */
export async function getDedupRow(
  provider: string,
  eventId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await adminClient()
    .from("webhook_event_dedup")
    .select("*")
    .eq("provider", provider)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw new Error(`getDedupRow: ${error.message}`);
  return data ?? null;
}

/**
 * Slice 2f: rewind a trigger_resources row's `config.polling.lastPolledAt`
 * to a long-past timestamp so the polling scheduler's interval gate
 * (5-minute default in Slice 2e) doesn't skip the next cron tick.
 *
 * Used by the dedup probe — between polls we need to simulate "enough
 * time has passed to poll again" without sleeping for 5 minutes. The
 * scheduler reads `config.polling.lastPolledAt` directly, so we just
 * write a value far enough in the past.
 *
 * Service-role: writes a single known row id; the test runner has
 * already authenticated the user, but the polling cron code path uses
 * service-role too.
 */
export async function rewindTriggerPollingTimestamp(
  triggerResourceId: string,
): Promise<void> {
  const long_ago = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // Read current config so we update only the polling slice without
  // accidentally clearing snapshot / other keys.
  const { data, error: readErr } = await adminClient()
    .from("trigger_resources")
    .select("config")
    .eq("id", triggerResourceId)
    .single();
  if (readErr) throw new Error(`rewindTriggerPollingTimestamp read: ${readErr.message}`);
  const config = (data.config ?? {}) as Record<string, unknown>;
  const polling = (config.polling ?? {}) as Record<string, unknown>;
  const newConfig = {
    ...config,
    polling: { ...polling, lastPolledAt: long_ago },
  };
  const { error } = await adminClient()
    .from("trigger_resources")
    .update({ config: newConfig })
    .eq("id", triggerResourceId);
  if (error) throw new Error(`rewindTriggerPollingTimestamp write: ${error.message}`);
}

/**
 * Poll until the predicate returns truthy or timeout. The execution engine
 * runs in a fire-and-forget Promise after the webhook returns 200, so the
 * test must wait for the workflow_runs row to appear.
 */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  opts: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<T> {
  const timeout = opts.timeoutMs ?? 10_000;
  const interval = opts.intervalMs ?? 250;
  const start = Date.now();
  let last: unknown = null;
  while (Date.now() - start < timeout) {
    const result = await fn();
    if (result) return result;
    last = result;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `waitFor timed out after ${timeout}ms${
      opts.description ? ` (${opts.description})` : ""
    }; last value: ${JSON.stringify(last)}`,
  );
}
