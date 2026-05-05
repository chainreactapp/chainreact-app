/**
 * PR-AUTH-3 — single client-side helper for Authorization headers.
 *
 * The hot path reads from the Zustand cache populated by PR-AUTH-2 — no
 * supabase.auth.getSession() / getUser() / navigator-lock contention.
 * When the cache is cold or expiring, a single intra-tab in-flight refresh
 * is used so concurrent callers share one round-trip instead of stampeding.
 *
 * This helper is the **only** way client code should obtain an
 * Authorization header for API requests. The boot pipeline / auth boot
 * machine + onAuthStateChange listener keep the cache populated; everything
 * else reads via getAuthHeader().
 */

import { useAuthStore } from "@/stores/authStore"
import { extractSessionTokens } from "@/stores/authBootMachine"
import { SessionManager } from "@/lib/auth/session"
import { logger } from "@/lib/utils/logger"

// 60-second safety margin: a token within 60s of expiring is treated as
// stale and triggers a refresh. Smaller windows risk shipping a request
// with an about-to-expire JWT; larger windows cause more refresh churn.
const FRESHNESS_MARGIN_SECONDS = 60

export interface CachedAccessToken {
  token: string | null
  expiresAt: number | null // epoch seconds, or null if not known
}

export interface GetAuthHeaderOptions {
  /**
   * - "auto" (default): cache hit → return synchronously; cache miss/stale →
   *   single-flight refresh, then return.
   * - "cache-only": cache hit → return synchronously; cache miss/stale →
   *   return {} immediately. Use for fire-and-forget telemetry, debug
   *   panels, or any path that must NOT block on a refresh.
   * - "force-refresh": always clear the cached token and refresh (still
   *   single-flight per wave). Use after receiving a 401 response when
   *   the cached token may be stale ahead of its expiry (revoked, signed
   *   out elsewhere, server-side key rotation).
   */
  mode?: "auto" | "cache-only" | "force-refresh"
}

/**
 * Read the current cached access token + expiry directly from the auth
 * store. Synchronous, never touches supabase. Used internally by
 * getAuthHeader and exposed for callers that need finer-grained access
 * (e.g. WebSocket connect strings that need the bare token, not a
 * header object).
 */
export function getCachedAccessToken(): CachedAccessToken {
  const { accessToken, accessTokenExpiresAt } = useAuthStore.getState()
  return { token: accessToken, expiresAt: accessTokenExpiresAt }
}

function isTokenFresh(cached: CachedAccessToken, nowSeconds: number): boolean {
  if (!cached.token) return false
  if (cached.expiresAt == null) {
    // No expiry data → treat as stale so we refresh once and learn the real
    // expiry. (TOKEN_REFRESHED / refreshSession() will populate expiresAt.)
    return false
  }
  return cached.expiresAt - nowSeconds > FRESHNESS_MARGIN_SECONDS
}

// Intra-tab single-flight. Multiple concurrent callers awaiting a refresh
// share the same Promise so we hit supabase.auth.refreshSession() at most
// once per "wave" of stale cache reads. Cross-tab serialization is a
// supabase-client concern (its navigator-lock); we don't replicate it.
let inflightRefresh: Promise<void> | null = null

// PR-AUTH-7 instrumentation: structured event tags for observability.
// These ride on logger.debug (off in prod by default) for hot paths and
// logger.warn for failure paths. When a metrics sink is wired up in the
// future, scrape on the `event:` tag.
function emitAuthEvent(
  event:
    | "auth.cache_hit"
    | "auth.cache_miss_refreshed"
    | "auth.cache_miss_failed"
    | "auth.cache_only_miss"
    | "auth.single_flight_dedup"
    | "auth.refresh_failure",
  extra?: Record<string, unknown>,
) {
  if (event === "auth.refresh_failure") {
    logger.warn("[auth] refresh_failure", { event, ...extra })
    return
  }
  logger.debug(`[auth] ${event}`, { event, ...extra })
}

// Read a millisecond-precision timestamp. Falls back to Date.now() if
// performance is missing (older test envs / SSR — though this code only
// runs client-side in normal use).
function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now()
}

