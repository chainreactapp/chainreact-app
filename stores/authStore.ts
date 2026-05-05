"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { supabase } from "@/utils/supabaseClient"
import { getCrossTabSync } from "@/lib/utils/cross-tab-sync"
import { logger } from '@/lib/utils/logger'
import {
  boot as bootPipeline,
  mapProfileData as bootMapProfile,
  extractSessionTokens,
  BOOT_INITIAL_STATE,
  type BootPhase,
  type BootSlice,
  type User,
  type Profile,
} from './authBootMachine'

// Re-export types so consumers don't need to import from two places
export type { BootPhase, User, Profile }

interface AuthState extends BootSlice {
  boot: () => Promise<void>
  signOut: () => Promise<void>
  updateProfile: (updates: Partial<Profile>) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, metadata?: Record<string, any>) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signInWithGitHub: () => Promise<void>
  signInWithMicrosoft: () => Promise<void>
  getCurrentUserId: () => string | null
  refreshSession: () => Promise<boolean>
  isAuthenticated: () => boolean
  retryBoot: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...BOOT_INITIAL_STATE,

      boot: async () => {
        await bootPipeline(
          set as any,
          get as any
        )
      },

      signOut: async () => {
        try {
          logger.debug("Starting sign out process...")

          // Reset to idle and clear data
          set({
            phase: 'idle' as BootPhase,
            user: null,
            profile: null,
            loading: false,
            error: null,
            bootError: null,
            ...extractSessionTokens(null), // PR-AUTH-2: clear cached token on signOut
          })

          // Clear localStorage immediately
          if (typeof window !== 'undefined') {
            localStorage.removeItem('chainreact-auth')
            localStorage.removeItem('pendingSignup')

            const keys = Object.keys(localStorage)
            keys.forEach(key => {
              if (key.startsWith('sb-') || key.includes('supabase')) {
                localStorage.removeItem(key)
              }
            })
          }

          // Clear all stores
          try {
            const { useIntegrationStore } = await import("./integrationStore")
            const integrationStore = useIntegrationStore.getState()
            integrationStore.setCurrentUserId(null)
            integrationStore.clearAllData()

            try {
              const { useWorkflowStore } = await import("./workflowStore")
              const workflowStore = useWorkflowStore.getState()
              if (workflowStore.clearAllData) workflowStore.clearAllData()
            } catch { /* ignore */ }

            try {
              const { useAnalyticsStore } = await import("./analyticsStore")
              const analyticsStore = useAnalyticsStore.getState()
              if (analyticsStore.clearAllData) analyticsStore.clearAllData()
            } catch { /* ignore */ }

            try {
              const { useAdminStore } = await import("./adminStore")
              const adminStore = useAdminStore.getState()
              if (adminStore.clearAllData) adminStore.clearAllData()
            } catch { /* ignore */ }

            try {
              const { useBillingStore } = await import("./billingStore")
              const billingStore = useBillingStore.getState()
              if (billingStore.clearAllData) billingStore.clearAllData()
            } catch { /* ignore */ }
          } catch (error) {
            logger.error("Error clearing stores:", error)
          }

          // Broadcast and dispatch events
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('user-signout'))
            const sync = getCrossTabSync()
            sync.broadcast('auth-logout', {})
          }

          // Sign out from Supabase in background
          supabase.auth.signOut().catch((error) => {
            logger.error("Supabase sign out error:", error)
          })

        } catch (error: any) {
          logger.error("Sign out error:", error)
          set({
            phase: 'idle' as BootPhase,
            user: null,
            profile: null,
            loading: false,
            error: null,
            ...extractSessionTokens(null), // PR-AUTH-2: clear cached token on error path too
          })
          if (typeof window !== 'undefined') {
            localStorage.removeItem('chainreact-auth')
            localStorage.removeItem('pendingSignup')
            const keys = Object.keys(localStorage)
            keys.forEach(key => {
              if (key.startsWith('sb-') || key.includes('supabase')) {
                localStorage.removeItem(key)
              }
            })
          }
        }
      },

      updateProfile: async (updates: Partial<Profile>) => {
        try {
          const { user } = get()
          if (!user) throw new Error("No user logged in")

          const updatedAt = new Date().toISOString()

          const { error: profileError } = await supabase
            .from('user_profiles')
            .upsert({
              id: user.id,
              full_name: updates.full_name,
              first_name: updates.first_name,
              last_name: updates.last_name,
              email: updates.email || user.email,
              company: updates.company,
              job_title: updates.job_title,
              secondary_email: updates.secondary_email,
              phone_number: updates.phone_number,
              provider: updates.provider,
              avatar_url: updates.avatar_url,
              default_workspace_type: updates.default_workspace_type,
              default_workspace_id: updates.default_workspace_id,
              workflow_creation_mode: updates.workflow_creation_mode,
              updated_at: updatedAt,
            }, { onConflict: 'id' })

          if (profileError) throw profileError

          const { error: authError } = await supabase.auth.updateUser({
            data: {
              full_name: updates.full_name,
              avatar_url: updates.avatar_url,
            },
          })

          if (authError) throw authError

          const { profile } = get()
          const updatedUser = {
            ...user,
            name: updates.full_name ?? user.name,
            first_name: updates.first_name ?? user.first_name,
            last_name: updates.last_name ?? user.last_name,
            full_name: updates.full_name ?? user.full_name,
            avatar: updates.avatar_url ?? user.avatar,
          }

          const updatedProfile = {
            ...(profile || {}),
            ...updates,
            id: user.id,
            updated_at: updatedAt,
          } as Profile

          set({ user: updatedUser, profile: updatedProfile })

          // If entitlement fields changed, refresh session to pick up updated JWT claims
          // (DB trigger syncs claims, but JWT needs refresh to reflect them)
          if (updates.plan !== undefined) {
            supabase.auth.refreshSession().catch(() => {
              // Non-fatal — JWT will refresh naturally within ~1 hour
            })
          }

          if (typeof window !== 'undefined') {
            const sync = getCrossTabSync()
            sync.broadcast('auth-update', { profile: updatedProfile })
          }
        } catch (error: any) {
          logger.error("Profile update error:", error)
          set({ error: error.message })
          throw error
        }
      },

      signIn: async (email: string, password: string) => {
        const signInTimeout = setTimeout(() => {
          set({ error: 'Sign-in timed out. Please try again.', loading: false })
        }, 10000)

        try {
          set({ loading: true, error: null })

          const signInPromise = supabase.auth.signInWithPassword({ email, password })
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Sign-in timeout')), 8000)
          )

          let result
          try {
            result = await Promise.race([signInPromise, timeoutPromise])
          } catch (timeoutError) {
            clearTimeout(signInTimeout)
            set({ error: 'Sign-in timed out. Please try again.', loading: false })
            throw new Error('Sign-in timed out. Please try again.')
          }

          const { data, error } = result

          if (error) {
            clearTimeout(signInTimeout)
            set({ error: error.message, loading: false })
            throw error
          }

          if (data.user) {
            const user: User = {
              id: data.user.id,
              email: data.user.email || "",
              name: data.user.user_metadata?.full_name || data.user.user_metadata?.name,
              avatar: data.user.user_metadata?.avatar_url,
            }

            clearTimeout(signInTimeout)

            // Fetch profile before setting ready — AuthReadyGuard blocks if profile is null
            let profile: Profile | null = null
            try {
              const response = await fetch('/api/auth/profile', {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
              })
              if (response.ok) {
                const payload = await response.json()
                if (payload?.profile) {
                  profile = bootMapProfile(payload.profile)
                  user.first_name = profile.first_name
                  user.last_name = profile.last_name
                  user.full_name = profile.full_name || user.name
                }
              }
            } catch (profileError) {
              logger.warn('Profile fetch failed during sign-in:', profileError)
            }

            set({
              user,
              profile,
              loading: false,
              phase: 'ready' as BootPhase,
              ...extractSessionTokens(data.session), // PR-AUTH-2: populate cached token
            })

            // Update integration store
            setTimeout(async () => {
              try {
                const { useIntegrationStore } = await import("./integrationStore")
                useIntegrationStore.getState().setCurrentUserId(data.user.id)
              } catch { /* ignore */ }
            }, 100)

            return { user, profile } as any
          }

          set({ loading: false })
          throw new Error("Login failed - no user data returned")
        } catch (error: any) {
          clearTimeout(signInTimeout)
          set({ error: error.message, loading: false })
          throw error
        } finally {
          clearTimeout(signInTimeout)
        }
      },

      signUp: async (email: string, password: string, metadata?: Record<string, any>) => {
        try {
          set({ loading: true, error: null })

          const response = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, metadata })
          })

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.error || 'Failed to create account')
          }

          const result = await response.json()

          if (result.userId) {
            localStorage.setItem('pendingSignup', JSON.stringify({
              userId: result.userId,
              email,
              metadata,
              timestamp: Date.now()
            }))
          }

          set({ loading: false })
        } catch (error: any) {
          logger.error("Sign up error:", error)
          set({ error: error.message, loading: false })
          throw error
        }
      },

      signInWithGoogle: async () => {
        try {
          set({ loading: true, error: null })

          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: `${window.location.origin}/api/auth/callback`,
              queryParams: { prompt: 'select_account' },
            },
          })

          if (error) throw error
        } catch (error: any) {
          logger.error("Google sign in error:", error)
          set({ error: error.message, loading: false })
          throw error
        }
      },

      signInWithGitHub: async () => {
        try {
          set({ loading: true, error: null })

          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'github',
            options: {
              redirectTo: `${window.location.origin}/api/auth/callback`,
            },
          })

          if (error) throw error
        } catch (error: any) {
          logger.error("GitHub sign in error:", error)
          set({ error: error.message, loading: false })
          throw error
        }
      },

      signInWithMicrosoft: async () => {
        try {
          set({ loading: true, error: null })

          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'azure',
            options: {
              redirectTo: `${window.location.origin}/api/auth/callback`,
              scopes: 'email profile openid',
            },
          })

          if (error) throw error
        } catch (error: any) {
          logger.error("Microsoft sign in error:", error)
          set({ error: error.message, loading: false })
          throw error
        }
      },

      getCurrentUserId: () => {
        return get().user?.id ?? null
      },


      refreshSession: async () => {
        try {
          const { data: { session }, error } = await supabase.auth.refreshSession()

          if (error) {
            logger.error("Session refresh error:", error)
            return false
          }

          if (session?.user) {
            const user = session.user
            set({
              user: {
                id: user.id,
                email: user.email || '',
                name: user.user_metadata?.name,
                first_name: user.user_metadata?.first_name,
                last_name: user.user_metadata?.last_name,
                full_name: user.user_metadata?.full_name,
                avatar: user.user_metadata?.avatar_url,
              },
              ...extractSessionTokens(session), // PR-AUTH-2: refresh cached token
            })
            return true
          }
          return false
        } catch (error) {
          logger.error("Session refresh failed:", error)
          return false
        }
      },

      isAuthenticated: () => {
        const state = get()
        return !!(state.user && state.user.id)
      },

      retryBoot: async () => {
        set({ phase: 'idle' as BootPhase, bootError: null, error: null })
        await bootPipeline(set as any, get as any)
      },
    }),
    {
      name: "chainreact-auth",
      version: 3, // Bumped for phase-based boot model
      migrate: (persistedState: any, version: number) => {
        if (version !== 3) {
          logger.warn('[AUTH] Persisted state version mismatch, clearing stale data', {
            persistedVersion: version,
            currentVersion: 3,
          })
          return {
            ...BOOT_INITIAL_STATE,
          }
        }
        return persistedState
      },
      // Wrap a string-shaped StateStorage in createJSONStorage so the persist
      // middleware gets the typed PersistStorage<S> shape it expects in
      // Zustand 5. Corruption detection runs at the string level (before the
      // JSON parse done by createJSONStorage) so we can catch leftover
      // supabase v1 base64 cookies and stray JWTs before they break the
      // parse.
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          try {
            if (typeof window === 'undefined') return null

            const str = localStorage.getItem(name)
            if (!str) return null

            if (str.startsWith('base64-') || str.includes('eyJ')) {
              logger.warn('Detected corrupted auth data, clearing...')
              localStorage.removeItem(name)
              return null
            }

            const data = JSON.parse(str)

            if (data && typeof data === 'object' && data.state) {
              return str
            }

            logger.warn('Invalid auth data structure, clearing...')
            localStorage.removeItem(name)
            return null
          } catch (error) {
            logger.error('Error reading auth storage:', error)
            if (typeof window !== 'undefined') {
              try { localStorage.removeItem(name) } catch { /* ignore */ }
            }
            return null
          }
        },
        setItem: (name, value) => {
          try {
            if (typeof window === 'undefined') return
            // value is already a JSON string from createJSONStorage.
            localStorage.setItem(name, value)
          } catch (error: any) {
            if (error?.name === 'QuotaExceededError') {
              console.warn('LocalStorage quota exceeded - auth state may not persist')
            }
          }
        },
        removeItem: (name) => {
          if (typeof window === 'undefined') return
          localStorage.removeItem(name)
        },
      })),
      partialize: (state) => ({
        user: state.phase === 'degraded' || state.phase === 'error' ? null : state.user,
        profile: state.phase === 'degraded' || state.phase === 'error' ? null : state.profile,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          logger.error('[AUTH] Error during rehydration:', error)
          if (typeof window !== 'undefined') {
            try { localStorage.removeItem('chainreact-auth') } catch { /* ignore */ }
          }
        }

        // Boot is the single entry point — called once after rehydration
        if (state && typeof window !== 'undefined') {
          state.boot()
        }
      },
    },
  ),
)

