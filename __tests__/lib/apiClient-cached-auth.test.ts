/**
 * @jest-environment jsdom
 *
 * Contract: PR-AUTH-4 — lib/apiClient.ts uses getAuthHeader() (cached token path)
 *
 * Source: lib/apiClient.ts
 *
 * This is the highest-traffic call site for auth headers — every API request
 * the app makes flows through here. Pre-PR-AUTH-4 it called
 * supabase.auth.getUser() + getSession() per request, fighting the navigator
 * lock with every other auth-bound caller. Post-PR it reads from the
 * Zustand cache via getAuthHeader().
 *
 * The critical regression guard: a hung supabase.auth.getSession() (the
 * original "Create Workflow silent click" failure mode) MUST NOT block
 * apiClient requests when the cached token is fresh. This test proves that
 * stays dead.
 */

const fetchMock = jest.fn()
;(globalThis as any).fetch = fetchMock

// supabase mocks. getSession is the regression guard — when it hangs, the
// cached path must still serve requests.
const getSessionMock = jest.fn()
const getUserMock = jest.fn()
const refreshSessionMock = jest.fn()

jest.mock("@/utils/supabaseClient", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
      getSession: (...args: any[]) => getSessionMock(...args),
      getUser: (...args: any[]) => getUserMock(...args),
      refreshSession: (...args: any[]) => refreshSessionMock(...args),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
  },
  createClient: () => ({
    auth: {
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getSession: (...args: any[]) => getSessionMock(...args),
      getUser: (...args: any[]) => getUserMock(...args),
      refreshSession: (...args: any[]) => refreshSessionMock(...args),
    },
  }),
}))

jest.mock("@/lib/utils/cross-tab-sync", () => ({
  getCrossTabSync: () => ({ broadcast: jest.fn(), subscribe: jest.fn() }),
}))

jest.mock("@/lib/utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// Same boot-pipeline noop pattern as PR-AUTH-2/3 — onRehydrateStorage fires
// state.boot() at module load and would otherwise race.
jest.mock("../../stores/authBootMachine", () => {
  const actual = jest.requireActual("../../stores/authBootMachine")
  return {
    ...actual,
    boot: jest.fn().mockResolvedValue(undefined),
  }
})

import { useAuthStore } from "../../stores/authStore"
import { BOOT_INITIAL_STATE } from "../../stores/authBootMachine"
import { __resetAuthHeaderForTests } from "../../lib/auth/getAuthHeader"
import apiClient from "../../lib/apiClient"

const NOW_SECONDS = 1_700_000_000

function mockJsonResponse(body: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers: new Map() as any,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as any
}

beforeEach(() => {
  fetchMock.mockReset()
  getSessionMock.mockReset()
  getUserMock.mockReset()
  refreshSessionMock.mockReset()
  __resetAuthHeaderForTests()

  useAuthStore.setState({
    ...BOOT_INITIAL_STATE,
    phase: "ready" as any,
  })

  jest.spyOn(Date, "now").mockReturnValue(NOW_SECONDS * 1000)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("apiClient with a fresh cached token", () => {
  it("uses the cached token without calling supabase.auth.getSession or getUser", async () => {
    useAuthStore.setState({
      accessToken: "at-cached",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })
    fetchMock.mockResolvedValue(mockJsonResponse({ data: { ok: true } }))

    const res = await apiClient.get("/api/foo")

    expect(res.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.Authorization).toBe("Bearer at-cached")

    // Critical: the supabase auth subsystem was NEVER touched on the hot path.
    expect(getSessionMock).not.toHaveBeenCalled()
    expect(getUserMock).not.toHaveBeenCalled()
    expect(refreshSessionMock).not.toHaveBeenCalled()
  })

  it("forwards Content-Type and credentials: include", async () => {
    useAuthStore.setState({
      accessToken: "at-cached",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })
    fetchMock.mockResolvedValue(mockJsonResponse({ data: {} }))

    await apiClient.post("/api/foo", { hello: "world" })

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers["Content-Type"]).toBe("application/json")
    expect(options.credentials).toBe("include")
    expect(options.body).toBe(JSON.stringify({ hello: "world" }))
  })
})

describe("REGRESSION GUARD — hung supabase.auth.getSession does not block apiClient", () => {
  it("completes the request via the cached token even when getSession hangs forever", async () => {
    // Simulate the original "Create Workflow silent click" condition: the
    // navigator lock is wedged, getSession never resolves.
    getSessionMock.mockImplementation(() => new Promise(() => {}))
    getUserMock.mockImplementation(() => new Promise(() => {}))

    useAuthStore.setState({
      accessToken: "at-cached-rescue",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })
    fetchMock.mockResolvedValue(mockJsonResponse({ data: { ok: true } }))

    // Cap the test at 200ms — pre-PR-AUTH-4 this would hang forever (the
    // 8s timeout in SessionManager would eventually fire, but apiClient
    // would still wait on it). Post-PR-AUTH-4 it returns near-instantly.
    const result = await Promise.race([
      apiClient.get("/api/foo"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("apiClient blocked on hung getSession")), 200)),
    ])

    expect((result as any).success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, options] = (fetchMock.mock.calls[0] as any[])
    expect(options.headers.Authorization).toBe("Bearer at-cached-rescue")
  })
})