// Latency of the most-recently-completed refresh round-trip, surfaced so
// getAuthHeader() can tag cache_miss_refreshed / cache_miss_failed events
// with durationMs. Reset to null after each emission.
let lastRefreshDurationMs: number | null = null

async function ensureFreshToken(): Promise<void> {
  if (inflightRefresh) {
    emitAuthEvent("auth.single_flight_dedup")
    await inflightRefresh
    return
  }

  // Measure refresh latency so future tuning of the refresh-timeout window
  // can be data-driven instead of guessed. The duration covers the full
  // SessionManager.getSecureUserAndSession path (getSession race +
  // refreshSession fallback).
  const refreshStartMs = nowMs()

  inflightRefresh = (async () => {
    try {
      const { session } = await SessionManager.getSecureUserAndSession()
      // Mirror the refreshed session into the cache. The TOKEN_REFRESHED
      // listener also writes here (when refreshSession() fires it), but
      // SessionManager's getSession() success path doesn't trigger any
      // event, so we mirror unconditionally — it's a setState, idempotent.
      useAuthStore.setState(extractSessionTokens(session))
    } catch (error: any) {
      // SessionManager throws when both getSession AND refreshSession fail.
      // Don't propagate — getAuthHeader() must never throw. Clear the cache
      // so subsequent callers see "no token" and return {}.
      emitAuthEvent("auth.refresh_failure", {
        error: error?.message,
        durationMs: Math.round(nowMs() - refreshStartMs),
      })
      useAuthStore.setState(extractSessionTokens(null))
    }
  })()

  try {
    await inflightRefresh
    lastRefreshDurationMs = Math.round(nowMs() - refreshStartMs)
  } finally {
    inflightRefresh = null
  }
}

function buildHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

/**
 * Return an `Authorization: Bearer <token>` header for client-side API
 * requests. Reads the cached token first; refreshes only when the cache
 * is cold or within 60s of expiry.
 *
 * **Never throws.** A failed refresh resolves to `{}` so the caller's
 * fetch() proceeds and gets a normal 401, which higher layers
 * (apiClient retry, error handling) already know how to handle.
 *
 * @example
 * const headers = await getAuthHeader()
 * await fetch("/api/foo", { headers })
 *
 * @example fire-and-forget telemetry that must not block on auth refresh
 * const headers = await getAuthHeader({ mode: "cache-only" })
 * void fetch("/api/telemetry", { headers, keepalive: true })
 */
export async function getAuthHeader(
  opts: GetAuthHeaderOptions = {},
): Promise<Record<string, string>> {
  const mode = opts.mode ?? "auto"
  const nowSeconds = Math.floor(Date.now() / 1000)

  // force-refresh skips the cache entirely. Clear it first so that callers
  // joining the same in-flight refresh (single-flight) can't read a stale
  // token, and so that a refresh that fails leaves the cache truthfully
  // empty for the next caller.
  if (mode === "force-refresh") {
    useAuthStore.setState(extractSessionTokens(null))
  } else {
    const cached = getCachedAccessToken()
    if (isTokenFresh(cached, nowSeconds)) {
      emitAuthEvent("auth.cache_hit", { mode })
      return buildHeader(cached.token!)
    }

    if (mode === "cache-only") {
      emitAuthEvent("auth.cache_only_miss")
      return {}
    }
  }

  await ensureFreshToken()

  // Pull and reset the refresh-latency side channel populated by
  // ensureFreshToken() so each getAuthHeader call attributes the timing
  // to its own emission.
  const durationMs = lastRefreshDurationMs
  lastRefreshDurationMs = null

  const refreshed = getCachedAccessToken()
  if (refreshed.token) {
    emitAuthEvent("auth.cache_miss_refreshed", durationMs != null ? { durationMs } : undefined)
    return buildHeader(refreshed.token)
  }

  emitAuthEvent("auth.cache_miss_failed", durationMs != null ? { durationMs } : undefined)
  return {}
}

// Test-only: reset the in-flight singleton + latency side channel between
// tests. Not exported from the barrel.
export function __resetAuthHeaderForTests() {
  inflightRefresh = null
  lastRefreshDurationMs = null
}
