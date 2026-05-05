/**
 * @jest-environment jsdom
 *
 * Contract: PR-AUTH-3 — getAuthHeader() single-flight cached-token helper.
 *
 * Source: lib/auth/getAuthHeader.ts
 *
 * The helper reads from the auth store's cache (PR-AUTH-2) on the hot path
 * and only touches SessionManager.getSecureUserAndSession() when the cache
 * is cold or expiring. Concurrent callers share one in-flight refresh.
 * The function NEVER throws — failures resolve to {} so callers' fetch
 * gets a normal 401.
 */

// SessionManager.getSecureUserAndSession is the only side effect we mock —
// everything else (cache reads, single-flight) is in-process logic we want
// to exercise for real.
const getSecureUserAndSessionMock = jest.fn()

jest.mock("@/lib/auth/session", () => ({
  SessionManager: {
    getSecureUserAndSession: (...args: any[]) => getSecureUserAndSessionMock(...args),
  },
}))

// Stub the supabase client. The auth store imports this at module load and
// registers the onAuthStateChange listener; we don't exercise the listener
// in these tests, just neutralize it.
jest.mock("@/utils/supabaseClient", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      refreshSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
  },
  createClient: () => ({
    auth: {
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  }),
}))

jest.mock("@/lib/utils/cross-tab-sync", () => ({
  getCrossTabSync: () => ({ broadcast: jest.fn(), subscribe: jest.fn() }),
}))

// Logger mock with addressable jest.fn() so tests can assert event shapes.
const loggerDebugMock = jest.fn()
const loggerWarnMock = jest.fn()
jest.mock("@/lib/utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: (...args: any[]) => loggerWarnMock(...args),
    error: jest.fn(),
    debug: (...args: any[]) => loggerDebugMock(...args),
  },
}))

// Same boot-pipeline noop pattern as PR-AUTH-2 — onRehydrateStorage fires
// state.boot() at module load and would otherwise race through the test
// run, overwriting cache state from the no-session branch.
jest.mock("../../stores/authBootMachine", () => {
  const actual = jest.requireActual("../../stores/authBootMachine")
  return {
    ...actual,
    boot: jest.fn().mockResolvedValue(undefined),
  }
})

import { useAuthStore } from "../../stores/authStore"
import { BOOT_INITIAL_STATE } from "../../stores/authBootMachine"
import {
  getAuthHeader,
  getCachedAccessToken,
  __resetAuthHeaderForTests,
} from "../../lib/auth/getAuthHeader"

const NOW_SECONDS = 1_700_000_000

