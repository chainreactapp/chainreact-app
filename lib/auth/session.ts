import { createClient } from "@/utils/supabaseClient"

import { logger } from '@/lib/utils/logger'

export interface UserSession {
  user: {
    id: string
    email?: string
    [key: string]: any
  }
  session: {
    access_token: string
    refresh_token?: string
    [key: string]: any
  }
}

/**
 * SessionManager handles user authentication and session management
 * Extracted from integrationStore.ts for better separation of concerns
 */
// Shorter than the previous 8s — getSession() is the cached/fast path. If it
// hasn't returned in 3s it's almost certainly deadlocked on @supabase/ssr's
// internal navigator lock; we'd rather fail fast and try refreshSession()
// (separate code path) than keep the user staring at a frozen button.
const GET_SESSION_TIMEOUT_MS = 3000
const REFRESH_SESSION_TIMEOUT_MS = 8000

export class SessionManager {
  private static async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }
  /**
   * Securely get user and session data with automatic refresh
   * @returns Promise<UserSession> - User and session data
   * @throws Error if authentication fails
   */
  static async getSecureUserAndSession(): Promise<UserSession> {
    const supabase = createClient()
    if (!supabase) {
      throw new Error("Supabase client not available")
    }

    // First try to get the session (cached path). Catch the timeout
    // so we can fall through to refreshSession() — which uses a different
    // code path inside the supabase client and won't be wedged on the same
    // lock contention that hangs getSession().
    let session: any = null
    let sessionError: any = null
    try {
      const result = await SessionManager.withTimeout(
        supabase.auth.getSession(),
        GET_SESSION_TIMEOUT_MS,
        "Supabase getSession"
      )
      session = result.data?.session
      sessionError = result.error
    } catch (timeoutErr: any) {
      // PR-AUTH-7: structured tag so the rollout dashboard can scrape this
      // event distinctly from generic warnings.
      logger.warn("getSession timed out, falling through to refreshSession", {
        event: "auth.getSession_timeout_fallback",
        error: timeoutErr?.message,
        timeoutMs: GET_SESSION_TIMEOUT_MS,
      })
      // Leave session null so the refresh branch runs below.
    }

    // If we have a valid session with access token, return it.
    if (session?.access_token && session?.user) {
      return {
        user: session.user,
        session
      }
    }

    if (sessionError) {
      logger.info("getSession returned error, attempting refresh", {
        error: sessionError?.message,
      })
    } else if (session) {
      logger.info("Session present but incomplete, attempting refresh")
    } else {
      logger.info("No valid session found, attempting refresh...")
    }

    const { data: { session: refreshedSession }, error: refreshError } = await SessionManager.withTimeout(
      supabase.auth.refreshSession(),
      REFRESH_SESSION_TIMEOUT_MS,
      "Supabase refreshSession"
    )

    if (refreshError || !refreshedSession?.access_token || !refreshedSession?.user) {
      // Only log, don't console.error to avoid scary messages
      logger.info("Session refresh not possible, user needs to log in")
      throw new Error("No authenticated user found. Please log in.")
    }

    return {
      user: refreshedSession.user,
      session: refreshedSession
    }
  }

  /**
   * Refresh the current session
   * @returns Promise<UserSession> - Refreshed user and session data
   * @throws Error if refresh fails
   */
  static async refreshSession(): Promise<UserSession> {
    const supabase = createClient()
    if (!supabase) {
      throw new Error("Supabase client not available")
    }

    const { data: { session }, error: refreshError } = await SessionManager.withTimeout(
      supabase.auth.refreshSession(),
      8000,
      "Supabase refreshSession"
    )
    
    if (refreshError || !session) {
      logger.error("❌ Session refresh failed:", refreshError)
      throw new Error("Session refresh failed. Please log in again.")
    }

    const { data: { user }, error: userError } = await SessionManager.withTimeout(
      supabase.auth.getUser(),
      8000,
      "Supabase getUser"
    )
    if (userError || !user?.id) {
      throw new Error("User validation failed after session refresh.")
    }

    return { user, session }
  }

  /**
   * Validate user data
   * @param user - User object to validate
   * @returns boolean - Whether user is valid
   */
  static validateUser(user: any): boolean {
    return user && user.id && typeof user.id === 'string'
  }

  /**
   * Validate session data
   * @param session - Session object to validate
   * @returns boolean - Whether session is valid
   */
  static validateSession(session: any): boolean {
    return session && session.access_token && typeof session.access_token === 'string'
  }

  /**
   * Get current user without session refresh
   * @returns Promise<User | null> - Current user or null if not authenticated
   */
  static async getCurrentUser() {
    const supabase = createClient()
    if (!supabase) {
      return null
    }

    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return null
    }

    return user
  }

  /**
   * Get current session without refresh
   * @returns Promise<Session | null> - Current session or null if not available
   */
  static async getCurrentSession() {
    const supabase = createClient()
    if (!supabase) {
      return null
    }

    const { data: { session }, error } = await supabase.auth.getSession()
    if (error || !session) {
      return null
    }

    return session
  }
}
