/**
 * Contract: PR-G0 — handler-defaults backfill framework (Q11).
 *
 * Source: lib/workflows/migrations/handlerDefaultsBackfill.ts
 * Handler-contracts: see Q11 in learning/docs/handler-contracts.md.
 *
 * Verifies idempotence, Q5 preservation (0 / false / '' are NOT overwritten),
 * scoped-by-PR filtering, and dry-run mode.
 */

import {
  applyEntriesToConfig,
  type BackfillEntry,
  groupEntriesByNodeType,
  runHandlerDefaultsBackfill,
  selectEntries,
} from '@/lib/workflows/migrations/handlerDefaultsBackfill'

const ENTRIES: BackfillEntry[] = [
  {
    pr: 'PR-G2',
    nodeType: 'google_calendar_action_create_event',
    fieldName: 'sendNotifications',
    legacyDefault: 'all',
    auditRef: 'createEvent.ts:42',
  },
  {
    pr: 'PR-G2',
    nodeType: 'google_calendar_action_create_event',
    fieldName: 'guestsCanInviteOthers',
    legacyDefault: true,
    auditRef: 'createEvent.ts:43',
  },
  {
    pr: 'PR-G3',
    nodeType: 'google_drive_action_share_file',
    fieldName: 'sendNotification',
    legacyDefault: true,
    auditRef: 'shareFile.ts:24',
  },
]

describe('Q11 — selectEntries filters by PR', () => {
  test('no filter → all entries', () => {
    expect(selectEntries(ENTRIES)).toHaveLength(3)
  })

  test('empty filter → all entries (defensive)', () => {
    expect(selectEntries(ENTRIES, [])).toHaveLength(3)
  })

  test('single PR filter', () => {
    const result = selectEntries(ENTRIES, ['PR-G2'])
    expect(result).toHaveLength(2)
    expect(result.every((e) => e.pr === 'PR-G2')).toBe(true)
  })

  test('multi PR filter', () => {
    const result = selectEntries(ENTRIES, ['PR-G2', 'PR-G3'])
    expect(result).toHaveLength(3)
  })

  test('filter PR not in registry → empty', () => {
    expect(selectEntries(ENTRIES, ['PR-G99'])).toHaveLength(0)
  })
})

describe('Q11 — groupEntriesByNodeType clusters by node_type', () => {
  test('groups multiple fields per node type', () => {
    const groups = groupEntriesByNodeType(ENTRIES)
    expect(groups.size).toBe(2)
    expect(groups.get('google_calendar_action_create_event')).toHaveLength(2)
    expect(groups.get('google_drive_action_share_file')).toHaveLength(1)
  })

  test('empty input → empty map', () => {
    expect(groupEntriesByNodeType([]).size).toBe(0)
  })
})

