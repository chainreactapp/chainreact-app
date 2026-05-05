/**
 * @jest-environment jsdom
 *
 * Contract: stores/authStore.ts onAuthStateChange listener (PR-AUTH-1)
 *
 * The listener registered at module load MUST be synchronous. Awaiting
 * Supabase REST or boot() calls inside the listener holds the navigator
 * lock that getSession() needs and deadlocks every other auth-bound call
 * site (this is the root cause of the 2026-05-05 "Create Workflow silent
 * click" bug, and the same anti-pattern Supabase docs warn against).
 *
 * These tests verify:
 *  - The listener callback is sync (returns undefined, not a Promise).
 *  - When SIGNED_IN fires for the same user already in 'ready', the profile
 *    REST fetch does NOT run before the callback returns (deferred via
 *    queueMicrotask), and DOES run after the next microtask tick.
 *  - When SIGNED_IN fires for a new user, boot() does NOT run before the
 *    callback returns; user state is updated synchronously; boot() runs
 *    after the next microtask tick.
 *  - When SIGNED_OUT fires, user/profile are cleared synchronously and the
 *    integration-store cleanup is deferred (no longer setTimeout 100ms).
 */

const onAuthStateChangeMock = jest.fn()
const fromMock = jest.fn()
const bootMock = jest.fn()

let capturedListener: ((event: string, session: any) => unknown) | null = null

jest.mock("@/utils/supabaseClient", () => ({
  // Listener registration captures the callback. from() is the REST entry.
  supabase: {
    auth: {
      onAuthStateChange: (cb: any) => {
        onAuthStateChangeMock(cb)
        capturedListener = cb
        return { data: { subscription: { unsubscribe: jest.fn() } } }
      },
      // Defensive — listener doesn't call these, but the boot machine might.
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      refreshSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    from: (...args: any[]) => fromMock(...args),
  },
  createClient: () => ({
    auth: {
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      refreshSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  }),
}))

// Cross-tab sync — broadcast must not crash; we don't assert its content here.
jest.mock("@/lib/utils/cross-tab-sync", () => ({
  getCrossTabSync: () => ({
    broadcast: jest.fn(),
    subscribe: jest.fn(),
  }),
}))

jest.mock("@/lib/utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

// Stub the boot pipeline. The listener calls useAuthStore.getState().boot(),
// which is wired (in authStore.ts) to call bootPipeline. We replace
// bootPipeline with a spy so we can detect deferred boot() invocations
// without running the real pipeline.
jest.mock("../../stores/authBootMachine", () => {
  const actual = jest.requireActual("../../stores/authBootMachine")
  return {
    ...actual,
    boot: (...args: any[]) => bootMock(...args),
  }
})

// Importing authStore triggers registerListeners() which calls our mock
// onAuthStateChange — capturing the listener into capturedListener.
import { useAuthStore } from "../../stores/authStore"

beforeEach(() => {
  fromMock.mockReset()
  bootMock.mockReset()

  // Reset to a known state before each test.
  useAuthStore.setState({
    phase: "idle" as any,
    user: null,
    profile: null,
    loading: false,
    error: null,
  })
})

it("registers exactly one onAuthStateChange listener at module load", () => {
  expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1)
  expect(typeof capturedListener).toBe("function")
})

it("listener callback is synchronous (returns undefined, not a Promise)", () => {
  const result = capturedListener!("SIGNED_IN", null)
  expect(result).toBeUndefined()
  // A Promise has a .then; assert the return is genuinely sync.
  expect((result as any)?.then).toBeUndefined()
})

describe("SIGNED_IN — same user, already ready", () => {
  beforeEach(() => {
    useAuthStore.setState({
      phase: "ready" as any,
      user: { id: "u1", email: "u1@example.com" },
      profile: { id: "u1", updated_at: "2026-01-01T00:00:00Z" } as any,
    })
  })

  it("does not call from('user_profiles') before the callback returns", () => {
    // Slow profile fetch — we'll observe whether it started before the return.
    const single = jest.fn().mockReturnValue(new Promise(() => {})) // hangs
    fromMock.mockReturnValue({
      select: () => ({ eq: () => ({ single }) }),
    })

    capturedListener!("SIGNED_IN", { user: { id: "u1", email: "u1@example.com" } })

    // The deferred profile refresh has NOT run yet.
    expect(fromMock).not.toHaveBeenCalled()
    expect(single).not.toHaveBeenCalled()
  })

  it("runs the profile refresh on the next microtask tick", async () => {
    const profileData = {
      id: "u1",
      first_name: "U",
      last_name: "One",
      updated_at: "2026-02-01T00:00:00Z",
      email: "u1@example.com",
    }
    const single = jest.fn().mockResolvedValue({ data: profileData, error: null })
    fromMock.mockReturnValue({
      select: () => ({ eq: () => ({ single }) }),
    })

    capturedListener!("SIGNED_IN", { user: { id: "u1", email: "u1@example.com" } })

    // Flush microtasks; the deferred helper now runs.
    await Promise.resolve()
    await Promise.resolve()

    expect(fromMock).toHaveBeenCalledWith("user_profiles")
    expect(single).toHaveBeenCalled()
  })
})

describe("SIGNED_IN — new user", () => {
  beforeEach(() => {
    useAuthStore.setState({
      phase: "idle" as any,
      user: null,
      profile: null,
    })
  })

  it("writes user state synchronously and defers boot()", () => {
    capturedListener!("SIGNED_IN", {
      user: {
        id: "u2",
        email: "u2@example.com",
        user_metadata: { full_name: "U Two" },
      },
    })

    // User written synchronously.
    expect(useAuthStore.getState().user?.id).toBe("u2")

    // boot() not yet invoked — it's queued.
    expect(bootMock).not.toHaveBeenCalled()
  })

  it("does not run boot() before the callback returns", async () => {
    capturedListener!("SIGNED_IN", {
      user: { id: "u2", email: "u2@example.com", user_metadata: {} },
    })

    expect(bootMock).not.toHaveBeenCalled()

    // After the next microtask, boot() runs.
    await Promise.resolve()
    await Promise.resolve()
    expect(bootMock).toHaveBeenCalledTimes(1)
  })
})

describe("SIGNED_OUT", () => {
  beforeEach(() => {
    useAuthStore.setState({
      phase: "ready" as any,
      user: { id: "u1", email: "u1@example.com" },
      profile: { id: "u1" } as any,
      loading: true,
      error: "stale",
    })
  })

  it("clears user/profile/error state synchronously", () => {
    capturedListener!("SIGNED_OUT", null)

    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.profile).toBeNull()
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.phase).toBe("ready")
  })

  it("does not block on integration-store cleanup", () => {
    // The cleanup uses dynamic import('./integrationStore') which is async.
    // We can't easily intercept that here, but we can confirm the listener
    // returns synchronously regardless.
    const result = capturedListener!("SIGNED_OUT", null)
    expect(result).toBeUndefined()
  })
})
