import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Sole construction point for the Supabase service-role client.
 *
 * Per docs/rules/database-security.md and project-structure-and-module-boundaries.md:
 *   - Service-role usage is server-side only.
 *   - Every call passes a `reason` string that's logged for audit.
 *   - The client is cached (singleton) so we don't churn connections.
 *   - Refuses to construct in the browser; protects against accidental client
 *     bundling even if an upstream import path slips past the lint guard.
 */

let cached: SupabaseClient | null = null;

export function getServiceRoleClient(reason: string): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "getServiceRoleClient: must not be invoked in the browser. Service-role client is server-only.",
    );
  }
  if (!reason || reason.trim().length === 0) {
    throw new Error("getServiceRoleClient: a non-empty `reason` is required for audit.");
  }
  console.info(`[supabase service-role] reason=${JSON.stringify(reason)}`);

  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Test-only helper: clears the cached client so tests can rebuild with new env. */
export function __resetServiceRoleClientForTesting() {
  cached = null;
}