beforeEach(() => {
  getSecureUserAndSessionMock.mockReset()
  loggerDebugMock.mockReset()
  loggerWarnMock.mockReset()
  __resetAuthHeaderForTests()

  useAuthStore.setState({
    ...BOOT_INITIAL_STATE,
    phase: "ready" as any,
  })

  jest.spyOn(Date, "now").mockReturnValue(NOW_SECONDS * 1000)
  localStorage.clear()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("getCachedAccessToken — synchronous reader", () => {
  it("returns nulls when the cache is empty", () => {
    expect(getCachedAccessToken()).toEqual({ token: null, expiresAt: null })
  })

  it("returns the cached values verbatim", () => {
    useAuthStore.setState({ accessToken: "at-1", accessTokenExpiresAt: NOW_SECONDS + 600 })
    expect(getCachedAccessToken()).toEqual({
      token: "at-1",
      expiresAt: NOW_SECONDS + 600,
    })
  })
})

describe("Test 1 — valid cached token returns Authorization header without refresh", () => {
  it("returns Bearer header synchronously and never calls refresh", async () => {
    useAuthStore.setState({
      accessToken: "at-fresh",
      accessTokenExpiresAt: NOW_SECONDS + 3600, // 1 hour out
    })

    const headers = await getAuthHeader()

    expect(headers).toEqual({ Authorization: "Bearer at-fresh" })
    expect(getSecureUserAndSessionMock).not.toHaveBeenCalled()
  })

  it("returns Bearer header when token expires in 61 seconds (just past margin)", async () => {
    useAuthStore.setState({
      accessToken: "at-edge",
      accessTokenExpiresAt: NOW_SECONDS + 61,
    })

    const headers = await getAuthHeader()

    expect(headers).toEqual({ Authorization: "Bearer at-edge" })
    expect(getSecureUserAndSessionMock).not.toHaveBeenCalled()
  })
})

describe("Test 2 — missing token triggers refresh once", () => {
  it("calls SessionManager.getSecureUserAndSession when accessToken is null", async () => {
    getSecureUserAndSessionMock.mockResolvedValue({
      user: { id: "u1" },
      session: { access_token: "at-refreshed", expires_at: NOW_SECONDS + 3600 },
    })

    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    const headers = await getAuthHeader()

    expect(getSecureUserAndSessionMock).toHaveBeenCalledTimes(1)
    expect(headers).toEqual({ Authorization: "Bearer at-refreshed" })
    // Cache was populated.
    expect(useAuthStore.getState().accessToken).toBe("at-refreshed")
  })

  it("treats null expiresAt as stale and refreshes (token alone isn't trusted without expiry)", async () => {
    getSecureUserAndSessionMock.mockResolvedValue({
      user: { id: "u1" },
      session: { access_token: "at-with-expiry", expires_at: NOW_SECONDS + 3600 },
    })

    useAuthStore.setState({ accessToken: "at-no-expiry", accessTokenExpiresAt: null })

    const headers = await getAuthHeader()

    expect(getSecureUserAndSessionMock).toHaveBeenCalledTimes(1)
    expect(headers).toEqual({ Authorization: "Bearer at-with-expiry" })
  })
})

describe("Test 3 — token expiring within 60 seconds triggers refresh", () => {
  it("refreshes when expiresAt - now is exactly 60 seconds (boundary, treated stale)", async () => {
    getSecureUserAndSessionMock.mockResolvedValue({
      user: { id: "u1" },
      session: { access_token: "at-after-refresh", expires_at: NOW_SECONDS + 3600 },
    })

    useAuthStore.setState({
      accessToken: "at-near-expiry",
      accessTokenExpiresAt: NOW_SECONDS + 60, // boundary — NOT > 60s
    })

    const headers = await getAuthHeader()

    expect(getSecureUserAndSessionMock).toHaveBeenCalledTimes(1)
    expect(headers).toEqual({ Authorization: "Bearer at-after-refresh" })
  })

  it("refreshes when expiresAt is in the past", async () => {
    getSecureUserAndSessionMock.mockResolvedValue({
      user: { id: "u1" },
      session: { access_token: "at-revived", expires_at: NOW_SECONDS + 3600 },
    })

    useAuthStore.setState({
      accessToken: "at-expired",
      accessTokenExpiresAt: NOW_SECONDS - 100,
    })

    const headers = await getAuthHeader()

    expect(getSecureUserAndSessionMock).toHaveBeenCalledTimes(1)
    expect(headers).toEqual({ Authorization: "Bearer at-revived" })
  })
})

describe("Test 4 — multiple concurrent callers share one refresh", () => {
  it("calls SessionManager.getSecureUserAndSession exactly once for 50 concurrent callers", async () => {
    let resolveRefresh!: (v: any) => void
    const refreshPromise = new Promise<any>((resolve) => { resolveRefresh = resolve })
    getSecureUserAndSessionMock.mockReturnValue(refreshPromise)

    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    // Fire 50 concurrent callers. None resolve until refreshPromise does.
    const callers = Array.from({ length: 50 }, () => getAuthHeader())

    // Allow microtasks to run so all callers register on the in-flight promise.
    await Promise.resolve()
    await Promise.resolve()

    expect(getSecureUserAndSessionMock).toHaveBeenCalledTimes(1)

    // Resolve the single in-flight refresh.
    resolveRefresh({
      user: { id: "u1" },
      session: { access_token: "at-shared", expires_at: NOW_SECONDS + 3600 },
    })

    const results = await Promise.all(callers)

    // All 50 got the same header.
    for (const headers of results) {
      expect(headers).toEqual({ Authorization: "Bearer at-shared" })
    }
    // Still exactly one refresh call.
    expect(getSecureUserAndSessionMock).toHaveBeenCalledTimes(1)
  })

  it("the next refresh after the in-flight one settles is a fresh call (single-flight is per-wave)", async () => {
    getSecureUserAndSessionMock.mockResolvedValue({
      user: { id: "u1" },
      session: { access_token: "at-1st", expires_at: NOW_SECONDS + 3600 },
    })

    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    await getAuthHeader() // wave 1
    expect(getSecureUserAndSessionMock).toHaveBeenCalledTimes(1)

    // Simulate cache going stale again later.
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })
    getSecureUserAndSessionMock.mockResolvedValue({
      user: { id: "u1" },
      session: { access_token: "at-2nd", expires_at: NOW_SECONDS + 3600 },
    })

    const headers = await getAuthHeader() // wave 2
    expect(getSecureUserAndSessionMock).toHaveBeenCalledTimes(2)
    expect(headers).toEqual({ Authorization: "Bearer at-2nd" })
  })
})