// ---------------------------------------------------------------------------
// One-time listener setup (module scope — registered once, not per boot)
// ---------------------------------------------------------------------------

// Deferred work helpers for the auth state listener (PR-AUTH-1).
// Kept at module scope so the listener can dispatch them via queueMicrotask
// without capturing the listener's closure or holding the navigator lock.

async function refreshProfileAfterSignIn(
  userId: string,
  profileSnapshot: Profile | null,
) {
  try {
    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, full_name, company, job_title, secondary_email, phone_number, avatar_url, provider, role, plan, admin, email, tasks_used, tasks_limit, billing_period_start, created_at, updated_at')
      .eq('id', userId)
      .single()

    if (profileData) {
      const profile = bootMapProfile(profileData)
      const existing = useAuthStore.getState().profile
      const existingTs = existing?.updated_at ? Date.parse(existing.updated_at) : NaN
      const incomingTs = profile.updated_at ? Date.parse(profile.updated_at) : NaN
      const keepExisting =
        existing &&
        !Number.isNaN(existingTs) &&
        !Number.isNaN(incomingTs) &&
        existingTs > incomingTs

      if (!keepExisting) {
        useAuthStore.setState({ profile })
      }
    }
  } catch (error) {
    logger.warn('[AUTH] Profile refresh after SIGNED_IN failed', { error })
  } finally {
    // Broadcast preserves pre-PR-AUTH-1 semantics: the snapshot captured at
    // event-fire time, not the post-fetch profile. Other tabs use this only
    // to know "someone signed in"; they fetch their own profile.
    try {
      const sync = getCrossTabSync()
      sync.broadcast('auth-login', { userId, profile: profileSnapshot })
    } catch (broadcastError) {
      logger.warn('[AUTH] Cross-tab broadcast failed', { error: broadcastError })
    }
  }
}

