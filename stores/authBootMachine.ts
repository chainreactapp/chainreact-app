/**
 * Auth Boot State Machine
 *
 * Single deterministic pipeline: idle → rehydrating → authenticating → loading_profile → ready
 * One timeout (10s), one AbortController, bootId-guarded transitions.
 *
 * Failure modes:
 * - 'degraded' = authenticated but profile unavailable. Strictly temporary (~30s max),
 *   auto-retries with backoff, then forces re-auth if unresolved.
 * - 'error' = authentication itself failed. Redirect to login.
 */

import { supabase } from '@/utils/supabaseClient'
import { logger } from '@/lib/utils/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BootPhase = 'idle' | 'rehydrating' | 'authenticating' | 'loading_profile' | 'ready' | 'degraded' | 'error'

export interface User {
  id: string
  email: string
  name?: string
  first_name?: string
  last_name?: string
  full_name?: string
  avatar?: string
}

export interface Profile {
  id: string
  full_name?: string
  first_name?: string
  last_name?: string
  avatar_url?: string | null
  company?: string
  job_title?: string
  secondary_email?: string
  phone_number?: string
  email?: string
  provider?: string
  role?: string
  admin_capabilities?: Record<string, boolean>
  tasks_used?: number
  tasks_limit?: number
  billing_period_start?: string
  plan?: string
  created_at?: string
  updated_at?: string
  ai_agent_preference?: 'always_show' | 'always_skip' | 'ask_later'
  ai_agent_skip_count?: number
  ai_agent_preference_updated_at?: string
  default_workspace_type?: 'personal' | 'team' | 'organization' | null
  default_workspace_id?: string | null
  workflow_creation_mode?: 'default' | 'ask' | 'follow_switcher'
}

export interface BootSlice {
  phase: BootPhase
  bootId: number
  bootError: string | null
  lastBootCompletedAt: number
  user: User | null
  profile: Profile | null
  loading: boolean
  error: string | null
}

type SetState = (partial: Partial<BootSlice> | ((state: BootSlice) => Partial<BootSlice>)) => void
type GetState = () => BootSlice

const BOOT_TIMEOUT_MS = 10_000
const PROFILE_COLUMNS = 'id, first_name, last_name, full_name, company, job_title, secondary_email, phone_number, avatar_url, provider, role, plan, admin_capabilities, email, tasks_used, tasks_limit, billing_period_start, created_at, updated_at'

// ---------------------------------------------------------------------------
// Transition guard
// ---------------------------------------------------------------------------

