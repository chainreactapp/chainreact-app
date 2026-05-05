/**
 * @jest-environment jsdom
 *
 * Contract: PR-AUTH-2 — accessToken / accessTokenExpiresAt cached in auth store
 *
 * Source: stores/authStore.ts, stores/authBootMachine.ts (extractSessionTokens)
 *
 * The auth store mirrors the supabase session's access_token + expires_at
 * into Zustand state so call sites can build an Authorization header
 * without going through auth.getSession() / the navigator lock. The cache
 * MUST be populated on every event that carries a session (SIGNED_IN /
 * TOKEN_REFRESHED / INITIAL_SESSION / USER_UPDATED), updated on explicit
 * refreshSession success, populated on signIn, and cleared on SIGNED_OUT
 * and signOut. It MUST NOT be persisted to localStorage — supabase already
 * owns the durable copy.
 */

const onAuthStateChangeMock = jest.fn()
const refreshSessionMock = jest.fn()
const signInWithPasswordMock = jest.fn()
const signOutMock = jest.fn()

let capturedListener: ((event: string, session: any) => unknown) | null = null

jest.mock("@/utils/supabaseClient", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: any) => {
        onAuthStateChangeMock(cb)
        capturedListener = cb
        return { data: { subscription: { unsubscribe: jest.fn() } } }
      },
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      refreshSession: (...args: any[]) => refreshSessionMock(...args),
      signInWithPassword: (...args: any[]) => signInWithPasswordMock(...args),
      signOut: (...args: any[]) => signOutMock(...args),
      updateUser: jest.fn().mockResolvedValue({ error: null }),
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

jest.mock("@/lib/utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// Mock the boot pipeline to a noop. The persist middleware's onRehydrateStorage
// callback fires state.boot() at module load — without this mock, boot races
// asynchronously through the test run and overwrites our seed state from the
// "no-session" branch (which clears accessToken via extractSessionTokens(null)).
jest.mock("../../stores/authBootMachine", () => {
  const actual = jest.requireActual("../../stores/authBootMachine")
  return {
    ...actual,
    boot: jest.fn().mockResolvedValue(undefined),
  }
})

import { extractSessionTokens, BOOT_INITIAL_STATE } from "../../stores/authBootMachine"
import { useAuthStore } from "../../stores/authStore"

const VALID_SESSION = {
  access_token: "at-1",
  refresh_token: "rt-1",
  expires_at: 1_900_000_000,
  user: {
    id: "u1",
    email: "u1@example.com",
    user_metadata: { full_name: "User One" },
  },
}

const REFRESHED_SESSION = {
  access_token: "at-2-refreshed",
  refresh_token: "rt-2",
  expires_at: 1_900_003_600,
  user: VALID_SESSION.user,
}

beforeEach(() => {
  refreshSessionMock.mockReset()
  signInWithPasswordMock.mockReset()
  signOutMock.mockReset().mockResolvedValue({ error: null })

  // Reset to known initial state.
  useAuthStore.setState({
    ...BOOT_INITIAL_STATE,
    phase: "idle" as any,
  })

  // Clear the localStorage stub so partialize tests start with a clean slate.
  localStorage.clear()
})

describe("extractSessionTokens helper", () => {
  it("returns null fields when session is null", () => {
    expect(extractSessionTokens(null)).toEqual({
      accessToken: null,
      accessTokenExpiresAt: null,
    })
  })

  it("returns null fields when session is missing access_token", () => {
    expect(extractSessionTokens({ user: { id: "u1" } } as any)).toEqual({
      accessToken: null,
      accessTokenExpiresAt: null,
    })
  })

  it("extracts access_token and expires_at from a valid session", () => {
    expect(extractSessionTokens(VALID_SESSION)).toEqual({
      accessToken: "at-1",
      accessTokenExpiresAt: 1_900_000_000,
    })
  })

  it("preserves null expires_at when supabase omits it", () => {
    expect(
      extractSessionTokens({ access_token: "at-x", user: { id: "u1" } } as any),
    ).toEqual({ accessToken: "at-x", accessTokenExpiresAt: null })
  })
})

describe("BOOT_INITIAL_STATE", () => {
  it("includes accessToken and accessTokenExpiresAt set to null", () => {
    expect(BOOT_INITIAL_STATE.accessToken).toBeNull()
    expect(BOOT_INITIAL_STATE.accessTokenExpiresAt).toBeNull()
  })
})

describe("onAuthStateChange writes the token cache", () => {
  it("populates accessToken on SIGNED_IN", () => {
    capturedListener!("SIGNED_IN", VALID_SESSION)
    const state = useAuthStore.getState()
    expect(state.accessToken).toBe("at-1")
    expect(state.accessTokenExpiresAt).toBe(1_900_000_000)
  })

  it("updates accessToken on TOKEN_REFRESHED", () => {
    // Seed with old token first
    useAuthStore.setState({ accessToken: "at-1", accessTokenExpiresAt: 1_900_000_000 })

    capturedListener!("TOKEN_REFRESHED", REFRESHED_SESSION)

    const state = useAuthStore.getState()
    expect(state.accessToken).toBe("at-2-refreshed")
    expect(state.accessTokenExpiresAt).toBe(1_900_003_600)
  })

  it("populates accessToken on INITIAL_SESSION", () => {
    capturedListener!("INITIAL_SESSION", VALID_SESSION)
    expect(useAuthStore.getState().accessToken).toBe("at-1")
  })

  it("updates accessToken on USER_UPDATED", () => {
    useAuthStore.setState({ accessToken: "at-old", accessTokenExpiresAt: 1 })
    capturedListener!("USER_UPDATED", VALID_SESSION)
    expect(useAuthStore.getState().accessToken).toBe("at-1")
  })

  it("clears accessToken on SIGNED_OUT", () => {
    useAuthStore.setState({
      accessToken: "at-1",
      accessTokenExpiresAt: 1_900_000_000,
      user: { id: "u1", email: "u1@example.com" },
    })

    capturedListener!("SIGNED_OUT", null)

    const state = useAuthStore.getState()
    expect(state.accessToken).toBeNull()
    expect(state.accessTokenExpiresAt).toBeNull()
  })
})

describe("explicit refreshSession() updates the token cache", () => {
  it("writes the new token on refresh success", async () => {
    refreshSessionMock.mockResolvedValue({
      data: { session: REFRESHED_SESSION },
      error: null,
    })
    useAuthStore.setState({ accessToken: "at-old", accessTokenExpiresAt: 1 })

    const ok = await useAuthStore.getState().refreshSession()
    expect(ok).toBe(true)

    const state = useAuthStore.getState()
    expect(state.accessToken).toBe("at-2-refreshed")
    expect(state.accessTokenExpiresAt).toBe(1_900_003_600)
  })

  it("does not clobber the cache when refresh returns no session", async () => {
    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    })
    useAuthStore.setState({ accessToken: "at-old", accessTokenExpiresAt: 5 })

    const ok = await useAuthStore.getState().refreshSession()
    expect(ok).toBe(false)

    const state = useAuthStore.getState()
    expect(state.accessToken).toBe("at-old")
    expect(state.accessTokenExpiresAt).toBe(5)
  })
})