async function clearIntegrationStoreOnSignOut() {
  try {
    const { useIntegrationStore } = await import('./integrationStore')
    const integrationStore = useIntegrationStore.getState()
    integrationStore.setCurrentUserId(null)
    integrationStore.clearAllData()
  } catch {
    /* ignore — integration store may not be loaded yet */
  }
}

let listenersRegistered = false

function registerListeners() {
  if (listenersRegistered || typeof window === 'undefined') return
  listenersRegistered = true

  // Auth state change listener.
  //
  // CRITICAL: this callback MUST be synchronous. Awaiting Supabase REST / boot
  // calls inside the listener holds the navigator lock that getSession() needs
  // and deadlocks every other auth-bound call site. All async follow-up work
  // is dispatched via queueMicrotask so the SDK callback returns immediately
  // and releases the lock. See learning/docs/auth-reliability-refactor.md
  // (PR-AUTH-1).
  supabase.auth.onAuthStateChange((event, session) => {
    logger.debug('[AUTH] Auth state changed', { event, hasSession: !!session })

    // PR-AUTH-2: keep the cached access token in lockstep with every event
    // that carries a session payload. This includes silent TOKEN_REFRESHED
    // events fired by the SDK every ~55 minutes. Writing here is synchronous
    // (no async work, no lock acquisition) so it's safe inside the listener.
    if (
      event === 'SIGNED_IN' ||
      event === 'TOKEN_REFRESHED' ||
      event === 'INITIAL_SESSION' ||
      event === 'USER_UPDATED'
    ) {
      useAuthStore.setState(extractSessionTokens(session))
    } else if (event === 'SIGNED_OUT') {
      useAuthStore.setState(extractSessionTokens(null))
    }

    if (event === 'SIGNED_IN' && session?.user) {
      const state = useAuthStore.getState()
      const sessionUser = session.user

      // Fast path: same user, already ready/degraded — defer profile refresh
      // and the cross-tab broadcast to a microtask. Capture the existing
      // profile snapshot synchronously so the broadcast payload preserves
      // pre-PR-AUTH-1 semantics (it broadcasted the snapshot from when the
      // event fired, not the freshly-fetched profile).
      if ((state.phase === 'ready' || state.phase === 'degraded') && state.user?.id === sessionUser.id) {
        const profileSnapshot = state.profile
        queueMicrotask(() => {
          void refreshProfileAfterSignIn(sessionUser.id, profileSnapshot)
        })
        return
      }

      // New user or not ready — write user state synchronously, defer boot()
      // to a microtask. boot() itself calls getSession(); deferring lets the
      // SDK callback fully return (and release its lock) before we re-enter
      // the auth subsystem.
      if (!state.user || state.user.id !== sessionUser.id) {
        const user: User = {
          id: sessionUser.id,
          email: sessionUser.email || "",
          name: sessionUser.user_metadata?.full_name || sessionUser.user_metadata?.name,
          avatar: sessionUser.user_metadata?.avatar_url,
        }
        useAuthStore.setState({ user })

        // If boot is already mid-flight (authenticating/loading_profile), don't call
        // boot() again — it will be rejected by the idempotency guard. Instead, the
        // in-flight boot's getSession() should resolve with this session.
        // Only trigger boot if we're in a terminal or idle phase.
        const currentPhase = state.phase
        if (currentPhase === 'idle' || currentPhase === 'ready' || currentPhase === 'degraded' || currentPhase === 'error') {
          queueMicrotask(() => {
            void useAuthStore.getState().boot()
          })
        } else {
          logger.debug('[AUTH] SIGNED_IN received during boot, skipping re-boot', { phase: currentPhase })
        }
      }
    } else if (event === 'SIGNED_OUT') {
      const state = useAuthStore.getState()
      if (state.user) {
        useAuthStore.setState({
          user: null,
          profile: null,
          loading: false,
          error: null,
          phase: 'ready' as BootPhase,
        })

        // Defer integration-store cleanup to a microtask so the SDK callback
        // returns first. The previous setTimeout(..., 100) had no rationale
        // for the 100ms delay; queueMicrotask is fast and ordered.
        queueMicrotask(() => {
          void clearIntegrationStoreOnSignOut()
        })
      }
    }
  })

  // Visibility change listener — throttled by lastBootCompletedAt
  let lastHiddenAt = Date.now()
  const STALE_THRESHOLD = 5 * 60 * 1000 // 5 minutes

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      lastHiddenAt = Date.now()
    } else if (document.visibilityState === 'visible') {
      const state = useAuthStore.getState()
      const timeSinceHidden = Date.now() - lastHiddenAt
      const timeSinceBoot = Date.now() - state.lastBootCompletedAt

      // Reboot from degraded immediately on tab focus (user returned, try again)
      if (state.phase === 'degraded') {
        logger.debug('[AUTH] Tab visible while degraded, retrying boot')
        state.retryBoot()
        return
      }

      // Only reboot if tab was hidden 5+ min AND boot data is stale
      if (timeSinceHidden >= STALE_THRESHOLD && timeSinceBoot >= STALE_THRESHOLD) {
        if (state.phase === 'ready') {
          logger.debug('[AUTH] Tab visible after extended absence, re-verifying session')
          // Reset to idle so boot() can run
          useAuthStore.setState({ phase: 'idle' as BootPhase })
          state.boot()
        }
      }
    }
  })

  // Cross-tab storage event listener
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== 'chainreact-auth') return

    try {
      if (event.newValue) {
        const newData = JSON.parse(event.newValue)
        const newState = newData?.state

        if (newState?.user && newState?.profile) {
          const current = useAuthStore.getState()
          if (!current.user || current.user.id !== newState.user.id) {
            useAuthStore.setState({
              user: newState.user,
              profile: newState.profile,
              phase: 'ready' as BootPhase,
              loading: false,
              error: null,
            })
          }
        }
      }
    } catch { /* ignore parse errors */ }
  })

  // Cross-tab sync via BroadcastChannel
  const sync = getCrossTabSync()

  sync.subscribe('auth-login', (data) => {
    const state = useAuthStore.getState()
    if (!state.user || state.user.id !== data.userId) {
      // Reset and reboot to pick up new session
      useAuthStore.setState({ phase: 'idle' as BootPhase })
      state.boot()
    }
  })

  sync.subscribe('auth-logout', () => {
    const state = useAuthStore.getState()
    if (state.user) {
      state.signOut()
    }
  })

  sync.subscribe('auth-update', (data) => {
    const state = useAuthStore.getState()
    if (state.user && data.profile) {
      useAuthStore.setState({ profile: data.profile })
    }
  })
}

// Register listeners on module load (client only)
// NOTE: Must be synchronous — setTimeout would cause a race condition where
// Supabase fires SIGNED_IN before the listener is attached (post-OAuth redirect).
if (typeof window !== 'undefined') {
  registerListeners()
}
