/**
 * Contract: PR-G0 — `resolveContextDefaults` (Q12).
 *
 * Source: lib/workflows/actions/core/resolveContextDefaults.ts
 * Handler-contracts: see Q12 in learning/docs/handler-contracts.md.
 *
 * Resolution order: workspace → user → 'UTC' / 'en_US'. Invalid values at
 * any layer fall through to the next layer (NOT a hard fail). Missing
 * IDs (workspaceId / userId both undefined) → straight to fallback.
 */

import {
  isValidIanaTimezone,
  isValidLocale,
  resolveLocale,
  resolveTimezone,
  resolveTimezoneAndLocale,
  __LOCALE_FALLBACK__,
  __TIMEZONE_FALLBACK__,
} from '@/lib/workflows/actions/core/resolveContextDefaults'

interface SeededRow {
  timezone?: string | null
  locale?: string | null
}

/**
 * Tiny in-memory supabase-like client. Only implements the chain
 * `from(table).select(...).eq('id', id).maybeSingle()` because that's
 * all the helper uses. Fails the test if the helper hits a different
 * shape — protects against accidental query-shape drift.
 */
function makeSupabaseStub(seed: {
  workspaces?: Record<string, SeededRow>
  user_profiles?: Record<string, SeededRow>
  workspaceError?: string
  userError?: string
}) {
  return {
    from(table: string) {
      const map =
        table === 'workspaces'
          ? seed.workspaces ?? {}
          : table === 'user_profiles'
            ? seed.user_profiles ?? {}
            : null
      if (!map) throw new Error(`Unexpected table in stub: ${table}`)

      const errorFor = table === 'workspaces' ? seed.workspaceError : seed.userError

      return {
        select(_columns: string) {
          return {
            eq(_col: string, id: string) {
              return {
                async maybeSingle() {
                  if (errorFor) return { data: null, error: { message: errorFor } }
                  const row = map[id]
                  return { data: row ?? null, error: null }
                },
              }
            },
          }
        },
      }
    },
  } as any
}

describe('Q12 — isValidIanaTimezone', () => {
  test.each([
    'UTC',
    'America/New_York',
    'America/Chicago',
    'Europe/London',
    'Asia/Tokyo',
    'Pacific/Auckland',
  ])('accepts %s', (tz) => {
    expect(isValidIanaTimezone(tz)).toBe(true)
  })

  test.each([
    '',
    'NotARealTimezone',
    'America/NotACity',
    null,
    undefined,
    123,
    {},
  ])('rejects %j', (tz) => {
    expect(isValidIanaTimezone(tz as any)).toBe(false)
  })
})

describe('Q12 — isValidLocale', () => {
  test.each(['en_US', 'en-US', 'fr_FR', 'zh-CN', 'invalid-but-non-empty'])(
    'accepts non-empty string %s',
    (locale) => {
      expect(isValidLocale(locale)).toBe(true)
    },
  )

  test.each(['', null, undefined, 0, {}])('rejects %j', (locale) => {
    expect(isValidLocale(locale as any)).toBe(false)
  })
})