function transition(
  set: SetState,
  get: GetState,
  toPhase: BootPhase,
  expectedBootId: number,
  updates?: Partial<BootSlice>
): boolean {
  const current = get()
  if (current.bootId !== expectedBootId) return false
  // Allow exit from terminal phases only back to idle (for reboot)
  const isTerminal = current.phase === 'ready' || current.phase === 'degraded' || current.phase === 'error'
  if (isTerminal && toPhase !== 'idle' && toPhase !== 'rehydrating') return false
  set({ phase: toPhase, ...updates })
  return true
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

export function mapProfileData(raw: any): Profile {
  return {
    id: raw.id,
    full_name: raw.full_name ?? undefined,
    first_name: raw.first_name ?? undefined,
    last_name: raw.last_name ?? undefined,
    avatar_url: raw.avatar_url ?? undefined,
    company: raw.company ?? undefined,
    job_title: raw.job_title ?? undefined,
    role: raw.role ?? undefined,
    plan: raw.plan ?? undefined,
    admin_capabilities: raw.admin_capabilities ?? {},
    secondary_email: raw.secondary_email ?? undefined,
    phone_number: raw.phone_number ?? undefined,
    email: raw.email ?? undefined,
    provider: raw.provider ?? undefined,
    created_at: raw.created_at ?? undefined,
    updated_at: raw.updated_at ?? undefined,
    tasks_used: raw.tasks_used ?? 0,
    tasks_limit: raw.tasks_limit ?? undefined,
    billing_period_start: raw.billing_period_start ?? undefined,
  }
}

function deriveRoleFromMetadata(userMetadata: any): string {
  const metadata = userMetadata || {}
  const explicitRole = metadata.role || metadata.account_role || metadata.membership_role
  if (explicitRole && typeof explicitRole === 'string') return explicitRole
  if (metadata.is_beta_tester === true || metadata.beta_tester === true) return 'beta-pro'
  return 'free'
}

async function fetchProfilePipeline(
  userId: string,
  supabaseUser: any,
  signal: AbortSignal
): Promise<{ user: User; profile: Profile | null }> {
  const userObj: User = {
    id: supabaseUser.id,
    email: supabaseUser.email || '',
    name: supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name,
    avatar: supabaseUser.user_metadata?.avatar_url,
  }

  // Try 1: API endpoint
  try {
    const response = await fetch('/api/auth/profile', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal,
    })
    if (response.ok) {
      const payload = await response.json()
      if (payload?.profile) {
        const profile = mapProfileData(payload.profile)
        userObj.first_name = profile.first_name
        userObj.last_name = profile.last_name
        userObj.full_name = profile.full_name || userObj.name
        return { user: userObj, profile }
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err // re-throw abort
    logger.warn('[Boot] API profile fetch failed, trying direct query', { error: err?.message })
  }

  // Try 2: Direct Supabase query
  const { data, error } = await supabase
    .from('user_profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .single()

  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

  if (data) {
    const profile = mapProfileData(data)
    userObj.first_name = profile.first_name
    userObj.last_name = profile.last_name
    userObj.full_name = profile.full_name || userObj.name
    return { user: userObj, profile }
  }

  // Try 3: Re-attempt via API (which handles idempotent creation server-side)
  if (error?.code === 'PGRST116' || !data) {
    try {
      const retryResponse = await fetch('/api/auth/profile', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal,
      })
      if (retryResponse.ok) {
        const retryPayload = await retryResponse.json()
        if (retryPayload?.profile) {
          const profile = mapProfileData(retryPayload.profile)
          userObj.first_name = profile.first_name
          userObj.last_name = profile.last_name
          userObj.full_name = profile.full_name || userObj.name
          return { user: userObj, profile }
        }
      }
    } catch (retryErr: any) {
      if (retryErr?.name === 'AbortError') throw retryErr
      logger.warn('[Boot] Profile API retry failed', { error: retryErr?.message })
    }

    // In-memory fallback — no client-side INSERT
    const isGoogleUser =
      supabaseUser.app_metadata?.provider === 'google' ||
      supabaseUser.app_metadata?.providers?.includes('google') ||
      supabaseUser.identities?.some((id: any) => id.provider === 'google')

    const fullName = supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || ''
    let firstName = supabaseUser.user_metadata?.given_name || ''
    let lastName = supabaseUser.user_metadata?.family_name || ''
    if ((!firstName || !lastName) && fullName) {
      const parts = fullName.split(' ')
      firstName = firstName || parts[0] || ''
      lastName = lastName || parts.slice(1).join(' ') || ''
    }

    const detectedProvider =
      supabaseUser.app_metadata?.provider ||
      supabaseUser.app_metadata?.providers?.[0] ||
      (isGoogleUser ? 'google' : 'email')

    const fallbackProfile: Profile = {
      id: userId,
      full_name: fullName || supabaseUser.email?.split('@')[0] || 'User',
      first_name: firstName,
      last_name: lastName,
      avatar_url: supabaseUser.user_metadata?.avatar_url,
      email: supabaseUser.email ?? undefined,
      provider: detectedProvider,
      role: deriveRoleFromMetadata(supabaseUser.user_metadata),
    }
    userObj.first_name = firstName
    userObj.last_name = lastName
    userObj.full_name = fullName || userObj.name
    return { user: userObj, profile: fallbackProfile }
  }

  return { user: userObj, profile: null }
}

// ---------------------------------------------------------------------------
// Degraded-mode profile retry (exponential backoff, max ~30s total)
// ---------------------------------------------------------------------------

const RETRY_DELAYS = [1000, 2000, 4000] // 1s, 2s, 4s — total ~7s of waiting + fetch time

function scheduleProfileRetry(set: SetState, get: GetState, expectedBootId: number, attempt = 0) {
  if (attempt >= RETRY_DELAYS.length) {
    // Retries exhausted — force re-auth
    logger.warn('[Boot] Profile retries exhausted, forcing error state')
    const state = get()
    if (state.bootId === expectedBootId && state.phase === 'degraded') {
      set({
        phase: 'error',
        bootError: 'Unable to load profile after retries',
        loading: false,
      })
    }
    return
  }

  setTimeout(async () => {
    const state = get()
    // Only retry if still degraded and same boot cycle
    if (state.phase !== 'degraded' || state.bootId !== expectedBootId) return

    logger.info('[Boot] Retrying profile fetch', { attempt: attempt + 1 })

    try {
      const response = await fetch('/api/auth/profile', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      })
      if (response.ok) {
        const payload = await response.json()
        if (payload?.profile) {
          const profile = mapProfileData(payload.profile)
          // Verify we're still in the same degraded state
          if (get().bootId === expectedBootId && get().phase === 'degraded') {
            set({
              phase: 'ready',
              profile,
              loading: false,
              bootError: null,
              error: null,
              lastBootCompletedAt: Date.now(),
            })
            logger.info('[Boot] Profile retry succeeded', { attempt: attempt + 1 })
            return
          }
        }
      }
    } catch (err: any) {
      logger.warn('[Boot] Profile retry failed', { attempt: attempt + 1, error: err?.message })
    }

    // Schedule next attempt
    scheduleProfileRetry(set, get, expectedBootId, attempt + 1)
  }, RETRY_DELAYS[attempt])
}

// ---------------------------------------------------------------------------
// Boot pipeline
// ---------------------------------------------------------------------------

export async function boot(set: SetState, get: GetState): Promise<void> {
  const currentPhase = get().phase
  const currentBootId = get().bootId

  // Idempotency: don't start a new boot if one is already running
  if (currentPhase !== 'idle' && currentPhase !== 'ready' && currentPhase !== 'degraded') {
    logger.debug('[Boot] Already booting, skipping', { phase: currentPhase })
    return
  }

  const id = currentBootId + 1
  set({ bootId: id, phase: 'rehydrating', bootError: null, loading: true, error: null })

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
    const state = get()
    if (state.bootId === id && state.phase !== 'ready' && state.phase !== 'degraded' && state.phase !== 'error') {
      const hasUser = !!state.user
      const targetPhase: BootPhase = hasUser ? 'degraded' : 'error'
      logger.warn('[Boot] Timeout reached', { phase: state.phase, targetPhase })
      set({
        phase: targetPhase,
        loading: false,
        bootError: hasUser
          ? 'Boot timeout — profile unavailable'
          : 'Boot timeout — authentication failed',
        lastBootCompletedAt: Date.now(),
      })

      // If degraded, schedule auto-retry with backoff
      if (targetPhase === 'degraded') {
        scheduleProfileRetry(set, get, id)
      }
    }
  }, BOOT_TIMEOUT_MS)

  try {
    // Phase: authenticating
    if (!transition(set, get, 'authenticating', id)) return

    // Handle magic link hash fragments
    if (typeof window !== 'undefined') {
      const hash = window.location.hash
      if (hash && hash.includes('access_token')) {
        const urlParams = new URLSearchParams(hash.substring(1))
        const accessToken = urlParams.get('access_token')
        const refreshToken = urlParams.get('refresh_token')

        if (accessToken && refreshToken) {
          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (!sessionError && data.session) {
            window.location.hash = ''
            window.location.href = '/workflows'
            clearTimeout(timer)
            return
          }
        }
      }
    }

    // Race getSession() against onAuthStateChange — whichever resolves first wins.
    // getSession() can hang if the Supabase SDK's internal initialization is slow
    // (it acquires a navigator lock and may need to refresh the token over the network).
    // onAuthStateChange fires earlier in many cases (especially post-OAuth redirect).
    const sessionResult = await Promise.race([
      supabase.auth.getSession().then(({ data, error }) => ({
        session: data.session,
        error,
        source: 'getSession' as const,
      })),
      new Promise<{ session: any; error: null; source: 'authChange' }>((resolve) => {
        // Listen for the next auth state change event
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            subscription.unsubscribe()
            resolve({ session, error: null, source: 'authChange' })
          }
        })
        // Clean up if getSession wins first — the race will ignore this resolve
        // but we still need to unsubscribe after a timeout to avoid leaks
        setTimeout(() => subscription.unsubscribe(), BOOT_TIMEOUT_MS)
      }),
    ])

    const session = sessionResult.session
    const sessionError = sessionResult.error
    logger.debug('[Boot] Session resolved', { source: sessionResult.source, hasSession: !!session })

    if (get().bootId !== id) return // stale

    if (sessionError) {
      logger.warn('[Boot] Session error, treating as unauthenticated', { error: sessionError.message })
    }

    if (!session?.user) {
      transition(set, get, 'ready', id, {
        user: null,
        profile: null,
        loading: false,
        lastBootCompletedAt: Date.now(),
      })

      // Clear integration store when no user
      setTimeout(async () => {
        try {
          const { useIntegrationStore } = await import('./integrationStore')
          const integrationStore = useIntegrationStore.getState()
          integrationStore.setCurrentUserId(null)
          integrationStore.clearAllData()
        } catch { /* ignore */ }
      }, 50)
      return
    }

    // Phase: loading_profile
    if (!transition(set, get, 'loading_profile', id)) return

    const { user, profile } = await fetchProfilePipeline(
      session.user.id,
      session.user,
      controller.signal
    )

    if (get().bootId !== id) return // stale

    // Check for stale profile overwrite
    const existingProfile = get().profile
    const existingUpdatedAt = existingProfile?.updated_at ? Date.parse(existingProfile.updated_at) : NaN
    const fetchedUpdatedAt = profile?.updated_at ? Date.parse(profile.updated_at) : NaN
    const keepExisting =
      existingProfile &&
      !Number.isNaN(existingUpdatedAt) &&
      !Number.isNaN(fetchedUpdatedAt) &&
      existingUpdatedAt > fetchedUpdatedAt

    transition(set, get, 'ready', id, {
      user,
      profile: keepExisting ? existingProfile : profile,
      loading: false,
      lastBootCompletedAt: Date.now(),
    })

    // Post-boot side effects
    if (profile) {
      // Update integration store
      setTimeout(async () => {
        try {
          const { useIntegrationStore } = await import('./integrationStore')
          useIntegrationStore.getState().setCurrentUserId(session.user.id)
        } catch { /* ignore */ }
      }, 50)

      // Background integration preload
      setTimeout(async () => {
        try {
          const { useIntegrationStore } = await import('./integrationStore')
          const store = useIntegrationStore.getState()
          if (!store.preloadStarted && !store.globalPreloadingData) {
            await store.fetchIntegrations(false)
          }
        } catch { /* ignore */ }
      }, 3000)
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      // Timeout already handled above
      return
    }
    logger.error('[Boot] Unhandled error', { error: err?.message })
    if (get().bootId === id) {
      const hasUser = !!get().user
      const targetPhase: BootPhase = hasUser ? 'degraded' : 'error'
      set({
        phase: targetPhase,
        user: get().user, // keep whatever we have
        loading: false,
        error: err?.message || 'Boot error',
        bootError: err?.message || 'Boot error',
        lastBootCompletedAt: Date.now(),
      })

      if (targetPhase === 'degraded') {
        scheduleProfileRetry(set, get, get().bootId)
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const BOOT_INITIAL_STATE: BootSlice = {
  phase: 'idle',
  bootId: 0,
  bootError: null,
  lastBootCompletedAt: 0,
  user: null,
  profile: null,
  loading: false,
  error: null,
}
