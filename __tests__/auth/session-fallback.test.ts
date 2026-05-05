/**
 * Contract: SessionManager.getSecureUserAndSession()
 * Source: lib/auth/session.ts
 *
 * Bug context: @supabase/ssr's auth.getSession() can deadlock on its internal
 * navigator lock when a concurrent refresh is in flight. Before this fix, a
 * timed-out getSession() threw out of getSecureUserAndSession() entirely,
 * making the existing refreshSession() fallback unreachable.
 *
 * These tests verify:
 *  - getSession success returns the cached session and never calls refreshSession
 *  - getSession timeout falls through to refreshSession (which uses a separate
 *    code path inside the supabase client and won't be wedged on the same lock)
 *  - getSession error (e.g. expired) also falls through to refreshSession
 *  - if refreshSession also fails, a clear "please log in" error is thrown
 */

// PR-AUTH-7: addressable warn mock so we can assert the structured event tag.
const loggerWarnMock = jest.fn()
jest.mock("@/lib/utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: (...args: any[]) => loggerWarnMock(...args),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

const getSessionMock = jest.fn()
const refreshSessionMock = jest.fn()

jest.mock("@/utils/supabaseClient", () => ({
  createClient: () => ({
    auth: {
      getSession: getSessionMock,
      refreshSession: refreshSessionMock,
    },
  }),
}))

import { SessionManager } from "@/lib/auth/session"

const VALID_SESSION = {
  access_token: "at-cached",
  refresh_token: "rt-cached",
  user: { id: "u1", email: "u1@example.com" },
}

const REFRESHED_SESSION = {
  access_token: "at-refreshed",
  refresh_token: "rt-refreshed",
  user: { id: "u1", email: "u1@example.com" },
}

beforeEach(() => {
  getSessionMock.mockReset()
  refreshSessionMock.mockReset()
  loggerWarnMock.mockReset()
})

describe("SessionManager.getSecureUserAndSession — getSession success path", () => {
  it("returns the cached session and never calls refreshSession", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: VALID_SESSION },
      error: null,
    })

    const result = await SessionManager.getSecureUserAndSession()

    expect(result.session).toEqual(VALID_SESSION)
    expect(result.user).toEqual(VALID_SESSION.user)
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(refreshSessionMock).not.toHaveBeenCalled()
  })
})

describe("SessionManager.getSecureUserAndSession — getSession timeout path", () => {
  it("falls through to refreshSession when getSession hangs past the timeout", async () => {
    // getSession hangs forever (simulates the navigator-lock deadlock)
    getSessionMock.mockImplementation(() => new Promise(() => {}))

    refreshSessionMock.mockResolvedValue({
      data: { session: REFRESHED_SESSION },
      error: null,
    })

    const result = await SessionManager.getSecureUserAndSession()

    expect(result.session).toEqual(REFRESHED_SESSION)
    expect(result.user).toEqual(REFRESHED_SESSION.user)
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
  }, 10000)

  it("throws a clear auth error when both getSession times out and refreshSession fails", async () => {
    getSessionMock.mockImplementation(() => new Promise(() => {}))

    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: "refresh_token_not_found" },
    })

    await expect(SessionManager.getSecureUserAndSession()).rejects.toThrow(
      /No authenticated user found/i
    )
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
  }, 10000)
})

describe("SessionManager.getSecureUserAndSession — getSession error / incomplete path", () => {
  it("falls through to refreshSession when getSession returns no session", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    })

    refreshSessionMock.mockResolvedValue({
      data: { session: REFRESHED_SESSION },
      error: null,
    })

    const result = await SessionManager.getSecureUserAndSession()

    expect(result.session).toEqual(REFRESHED_SESSION)
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
  })

  it("falls through to refreshSession when getSession returns a session without access_token", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "u1" }, access_token: null } },
      error: null,
    })

    refreshSessionMock.mockResolvedValue({
      data: { session: REFRESHED_SESSION },
      error: null,
    })

    const result = await SessionManager.getSecureUserAndSession()

    expect(result.session).toEqual(REFRESHED_SESSION)
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
  })

  it("falls through to refreshSession when getSession returns an error object", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: "session check failed" },
    })

    refreshSessionMock.mockResolvedValue({
      data: { session: REFRESHED_SESSION },
      error: null,
    })

    const result = await SessionManager.getSecureUserAndSession()

    expect(result.session).toEqual(REFRESHED_SESSION)
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
  })
})

// PR-AUTH-7 — instrumentation: the timeout-fallback path must emit a
// structured event tag so dashboards can scrape it distinctly.
describe("PR-AUTH-7 instrumentation — getSession_timeout_fallback tag", () => {
  it("logs a warn with event='auth.getSession_timeout_fallback' on timeout", async () => {
    getSessionMock.mockImplementation(() => new Promise(() => {}))
    refreshSessionMock.mockResolvedValue({
      data: { session: REFRESHED_SESSION },
      error: null,
    })

    await SessionManager.getSecureUserAndSession()

    const tagged = loggerWarnMock.mock.calls.find(
      (call) => (call[1] as { event?: string })?.event === "auth.getSession_timeout_fallback",
    )
    expect(tagged).toBeDefined()
    expect(tagged![1]).toEqual(
      expect.objectContaining({
        event: "auth.getSession_timeout_fallback",
        timeoutMs: 3000,
      }),
    )
  }, 10000)

  it("does not emit the timeout-fallback tag when getSession succeeds", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: VALID_SESSION },
      error: null,
    })

    await SessionManager.getSecureUserAndSession()

    const tagged = loggerWarnMock.mock.calls.find(
      (call) => (call[1] as { event?: string })?.event === "auth.getSession_timeout_fallback",
    )
    expect(tagged).toBeUndefined()
  })
})