describe('Q12 — resolveTimezone resolution order', () => {
  test('workspace value beats user value', async () => {
    const supabase = makeSupabaseStub({
      workspaces: { ws1: { timezone: 'America/Chicago' } },
      user_profiles: { user1: { timezone: 'America/Los_Angeles' } },
    })
    const tz = await resolveTimezone({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(tz).toBe('America/Chicago')
  })

  test('user value used when workspace value is null', async () => {
    const supabase = makeSupabaseStub({
      workspaces: { ws1: { timezone: null } },
      user_profiles: { user1: { timezone: 'Europe/London' } },
    })
    const tz = await resolveTimezone({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(tz).toBe('Europe/London')
  })

  test('user value used when workspace row is absent', async () => {
    const supabase = makeSupabaseStub({
      workspaces: {},
      user_profiles: { user1: { timezone: 'Europe/London' } },
    })
    const tz = await resolveTimezone({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(tz).toBe('Europe/London')
  })

  test('falls through invalid IANA at workspace level → user value', async () => {
    const supabase = makeSupabaseStub({
      workspaces: { ws1: { timezone: 'NotARealTimezone' } },
      user_profiles: { user1: { timezone: 'Europe/London' } },
    })
    const tz = await resolveTimezone({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(tz).toBe('Europe/London')
  })

  test('falls through invalid IANA at user level → UTC', async () => {
    const supabase = makeSupabaseStub({
      workspaces: { ws1: { timezone: 'NotReal' } },
      user_profiles: { user1: { timezone: 'AlsoNotReal' } },
    })
    const tz = await resolveTimezone({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(tz).toBe(__TIMEZONE_FALLBACK__)
    expect(tz).toBe('UTC')
  })

  test('UTC fallback when both layers unset', async () => {
    const supabase = makeSupabaseStub({})
    const tz = await resolveTimezone({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(tz).toBe('UTC')
  })

  test('UTC fallback when no IDs supplied', async () => {
    const supabase = makeSupabaseStub({})
    const tz = await resolveTimezone({ supabase })
    expect(tz).toBe('UTC')
  })

  test('only userId supplied → user value or UTC', async () => {
    const supabase = makeSupabaseStub({
      user_profiles: { user1: { timezone: 'Asia/Tokyo' } },
    })
    const tz = await resolveTimezone({ userId: 'user1', supabase })
    expect(tz).toBe('Asia/Tokyo')
  })

  test('only workspaceId supplied → workspace value or UTC', async () => {
    const supabase = makeSupabaseStub({
      workspaces: { ws1: { timezone: 'Pacific/Auckland' } },
    })
    const tz = await resolveTimezone({ workspaceId: 'ws1', supabase })
    expect(tz).toBe('Pacific/Auckland')
  })

  test('lookup error at workspace → falls through to user', async () => {
    const supabase = makeSupabaseStub({
      workspaceError: 'PGRST: rate limit',
      user_profiles: { user1: { timezone: 'Asia/Tokyo' } },
    })
    const tz = await resolveTimezone({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(tz).toBe('Asia/Tokyo')
  })

  test('lookup error at user → falls through to UTC', async () => {
    const supabase = makeSupabaseStub({
      workspaceError: 'down',
      userError: 'down',
    })
    const tz = await resolveTimezone({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(tz).toBe('UTC')
  })
})

describe('Q12 — resolveLocale resolution order', () => {
  test('workspace beats user', async () => {
    const supabase = makeSupabaseStub({
      workspaces: { ws1: { locale: 'fr_FR' } },
      user_profiles: { user1: { locale: 'en_US' } },
    })
    const locale = await resolveLocale({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(locale).toBe('fr_FR')
  })

  test('user value when workspace is null', async () => {
    const supabase = makeSupabaseStub({
      workspaces: { ws1: { locale: null } },
      user_profiles: { user1: { locale: 'es_ES' } },
    })
    const locale = await resolveLocale({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(locale).toBe('es_ES')
  })

  test('en_US fallback when both layers unset', async () => {
    const supabase = makeSupabaseStub({})
    const locale = await resolveLocale({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(locale).toBe(__LOCALE_FALLBACK__)
    expect(locale).toBe('en_US')
  })

  test('empty string at workspace → falls through to user', async () => {
    const supabase = makeSupabaseStub({
      workspaces: { ws1: { locale: '' } },
      user_profiles: { user1: { locale: 'de_DE' } },
    })
    const locale = await resolveLocale({ workspaceId: 'ws1', userId: 'user1', supabase })
    expect(locale).toBe('de_DE')
  })
})

describe('Q12 — resolveTimezoneAndLocale resolves both layers per-field', () => {
  test('mixed: workspace has tz, user has locale', async () => {
    const supabase = makeSupabaseStub({
      workspaces: { ws1: { timezone: 'America/Chicago', locale: null } },
      user_profiles: { user1: { timezone: null, locale: 'fr_FR' } },
    })
    const result = await resolveTimezoneAndLocale({
      workspaceId: 'ws1',
      userId: 'user1',
      supabase,
    })
    expect(result).toEqual({ timezone: 'America/Chicago', locale: 'fr_FR' })
  })

  test('both layers unset → both fallbacks', async () => {
    const supabase = makeSupabaseStub({})
    const result = await resolveTimezoneAndLocale({
      workspaceId: 'ws1',
      userId: 'user1',
      supabase,
    })
    expect(result).toEqual({ timezone: 'UTC', locale: 'en_US' })
  })

  test('workspace fully set → user not consulted', async () => {
    const supabase = makeSupabaseStub({
      workspaces: { ws1: { timezone: 'Asia/Tokyo', locale: 'ja_JP' } },
    })
    const result = await resolveTimezoneAndLocale({
      workspaceId: 'ws1',
      userId: 'user1',
      supabase,
    })
    expect(result).toEqual({ timezone: 'Asia/Tokyo', locale: 'ja_JP' })
  })
})