describe("signOut clears the token cache", () => {
  it("clears accessToken/accessTokenExpiresAt synchronously on signOut", async () => {
    useAuthStore.setState({
      phase: "ready" as any,
      user: { id: "u1", email: "u1@example.com" },
      profile: { id: "u1" } as any,
      accessToken: "at-1",
      accessTokenExpiresAt: 1_900_000_000,
    })

    await useAuthStore.getState().signOut()

    const state = useAuthStore.getState()
    expect(state.accessToken).toBeNull()
    expect(state.accessTokenExpiresAt).toBeNull()
  })
})

describe("persisted payload (partialize) excludes the token cache", () => {
  // Re-import the persist config indirectly — the persist middleware applies
  // partialize when writing to storage. We can introspect what would be
  // persisted by recreating the partialize logic from the store config.
  it("only persists user and profile, never accessToken or accessTokenExpiresAt", () => {
    useAuthStore.setState({
      phase: "ready" as any,
      user: { id: "u1", email: "u1@example.com" },
      profile: { id: "u1", email: "u1@example.com" } as any,
      accessToken: "at-1-secret",
      accessTokenExpiresAt: 1_900_000_000,
    })

    // Read what's actually written to localStorage by the persist middleware.
    const raw = window.localStorage.getItem("chainreact-auth")
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(raw!)

    // Persist envelope shape: { state: {...}, version: 3 }
    const persistedState = persisted.state ?? persisted

    expect(persistedState).not.toHaveProperty("accessToken")
    expect(persistedState).not.toHaveProperty("accessTokenExpiresAt")
    // Sanity: user and profile DO appear (non-null because phase is 'ready').
    expect(persistedState.user).toBeTruthy()
    expect(persistedState.profile).toBeTruthy()
  })

  it("does not leak the token even when state is then mutated again", () => {
    useAuthStore.setState({
      phase: "ready" as any,
      user: { id: "u1", email: "u1@example.com" },
      profile: { id: "u1" } as any,
      accessToken: "at-secret-2",
      accessTokenExpiresAt: 9_999_999_999,
    })

    const raw = window.localStorage.getItem("chainreact-auth")!
    expect(raw).not.toContain("at-secret-2")
    expect(raw).not.toContain("9999999999")
    expect(raw).not.toContain("accessToken")
  })
})