describe('Q11 — applyEntriesToConfig idempotence + Q5 preservation', () => {
  const calendarEntries = ENTRIES.filter(
    (e) => e.nodeType === 'google_calendar_action_create_event',
  )

  test('empty config → backfill applies all entries', () => {
    const result = applyEntriesToConfig({}, calendarEntries)
    expect(result).not.toBeNull()
    expect(result!.newConfig).toEqual({
      sendNotifications: 'all',
      guestsCanInviteOthers: true,
    })
    expect(result!.appliedFields.sort()).toEqual(['guestsCanInviteOthers', 'sendNotifications'])
  })

  test('null config treated as empty', () => {
    const result = applyEntriesToConfig(null, calendarEntries)
    expect(result).not.toBeNull()
    expect(result!.appliedFields.sort()).toEqual(['guestsCanInviteOthers', 'sendNotifications'])
  })

  test('idempotent: re-running on already-backfilled config → no change', () => {
    const first = applyEntriesToConfig({}, calendarEntries)!
    const second = applyEntriesToConfig(first.newConfig, calendarEntries)
    expect(second).toBeNull()
  })

  test('preserves explicit user choice (not overwritten)', () => {
    const result = applyEntriesToConfig(
      { sendNotifications: 'none' },
      calendarEntries,
    )
    // Only guestsCanInviteOthers gets backfilled, not sendNotifications.
    expect(result).not.toBeNull()
    expect(result!.newConfig.sendNotifications).toBe('none')
    expect(result!.newConfig.guestsCanInviteOthers).toBe(true)
    expect(result!.appliedFields).toEqual(['guestsCanInviteOthers'])
  })

  test('Q5: false is a valid explicit choice — NOT backfilled', () => {
    const result = applyEntriesToConfig(
      { guestsCanInviteOthers: false },
      calendarEntries,
    )
    expect(result!.newConfig.guestsCanInviteOthers).toBe(false)
    expect(result!.appliedFields).toEqual(['sendNotifications'])
  })

  test('Q5: 0 is a valid explicit choice — NOT backfilled', () => {
    const result = applyEntriesToConfig(
      { sendNotifications: 0 as any },
      calendarEntries,
    )
    expect(result!.newConfig.sendNotifications).toBe(0)
  })

  test('Q5: empty string is a valid explicit choice — NOT backfilled by framework', () => {
    // The framework defers Q5 empty-string semantics to the runtime
    // requireExplicitField check. Backfill ONLY targets undefined / null —
    // an empty string was explicitly written by something and should not
    // be replaced silently.
    const result = applyEntriesToConfig({ sendNotifications: '' }, calendarEntries)
    expect(result!.newConfig.sendNotifications).toBe('')
    expect(result!.appliedFields).toEqual(['guestsCanInviteOthers'])
  })

  test('explicit null → backfilled (treated same as undefined)', () => {
    const result = applyEntriesToConfig(
      { sendNotifications: null as any },
      calendarEntries,
    )
    expect(result!.newConfig.sendNotifications).toBe('all')
  })

  test('all entries already set → null (no change)', () => {
    const result = applyEntriesToConfig(
      { sendNotifications: 'none', guestsCanInviteOthers: false },
      calendarEntries,
    )
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Stub supabase for the runHandlerDefaultsBackfill integration-ish test.
// Mirrors the chain `from(table).select(...).eq(...).order(...).range(...)`
// the runner uses for paginated reads, plus
// `.update(...).eq('id', id)` for writes.
// ---------------------------------------------------------------------------

interface StubRow {
  id: string
  node_type: string
  config: Record<string, unknown>
}

function makeRunnerSupabaseStub(rows: StubRow[]) {
  const writes: Array<{ id: string; config: any }> = []

  const stub = {
    from(table: string) {
      if (table !== 'workflow_nodes') {
        throw new Error(`Unexpected table: ${table}`)
      }
      return {
        select(_columns: string) {
          let filtered = [...rows]
          const builder = {
            eq(column: string, value: string) {
              filtered = filtered.filter((r) => (r as any)[column] === value)
              return builder
            },
            order(_col: string, _opts: any) {
              return builder
            },
            range(from: number, to: number) {
              return Promise.resolve({
                data: filtered.slice(from, to + 1),
                error: null,
              })
            },
          }
          return builder
        },
        update(payload: any) {
          return {
            eq(column: string, id: string) {
              if (column !== 'id') throw new Error('expected id-eq update')
              writes.push({ id, config: payload.config })
              const target = rows.find((r) => r.id === id)
              if (target) target.config = payload.config
              return Promise.resolve({ data: null, error: null })
            },
          }
        },
      }
    },
  }

  return { supabase: stub as any, writes, rows }
}

describe('Q11 — runHandlerDefaultsBackfill end-to-end', () => {
  test('empty registry → no scans, no writes', async () => {
    const { supabase, writes } = makeRunnerSupabaseStub([])
    const result = await runHandlerDefaultsBackfill({ supabase, registry: [] })
    expect(result.scanned).toBe(0)
    expect(result.rowsUpdated).toBe(0)
    expect(writes).toHaveLength(0)
  })

  test('scans matching node types, writes backfill, skips already-set', async () => {
    const seedRows: StubRow[] = [
      { id: 'n1', node_type: 'google_calendar_action_create_event', config: {} },
      {
        id: 'n2',
        node_type: 'google_calendar_action_create_event',
        config: { sendNotifications: 'none' },
      },
      {
        id: 'n3',
        node_type: 'google_drive_action_share_file',
        config: { sendNotification: false },
      },
      { id: 'n4', node_type: 'unrelated_node_type', config: {} },
    ]
    const { supabase, writes } = makeRunnerSupabaseStub(seedRows)

    const result = await runHandlerDefaultsBackfill({ supabase, registry: ENTRIES })

    // Scanned only matched node types (n1 + n2 calendar; n3 drive). n4 unrelated.
    expect(result.scanned).toBe(3)

    // n1 fully backfilled (both calendar fields), n2 partially (only guestsCanInviteOthers).
    // n3 has sendNotification:false (Q5 valid) → skipped.
    expect(result.rowsUpdated).toBe(2)
    expect(writes.map((w) => w.id).sort()).toEqual(['n1', 'n2'])

    const n1Write = writes.find((w) => w.id === 'n1')!
    expect(n1Write.config).toEqual({
      sendNotifications: 'all',
      guestsCanInviteOthers: true,
    })

    const n2Write = writes.find((w) => w.id === 'n2')!
    expect(n2Write.config).toEqual({
      sendNotifications: 'none', // preserved
      guestsCanInviteOthers: true, // backfilled
    })

    expect(result.byEntry).toEqual({
      'PR-G2:google_calendar_action_create_event.sendNotifications': 1,
      'PR-G2:google_calendar_action_create_event.guestsCanInviteOthers': 2,
      'PR-G3:google_drive_action_share_file.sendNotification': 0,
    })
  })

  test('PR filter restricts entries applied', async () => {
    const seedRows: StubRow[] = [
      { id: 'n1', node_type: 'google_calendar_action_create_event', config: {} },
      { id: 'n3', node_type: 'google_drive_action_share_file', config: {} },
    ]
    const { supabase, writes } = makeRunnerSupabaseStub(seedRows)

    const result = await runHandlerDefaultsBackfill({
      supabase,
      registry: ENTRIES,
      prs: ['PR-G2'],
    })

    // PR-G3 entry filtered out → drive node type not even scanned.
    expect(result.scanned).toBe(1) // only n1 calendar was scanned
    expect(writes).toHaveLength(1)
    expect(writes[0].id).toBe('n1')
  })

  test('dryRun: counts updates but does not persist', async () => {
    const seedRows: StubRow[] = [
      { id: 'n1', node_type: 'google_calendar_action_create_event', config: {} },
    ]
    const { supabase, writes } = makeRunnerSupabaseStub(seedRows)

    const result = await runHandlerDefaultsBackfill({
      supabase,
      registry: ENTRIES,
      dryRun: true,
    })

    expect(result.dryRun).toBe(true)
    expect(result.rowsUpdated).toBe(1)
    expect(writes).toHaveLength(0)
  })

  test('idempotence: second run is a no-op', async () => {
    const seedRows: StubRow[] = [
      { id: 'n1', node_type: 'google_calendar_action_create_event', config: {} },
    ]
    const { supabase, writes } = makeRunnerSupabaseStub(seedRows)

    const first = await runHandlerDefaultsBackfill({ supabase, registry: ENTRIES })
    expect(first.rowsUpdated).toBe(1)
    expect(writes).toHaveLength(1)

    const second = await runHandlerDefaultsBackfill({ supabase, registry: ENTRIES })
    expect(second.rowsUpdated).toBe(0)
    // No new writes — total still 1 from the first run.
    expect(writes).toHaveLength(1)
  })

  test('paginates through > pageSize rows', async () => {
    const seedRows: StubRow[] = Array.from({ length: 7 }, (_, i) => ({
      id: `n${i}`,
      node_type: 'google_calendar_action_create_event',
      config: {},
    }))
    const { supabase, writes } = makeRunnerSupabaseStub(seedRows)

    const result = await runHandlerDefaultsBackfill({
      supabase,
      registry: ENTRIES.filter((e) => e.pr === 'PR-G2'),
      pageSize: 3,
    })

    expect(result.scanned).toBe(7)
    expect(result.rowsUpdated).toBe(7)
    expect(writes).toHaveLength(7)
  })
})