describe("apiClient with no cached token", () => {
  it("triggers a refresh via SessionManager and uses the refreshed token", async () => {
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    // SessionManager.getSecureUserAndSession resolves via getSession success.
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: "at-just-refreshed",
          expires_at: NOW_SECONDS + 3600,
          user: { id: "u1", email: "u1@example.com" },
        },
      },
      error: null,
    })
    fetchMock.mockResolvedValue(mockJsonResponse({ data: { ok: true } }))

    const res = await apiClient.get("/api/foo")

    expect(res.success).toBe(true)
    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.Authorization).toBe("Bearer at-just-refreshed")
  })

  it("proceeds without an Authorization header when refresh fails (now: fires once, gets 401, retries once with force-refresh, second 401 surfaces)", async () => {
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    // Both paths inside SessionManager fail.
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: "no session" },
    })
    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: "refresh_token_not_found" },
    })

    fetchMock.mockResolvedValue(mockJsonResponse({ error: "unauthenticated" }, 401))

    const res = await apiClient.get("/api/foo")

    // PR-AUTH-FOLLOWUP-2: 401 now triggers one force-refresh retry. Both
    // attempts have no Authorization header (refresh keeps failing), and
    // the final 401 surfaces to the caller without throwing.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as any).headers.Authorization).toBeUndefined()
    }
    expect(res.success).toBe(false)
  })
})

describe("concurrent apiClient requests share one refresh", () => {
  it("makes 10 requests but only one refresh round-trip", async () => {
    useAuthStore.setState({ accessToken: null, accessTokenExpiresAt: null })

    let resolveSession!: (v: any) => void
    const sessionPromise = new Promise<any>((resolve) => { resolveSession = resolve })
    getSessionMock.mockReturnValue(sessionPromise)
    fetchMock.mockResolvedValue(mockJsonResponse({ data: { ok: true } }))

    // Fire 10 concurrent requests. None resolve until session promise does.
    const requests = Array.from({ length: 10 }, () => apiClient.get(`/api/foo`))

    // Allow microtasks to register on the in-flight promise.
    await Promise.resolve()
    await Promise.resolve()

    expect(getSessionMock).toHaveBeenCalledTimes(1)

    resolveSession({
      data: {
        session: {
          access_token: "at-shared-refresh",
          expires_at: NOW_SECONDS + 3600,
          user: { id: "u1" },
        },
      },
      error: null,
    })

    await Promise.all(requests)

    // All 10 fetch calls used the same refreshed token.
    expect(fetchMock).toHaveBeenCalledTimes(10)
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as any).headers.Authorization).toBe("Bearer at-shared-refresh")
    }
    // Still one refresh.
    expect(getSessionMock).toHaveBeenCalledTimes(1)
  })
})

// PR-AUTH-FOLLOWUP-2 — apiClient auto-recovers from 401 by force-refreshing
// the cached token and retrying once. Handles the case where the cached
// token is valid by expiry but revoked / rotated server-side.
describe("apiClient 401 retry-with-forced-refresh", () => {
  it("force-refreshes the auth token and retries once on 401, then returns the retry's success", async () => {
    // Cache starts fresh — first request uses cached token-A.
    useAuthStore.setState({
      accessToken: "at-stale",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })

    // Refresh succeeds with a new token.
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: "at-fresh-after-401",
          expires_at: NOW_SECONDS + 3600,
          user: { id: "u1" },
        },
      },
      error: null,
    })

    // First fetch returns 401, second returns 200 (the retry).
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(mockJsonResponse({ data: { ok: true } }, 200))

    const res = await apiClient.get("/api/foo")

    expect(res.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [, firstOptions] = fetchMock.mock.calls[0] as any[]
    const [, secondOptions] = fetchMock.mock.calls[1] as any[]
    expect(firstOptions.headers.Authorization).toBe("Bearer at-stale")
    expect(secondOptions.headers.Authorization).toBe("Bearer at-fresh-after-401")
    // Cache reflects the freshly-refreshed token after recovery.
    expect(useAuthStore.getState().accessToken).toBe("at-fresh-after-401")
  })

  it("does NOT retry a second time if the retry also returns 401 (no infinite loop)", async () => {
    useAuthStore.setState({
      accessToken: "at-stale",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })

    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: "at-still-revoked",
          expires_at: NOW_SECONDS + 3600,
          user: { id: "u1" },
        },
      },
      error: null,
    })

    // Both responses are 401.
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(mockJsonResponse({ error: "Unauthorized" }, 401))

    const res = await apiClient.get("/api/foo")

    expect(res.success).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2) // first + one retry, no third
  })

  it("does NOT retry on a 403 (only 401 triggers the force-refresh path)", async () => {
    useAuthStore.setState({
      accessToken: "at-cached",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })

    fetchMock.mockResolvedValueOnce(mockJsonResponse({ error: "Forbidden" }, 403))

    const res = await apiClient.get("/api/foo")

    expect(res.success).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Refresh was never attempted.
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it("returns the 401 response normally when the force-refresh itself fails", async () => {
    useAuthStore.setState({
      accessToken: "at-stale",
      accessTokenExpiresAt: NOW_SECONDS + 3600,
    })

    // Refresh fails — both getSession AND refreshSession fail inside SessionManager.
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: "no session" },
    })
    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: "refresh_token_not_found" },
    })

    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(mockJsonResponse({ error: "Unauthorized" }, 401))

    const res = await apiClient.get("/api/foo")

    // Retry fired with no auth header (refresh failed → cache cleared → {})
    // and got 401 again. Final response is the failure.
    expect(res.success).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, retryOptions] = fetchMock.mock.calls[1] as any[]
    expect(retryOptions.headers.Authorization).toBeUndefined()
  })
})