describe("Test 5 — refresh failure returns {} and does not throw", () => {
  it("returns {} when SessionManager throws", async () => {
    getSecureUserAndSessionMock.mockRejectedValue(new Error("No authenticated user found."))

    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    let result: Record<string, string> | undefined
    let threw = false
    try {
      result = await getAuthHeader()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(result).toEqual({})
  })

  it("clears the cache after a refresh failure so subsequent cache-only callers see {}", async () => {
    getSecureUserAndSessionMock.mockRejectedValue(new Error("refresh_token_not_found"))

    // Cache already had something stale before the failed refresh.
    useAuthStore.setState({
      accessToken: "at-stale",
      accessTokenExpiresAt: NOW_SECONDS - 100,
    })

    const result = await getAuthHeader()
    expect(result).toEqual({})

    // Cache should be cleared so reads after the failure don't lie.
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(useAuthStore.getState().accessTokenExpiresAt).toBeNull()
  })

  it("multiple concurrent callers all resolve to {} when refresh fails (no throw)", async () => {
    let rejectRefresh!: (e: any) => void
    const refreshPromise = new Promise<any>((_, reject) => { rejectRefresh = reject })
    getSecureUserAndSessionMock.mockReturnValue(refreshPromise)

    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    const callers = Array.from({ length: 10 }, () => getAuthHeader())
    await Promise.resolve()
    await Promise.resolve()

    rejectRefresh(new Error("network down"))

    const results = await Promise.all(callers)
    for (const headers of results) {
      expect(headers).toEqual({})
    }
  })
})

describe("Test 6 — cache-only mode returns cached header if available", () => {
  it("returns Bearer header for a fresh cached token without calling refresh", async () => {
    useAuthStore.setState({
      accessToken: "at-cached",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })

    const headers = await getAuthHeader({ mode: "cache-only" })

    expect(headers).toEqual({ Authorization: "Bearer at-cached" })
    expect(getSecureUserAndSessionMock).not.toHaveBeenCalled()
  })
})

describe("Test 7 — cache-only mode returns {} when stale/missing and does NOT refresh", () => {
  it("returns {} when token is missing", async () => {
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    const headers = await getAuthHeader({ mode: "cache-only" })

    expect(headers).toEqual({})
    expect(getSecureUserAndSessionMock).not.toHaveBeenCalled()
  })

  it("returns {} when token is expiring within 60 seconds", async () => {
    useAuthStore.setState({
      accessToken: "at-near-expiry",
      accessTokenExpiresAt: NOW_SECONDS + 30, // < 60s margin
    })

    const headers = await getAuthHeader({ mode: "cache-only" })

    expect(headers).toEqual({})
    expect(getSecureUserAndSessionMock).not.toHaveBeenCalled()
  })

  it("returns {} when expiresAt is null even if token is set", async () => {
    useAuthStore.setState({
      accessToken: "at-no-expiry",
      accessTokenExpiresAt: null,
    })

    const headers = await getAuthHeader({ mode: "cache-only" })

    expect(headers).toEqual({})
    expect(getSecureUserAndSessionMock).not.toHaveBeenCalled()
  })
})

// PR-AUTH-7 — instrumentation: every code path emits a structured event tag
// so a future metrics sink can compute cache hit rate, refresh storms, and
// failure frequency without parsing free-text log messages.

function findEvent(name: string): Record<string, unknown> | undefined {
  // logger.debug receives (msg, payload). The payload's `event` field is
  // what we assert against.
  for (const call of loggerDebugMock.mock.calls) {
    const payload = call[1] as { event?: string } | undefined
    if (payload?.event === name) return payload
  }
  for (const call of loggerWarnMock.mock.calls) {
    const payload = call[1] as { event?: string } | undefined
    if (payload?.event === name) return payload
  }
  return undefined
}

describe("PR-AUTH-7 instrumentation — structured event tags", () => {
  it("emits auth.cache_hit on a fresh-cache return (mode=auto)", async () => {
    useAuthStore.setState({
      accessToken: "at-fresh",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })

    await getAuthHeader()

    expect(findEvent("auth.cache_hit")).toEqual(
      expect.objectContaining({ event: "auth.cache_hit", mode: "auto" }),
    )
  })

  it("emits auth.cache_hit with mode='cache-only' when called in cache-only mode", async () => {
    useAuthStore.setState({
      accessToken: "at-fresh",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })

    await getAuthHeader({ mode: "cache-only" })

    expect(findEvent("auth.cache_hit")).toEqual(
      expect.objectContaining({ event: "auth.cache_hit", mode: "cache-only" }),
    )
  })

  it("emits auth.cache_only_miss when cache-only stale and does NOT emit miss/refresh events", async () => {
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    await getAuthHeader({ mode: "cache-only" })

    expect(findEvent("auth.cache_only_miss")).toBeDefined()
    expect(findEvent("auth.cache_miss_refreshed")).toBeUndefined()
    expect(findEvent("auth.cache_miss_failed")).toBeUndefined()
  })

  it("emits auth.cache_miss_refreshed when refresh succeeds", async () => {
    getSecureUserAndSessionMock.mockResolvedValue({
      user: { id: "u1" },
      session: { access_token: "at-new", expires_at: NOW_SECONDS + 3600 },
    })
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    await getAuthHeader()

    expect(findEvent("auth.cache_miss_refreshed")).toBeDefined()
    expect(findEvent("auth.cache_miss_failed")).toBeUndefined()
  })

  it("emits auth.cache_miss_failed AND auth.refresh_failure when refresh throws", async () => {
    getSecureUserAndSessionMock.mockRejectedValue(new Error("no auth"))
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    await getAuthHeader()

    // refresh_failure (warn-level) AND cache_miss_failed (debug-level) both fire.
    expect(findEvent("auth.refresh_failure")).toEqual(
      expect.objectContaining({ event: "auth.refresh_failure", error: "no auth" }),
    )
    expect(findEvent("auth.cache_miss_failed")).toBeDefined()
  })

  it("emits auth.single_flight_dedup once per concurrent caller that joined the in-flight refresh", async () => {
    let resolveRefresh!: (v: any) => void
    const refreshPromise = new Promise<any>((resolve) => { resolveRefresh = resolve })
    getSecureUserAndSessionMock.mockReturnValue(refreshPromise)
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    // 5 concurrent callers: first triggers the refresh, the other 4 dedup.
    const callers = Array.from({ length: 5 }, () => getAuthHeader())
    await Promise.resolve()
    await Promise.resolve()

    resolveRefresh({
      user: { id: "u1" },
      session: { access_token: "at-shared", expires_at: NOW_SECONDS + 3600 },
    })
    await Promise.all(callers)

    const dedupCount = loggerDebugMock.mock.calls.filter(
      (call) => (call[1] as { event?: string })?.event === "auth.single_flight_dedup",
    ).length
    // 4 callers deduped (the first one initiated the refresh, didn't dedup).
    expect(dedupCount).toBe(4)
  })

  it("auth.refresh_failure is logged at WARN level (not DEBUG)", async () => {
    getSecureUserAndSessionMock.mockRejectedValue(new Error("network down"))
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    await getAuthHeader()

    // refresh_failure must appear in logger.warn calls, NOT in logger.debug calls.
    const warnHasIt = loggerWarnMock.mock.calls.some(
      (call) => (call[1] as { event?: string })?.event === "auth.refresh_failure",
    )
    const debugHasIt = loggerDebugMock.mock.calls.some(
      (call) => (call[1] as { event?: string })?.event === "auth.refresh_failure",
    )
    expect(warnHasIt).toBe(true)
    expect(debugHasIt).toBe(false)
  })

  it("emits durationMs on cache_miss_refreshed and refresh_failure for latency observability", async () => {
    // Success path
    getSecureUserAndSessionMock.mockResolvedValue({
      user: { id: "u1" },
      session: { access_token: "at-new", expires_at: NOW_SECONDS + 3600 },
    })
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    await getAuthHeader()

    const successPayload = findEvent("auth.cache_miss_refreshed")
    expect(successPayload).toBeDefined()
    expect(typeof successPayload!.durationMs).toBe("number")
    expect(successPayload!.durationMs as number).toBeGreaterThanOrEqual(0)

    // Failure path
    loggerDebugMock.mockReset()
    loggerWarnMock.mockReset()
    getSecureUserAndSessionMock.mockRejectedValue(new Error("network down"))
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    await getAuthHeader()

    const failurePayload = findEvent("auth.refresh_failure")
    expect(failurePayload).toBeDefined()
    expect(typeof failurePayload!.durationMs).toBe("number")
    expect(failurePayload!.durationMs as number).toBeGreaterThanOrEqual(0)
  })
})

// PR-AUTH-FOLLOWUP-2 — `mode: "force-refresh"` skips the cache-hit path
// entirely and clears the cache before refreshing. Used by apiClient on
// 401 responses to recover from server-side token revocation.
describe("getAuthHeader mode='force-refresh'", () => {
  it("ignores a fresh cached token and triggers a refresh", async () => {
    useAuthStore.setState({
      accessToken: "at-cached-but-stale",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })

    getSecureUserAndSessionMock.mockResolvedValue({
      user: { id: "u1" },
      session: { access_token: "at-fresh", expires_at: NOW_SECONDS + 3600 },
    })

    const headers = await getAuthHeader({ mode: "force-refresh" })

    expect(headers).toEqual({ Authorization: "Bearer at-fresh" })
    expect(getSecureUserAndSessionMock).toHaveBeenCalledTimes(1)
  })

  it("clears the cache before refreshing so a refresh failure leaves the cache empty (not stale)", async () => {
    useAuthStore.setState({
      accessToken: "at-revoked",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })

    getSecureUserAndSessionMock.mockRejectedValue(new Error("refresh failed"))

    const headers = await getAuthHeader({ mode: "force-refresh" })

    expect(headers).toEqual({})
    // Critical: cache reflects reality (no token), not the stale revoked one.
    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it("does NOT emit auth.cache_hit when force-refreshing even with a fresh cached token", async () => {
    useAuthStore.setState({
      accessToken: "at-cached",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })

    getSecureUserAndSessionMock.mockResolvedValue({
      user: { id: "u1" },
      session: { access_token: "at-fresh", expires_at: NOW_SECONDS + 3600 },
    })

    await getAuthHeader({ mode: "force-refresh" })

    expect(findEvent("auth.cache_hit")).toBeUndefined()
    expect(findEvent("auth.cache_miss_refreshed")).toBeDefined()
  })
})
