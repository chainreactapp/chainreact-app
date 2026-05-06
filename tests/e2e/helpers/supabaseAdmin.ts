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
