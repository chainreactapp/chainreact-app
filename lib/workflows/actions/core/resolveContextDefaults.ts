/**
 * PR-G0 — workspace / user / technical-fallback resolution for timezone & locale.
 *
 * Replaces hardcoded regional fallbacks (`America/New_York`, `en_US`) in
 * Calendar / Sheets / Wait handlers. Resolution order is fixed:
 *
 *   workspace setting → user setting → technical fallback
 *     - timezone fallback: 'UTC'
 *     - locale fallback:   'en_US'
 *
 * The workspace + user columns are added by the migration
 * `20260501000000_add_timezone_locale_to_workspaces_and_user_profiles.sql`.
 * Both are nullable; NULL means "unset" and the helper falls through.
 *
 * Invalid values fall through to the next layer:
 *   - timezone: not an IANA tz (rejected by Intl.DateTimeFormat)
 *   - locale:   not a non-empty string
 *
 * Contract: learning/docs/handler-contracts.md Q12.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/utils/logger'

const TIMEZONE_FALLBACK = 'UTC'
const LOCALE_FALLBACK = 'en_US'

export interface ResolveContextArgs {
  workspaceId?: string | null
  userId?: string | null
  /**
   * Optional supabase client. If omitted, a service-role admin client is
   * created. Tests pass an injected mock to avoid hitting the network.
   */
  supabase?: ReturnType<typeof createAdminClient> | null
}

/**
 * Returns true if `tz` is a valid IANA timezone identifier accepted by the
 * runtime's Intl implementation. Catches malformed strings and rejected
 * region codes.
 */
export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Returns true if `locale` is a non-empty string. We do not validate against
 * BCP-47 here — invalid locales degrade gracefully in `Intl` callers
 * (formatter falls back to en-US automatically). The check exists only to
 * reject NULL / undefined / '' from upstream sources.
 */
export function isValidLocale(locale: unknown): locale is string {
  return typeof locale === 'string' && locale.length > 0
}

/**
 * Resolve the effective timezone for an execution context. Applied in
 * priority order: workspace → user → 'UTC'.
 *
 * Returns 'UTC' if both layers are unset / invalid, or if the lookup fails.
 * Failures are logged at debug level — timezone resolution is a soft
 * dependency, never a fatal error.
 */
export async function resolveTimezone(args: ResolveContextArgs): Promise<string> {
  const supabase = args.supabase ?? createAdminClient()

  if (args.workspaceId) {
    const tz = await readWorkspaceTimezone(supabase, args.workspaceId)
    if (isValidIanaTimezone(tz)) return tz
  }

  if (args.userId) {
    const tz = await readUserTimezone(supabase, args.userId)
    if (isValidIanaTimezone(tz)) return tz
  }

  return TIMEZONE_FALLBACK
}

/**
 * Resolve the effective locale for an execution context. Applied in priority
 * order: workspace → user → 'en_US'.
 */
export async function resolveLocale(args: ResolveContextArgs): Promise<string> {
  const supabase = args.supabase ?? createAdminClient()

  if (args.workspaceId) {
    const locale = await readWorkspaceLocale(supabase, args.workspaceId)
    if (isValidLocale(locale)) return locale
  }

  if (args.userId) {
    const locale = await readUserLocale(supabase, args.userId)
    if (isValidLocale(locale)) return locale
  }

  return LOCALE_FALLBACK
}

/**
 * Resolve both at once — single round-trip per layer. Cheaper than calling
 * `resolveTimezone` and `resolveLocale` independently for handlers that need
 * both (Sheets `createSpreadsheet`).
 */
export async function resolveTimezoneAndLocale(
  args: ResolveContextArgs,
): Promise<{ timezone: string; locale: string }> {
  const supabase = args.supabase ?? createAdminClient()

  let timezone: string | null = null
  let locale: string | null = null

  if (args.workspaceId) {
    const ws = await readWorkspaceTzAndLocale(supabase, args.workspaceId)
    if (isValidIanaTimezone(ws.timezone)) timezone = ws.timezone
    if (isValidLocale(ws.locale)) locale = ws.locale
  }

  if ((!timezone || !locale) && args.userId) {
    const user = await readUserTzAndLocale(supabase, args.userId)
    if (!timezone && isValidIanaTimezone(user.timezone)) timezone = user.timezone
    if (!locale && isValidLocale(user.locale)) locale = user.locale
  }

  return {
    timezone: timezone ?? TIMEZONE_FALLBACK,
    locale: locale ?? LOCALE_FALLBACK,
  }
}

// ---------------------------------------------------------------------------
// internal readers — kept private so callers go through the resolved API.
// All readers swallow lookup errors and return null; the resolver above
// treats null + invalid identically (fall through).
// ---------------------------------------------------------------------------

async function readWorkspaceTimezone(supabase: any, workspaceId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('workspaces')
      .select('timezone')
      .eq('id', workspaceId)
      .maybeSingle()
    if (error) {
      logger.debug('[resolveContextDefaults] workspace timezone lookup failed', { workspaceId, error: error.message })
      return null
    }
    return data?.timezone ?? null
  } catch (err: any) {
    logger.debug('[resolveContextDefaults] workspace timezone lookup threw', { workspaceId, error: err?.message })
    return null
  }
}

async function readWorkspaceLocale(supabase: any, workspaceId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('workspaces')
      .select('locale')
      .eq('id', workspaceId)
      .maybeSingle()
    if (error) {
      logger.debug('[resolveContextDefaults] workspace locale lookup failed', { workspaceId, error: error.message })
      return null
    }
    return data?.locale ?? null
  } catch (err: any) {
    logger.debug('[resolveContextDefaults] workspace locale lookup threw', { workspaceId, error: err?.message })
    return null
  }
}

async function readWorkspaceTzAndLocale(
  supabase: any,
  workspaceId: string,
): Promise<{ timezone: string | null; locale: string | null }> {
  try {
    const { data, error } = await supabase
      .from('workspaces')
      .select('timezone, locale')
      .eq('id', workspaceId)
      .maybeSingle()
    if (error) return { timezone: null, locale: null }
    return { timezone: data?.timezone ?? null, locale: data?.locale ?? null }
  } catch {
    return { timezone: null, locale: null }
  }
}

async function readUserTimezone(supabase: any, userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('timezone')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      logger.debug('[resolveContextDefaults] user timezone lookup failed', { userId, error: error.message })
      return null
    }
    return data?.timezone ?? null
  } catch (err: any) {
    logger.debug('[resolveContextDefaults] user timezone lookup threw', { userId, error: err?.message })
    return null
  }
}

async function readUserLocale(supabase: any, userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('locale')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      logger.debug('[resolveContextDefaults] user locale lookup failed', { userId, error: error.message })
      return null
    }
    return data?.locale ?? null
  } catch (err: any) {
    logger.debug('[resolveContextDefaults] user locale lookup threw', { userId, error: err?.message })
    return null
  }
}

async function readUserTzAndLocale(
  supabase: any,
  userId: string,
): Promise<{ timezone: string | null; locale: string | null }> {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('timezone, locale')
      .eq('id', userId)
      .maybeSingle()
    if (error) return { timezone: null, locale: null }
    return { timezone: data?.timezone ?? null, locale: data?.locale ?? null }
  } catch {
    return { timezone: null, locale: null }
  }
}

// ---------------------------------------------------------------------------
// Test affordance — exposed so unit tests can pin the fallback strings
// without re-stating literal values.
// ---------------------------------------------------------------------------
export const __TIMEZONE_FALLBACK__ = TIMEZONE_FALLBACK
export const __LOCALE_FALLBACK__ = LOCALE_FALLBACK
