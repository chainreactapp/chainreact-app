/**
 * Contract: PR-C4 — within-session idempotency registry (Q4).
 *
 * Source files exercised:
 *   - lib/workflows/actions/core/hashPayload.ts
 *   - lib/workflows/actions/core/idempotencyKey.ts
 *   - lib/workflows/actions/core/sessionSideEffects.ts
 *
 * Contract: see learning/docs/handler-contracts.md Q4 and
 * learning/docs/session-side-effects-design.md.
 *
 * What this file proves (pure-function level):
 *   - hashPayload canonicalization: key-order independent, array order
 *     preserved, undefined dropped, null/0/false/"" preserved.
 *   - buildIdempotencyKey: returns null when any meta piece missing;
 *     populated otherwise.
 *   - formatProviderIdempotencyKey: colon-joined Stripe-style header value.
 *   - checkReplay: three exhaustive ReplayOutcomes.
 *     • no row → fresh
 *     • matching hash → cached (returns stored result_snapshot verbatim)
 *     • different hash → mismatch
 *   - recordFired: UNIQUE-violation (SQLSTATE 23505) is treated as no-op.
 *   - DB read errors fall back to fresh (don't wedge the run).
 *   - Per-handler integration tests live in __tests__/nodes/<handler>.test.ts.
 */

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}))

import { hashPayload, canonicalize } from '@/lib/workflows/actions/core/hashPayload'
import {
  buildIdempotencyKey,
  formatProviderIdempotencyKey,
  type SideEffectKey,
} from '@/lib/workflows/actions/core/idempotencyKey'
import {
  checkReplay,
  recordFired,
} from '@/lib/workflows/actions/core/sessionSideEffects'

// ─── In-memory Supabase stub ─────────────────────────────────────────────
//
// Mirrors the chain `.from('session_side_effects').select(...).eq(...)
// .eq(...).eq(...).maybeSingle()` and `.from(...).insert(...)`.

interface StubRow {
  execution_session_id: string
  /** PR-R1a — present on rows written under dual-write; optional so
   *  pre-rollout rows can be seeded for fallback-read tests. */
  root_execution_id?: string
  node_id: string
  action_type: string
  provider: string
  external_id: string | null
  result_snapshot: any
  payload_hash: string
}

function makeStubSupabase(rows: StubRow[] = []) {
  const captured = {
    inserts: [] as any[],
    insertError: null as { code?: string; message: string } | null,
    selectError: null as { message: string } | null,
  }

  const builderFor = (table: string) => {
    let pendingFilter: Partial<StubRow> = {}
    const builder: any = {
      select: () => builder,
      eq: (column: string, value: any) => {
        pendingFilter = { ...pendingFilter, [column]: value }
        return builder
      },
      maybeSingle: async () => {
        if (captured.selectError) {
          return { data: null, error: captured.selectError }
        }
        const found = rows.find((r) =>
          Object.entries(pendingFilter).every(
            ([k, v]) => (r as any)[k] === v,
          ),
        )
        return { data: found ?? null, error: null }
      },
      insert: async (row: any) => {
        captured.inserts.push({ table, row })
        if (captured.insertError) {
          return { data: null, error: captured.insertError }
        }
        const dup = rows.find(
          (r) =>
            r.execution_session_id === row.execution_session_id &&
            r.node_id === row.node_id &&
            r.action_type === row.action_type,
        )
        if (dup) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key' },
          }
        }
        rows.push(row)
        return { data: row, error: null }
      },
    }
    return builder
  }

  return {
    client: { from: builderFor },
    rows,
    captured,
  }
}

const KEY: SideEffectKey = {
  executionSessionId: 'session-1',
  rootExecutionId: 'session-1',  // PR-R1a: fresh runs have root === session
  nodeId: 'node-A',
  actionType: 'gmail_action_send_email',
}

const SAMPLE_RESULT = {
  success: true,
  output: { messageId: 'msg-123', threadId: 'thr-1' },
  message: 'Email sent successfully',
}

// ─── hashPayload + canonicalize ─────────────────────────────────────────

describe('hashPayload — Q4 canonicalization', () => {
  test('object-key insertion order does not affect the hash', () => {
    const a = { to: 'a@x.com', subject: 'S', body: 'B' }
    const b = { body: 'B', subject: 'S', to: 'a@x.com' }
    expect(hashPayload(a)).toBe(hashPayload(b))
  })

  test('nested-object key order does not affect the hash', () => {
    const a = { meta: { foo: 1, bar: 2 }, to: 'x' }
    const b = { to: 'x', meta: { bar: 2, foo: 1 } }
    expect(hashPayload(a)).toBe(hashPayload(b))
  })

  test('array order is preserved (different lists hash differently)', () => {
    const a = { to: ['a@x', 'b@x'] }
    const b = { to: ['b@x', 'a@x'] }
    expect(hashPayload(a)).not.toBe(hashPayload(b))
  })

  test('undefined values are dropped (matches JSON.stringify)', () => {
    const a = { to: 'x', cc: undefined }
    const b = { to: 'x' }
    expect(hashPayload(a)).toBe(hashPayload(b))
  })

  test('null / 0 / false / "" are preserved as distinct values (Q5)', () => {
    expect(hashPayload({ x: null })).not.toBe(hashPayload({}))
    expect(hashPayload({ x: 0 })).not.toBe(hashPayload({ x: null }))
    expect(hashPayload({ x: false })).not.toBe(hashPayload({ x: 0 }))
    expect(hashPayload({ x: '' })).not.toBe(hashPayload({ x: null }))
  })

  test('canonicalize sorts object keys recursively', () => {
    const out = canonicalize({ b: { y: 2, x: 1 }, a: 1 })
    // String comparison rather than parsing — confirms exact sorted form.
    expect(out).toBe('{"a":1,"b":{"x":1,"y":2}}')
  })

  test('non-finite numbers coerce to null (matches JSON.stringify)', () => {
    expect(hashPayload({ x: NaN })).toBe(hashPayload({ x: null }))
    expect(hashPayload({ x: Infinity })).toBe(hashPayload({ x: null }))
  })

  test('hash output is hex SHA-256 (64 chars)', () => {
    expect(hashPayload({ a: 1 })).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ─── buildIdempotencyKey ────────────────────────────────────────────────

describe('buildIdempotencyKey — Q4 meta gate', () => {
  test('returns the key when all three pieces are present (no lineage → root falls back to session)', () => {
    const key = buildIdempotencyKey({
      executionSessionId: 'session-1',
      nodeId: 'node-A',
      actionType: 'gmail_action_send_email',
    })
    expect(key).toEqual({
      executionSessionId: 'session-1',
      rootExecutionId: 'session-1',
      nodeId: 'node-A',
      actionType: 'gmail_action_send_email',
    })
  })

  test('returns null when meta is undefined (no-op idempotency)', () => {
    expect(buildIdempotencyKey(undefined)).toBeNull()
  })

  test('returns null when executionSessionId is missing', () => {
    expect(
      buildIdempotencyKey({ nodeId: 'n', actionType: 't' }),
    ).toBeNull()
  })

  test('returns null when nodeId is missing', () => {
    expect(
      buildIdempotencyKey({ executionSessionId: 's', actionType: 't' }),
    ).toBeNull()
  })

  test('returns null when actionType is missing', () => {
    expect(
      buildIdempotencyKey({ executionSessionId: 's', nodeId: 'n' }),
    ).toBeNull()
  })

  test('returns null on empty-string pieces (a non-finite session id is not a session)', () => {
    expect(
      buildIdempotencyKey({
        executionSessionId: '',
        nodeId: 'n',
        actionType: 't',
      }),
    ).toBeNull()
  })
})

describe('buildIdempotencyKey — PR-R1a retry lineage', () => {
  test('rootExecutionId is preserved when supplied (retry case)', () => {
    const key = buildIdempotencyKey({
      executionSessionId: 'retry-session-2',
      rootExecutionId: 'original-session-1',
      nodeId: 'node-A',
      actionType: 'stripe_action_create_payment_intent',
    })
    expect(key).toEqual({
      executionSessionId: 'retry-session-2',
      rootExecutionId: 'original-session-1',
      nodeId: 'node-A',
      actionType: 'stripe_action_create_payment_intent',
    })
  })

  test('rootExecutionId falls back to executionSessionId when missing or empty', () => {
    const supplied = buildIdempotencyKey({
      executionSessionId: 'session-1',
      rootExecutionId: '',
      nodeId: 'node-A',
      actionType: 'gmail_action_send_email',
    })
    const omitted = buildIdempotencyKey({
      executionSessionId: 'session-1',
      nodeId: 'node-A',
      actionType: 'gmail_action_send_email',
    })
    expect(supplied?.rootExecutionId).toBe('session-1')
    expect(omitted?.rootExecutionId).toBe('session-1')
    expect(supplied).toEqual(omitted)
  })
})

describe('formatProviderIdempotencyKey — Stripe-header form', () => {
  test('renders the colon-joined string from rootExecutionId', () => {
    expect(formatProviderIdempotencyKey(KEY)).toBe(
      'session-1:node-A:gmail_action_send_email',
    )
  })

  test('uses rootExecutionId, not executionSessionId, on retries', () => {
    // A retry session: session id is new (retry-session-2), but root
    // points back to the original. Stripe header uses root → header
    // value matches the original run's, so Stripe's server-side dedup
    // rejects the retry's API call.
    const retryKey: SideEffectKey = {
      executionSessionId: 'retry-session-2',
      rootExecutionId: 'original-session-1',
      nodeId: 'node-A',
      actionType: 'stripe_action_create_payment_intent',
    }
    expect(formatProviderIdempotencyKey(retryKey)).toBe(
      'original-session-1:node-A:stripe_action_create_payment_intent',
    )
  })

  test('header value is identical for fresh-run pre-PR-R1a callers (no behavior change)', () => {
    // Caller threads only executionSessionId (no rootExecutionId).
    // Builder fills root from session. Header value matches what the
    // pre-PR-R1a code produced.
    const key = buildIdempotencyKey({
      executionSessionId: 'session-1',
      nodeId: 'node-A',
      actionType: 'stripe_action_create_payment_intent',
    })!
    expect(formatProviderIdempotencyKey(key)).toBe(
      'session-1:node-A:stripe_action_create_payment_intent',
    )
  })
})

// ─── checkReplay ────────────────────────────────────────────────────────

describe('checkReplay — Q4 three exhaustive outcomes', () => {
  test('no row → fresh', async () => {
    const stub = makeStubSupabase()
    const out = await checkReplay(KEY, 'hash-1', { supabase: stub.client })
    expect(out).toEqual({ kind: 'fresh' })
  })

  test('matching hash → cached (returns stored result_snapshot verbatim)', async () => {
    const stub = makeStubSupabase([
      {
        execution_session_id: KEY.executionSessionId,
        root_execution_id: KEY.rootExecutionId,
        node_id: KEY.nodeId,
        action_type: KEY.actionType,
        provider: 'gmail',
        external_id: 'msg-123',
        result_snapshot: SAMPLE_RESULT,
        payload_hash: 'hash-1',
      },
    ])

    const out = await checkReplay(KEY, 'hash-1', { supabase: stub.client })
    expect(out.kind).toBe('cached')
    if (out.kind === 'cached') {
      // Identity-equal to the stored snapshot — handlers return it verbatim
      // so downstream nodes see the same shape they would have on the
      // original run.
      expect(out.result).toEqual(SAMPLE_RESULT)
    }
  })

  test('different hash → mismatch (handler converts to PAYLOAD_MISMATCH)', async () => {
    const stub = makeStubSupabase([
      {
        execution_session_id: KEY.executionSessionId,
        root_execution_id: KEY.rootExecutionId,
        node_id: KEY.nodeId,
        action_type: KEY.actionType,
        provider: 'gmail',
        external_id: null,
        result_snapshot: SAMPLE_RESULT,
        payload_hash: 'hash-original',
      },
    ])

    const out = await checkReplay(KEY, 'hash-different', {
      supabase: stub.client,
    })
    expect(out).toEqual({ kind: 'mismatch', storedHash: 'hash-original' })
  })

  test('DB read error falls back to fresh (do not wedge the run)', async () => {
    const stub = makeStubSupabase()
    stub.captured.selectError = { message: 'connection lost' }

    const out = await checkReplay(KEY, 'hash-1', { supabase: stub.client })
    expect(out).toEqual({ kind: 'fresh' })
  })
})

// ─── checkReplay — PR-R1a retry-lineage reads + fallback ───────────────

describe('checkReplay — PR-R1a lineage read', () => {
  // A retry: new session id, root points back at the original.
  const RETRY_KEY: SideEffectKey = {
    executionSessionId: 'retry-session-2',
    rootExecutionId: 'original-session-1',
    nodeId: 'node-A',
    actionType: 'stripe_action_create_payment_intent',
  }

  test('finds the original-run row via root_execution_id (cross-session dedup)', async () => {
    // Original run wrote this marker. Retry comes through with a new
    // session id but inherited root.
    const stub = makeStubSupabase([
      {
        execution_session_id: 'original-session-1',
        root_execution_id: 'original-session-1',
        node_id: 'node-A',
        action_type: 'stripe_action_create_payment_intent',
        provider: 'stripe',
        external_id: 'pi_123',
        result_snapshot: SAMPLE_RESULT,
        payload_hash: 'hash-charge',
      },
    ])

    const out = await checkReplay(RETRY_KEY, 'hash-charge', {
      supabase: stub.client,
    })
    expect(out.kind).toBe('cached')
  })

  test('falls back to execution_session_id read for pre-rollout rows', async () => {
    const { logger } = require('@/lib/utils/logger')
    // Pre-rollout row: only execution_session_id populated. Lineage root
    // matches the row's execution_session_id, but root_execution_id is
    // absent (pre-Phase-1 dual-write).
    const stub = makeStubSupabase([
      {
        execution_session_id: 'original-session-1',
        // root_execution_id intentionally absent — pre-rollout shape.
        node_id: 'node-A',
        action_type: 'stripe_action_create_payment_intent',
        provider: 'stripe',
        external_id: 'pi_legacy',
        result_snapshot: SAMPLE_RESULT,
        payload_hash: 'hash-legacy',
      },
    ])

    const out = await checkReplay(RETRY_KEY, 'hash-legacy', {
      supabase: stub.client,
    })
    expect(out.kind).toBe('cached')
    // Structured log fired so PR-R1b can gate on a zero count.
    expect(logger.warn).toHaveBeenCalledWith(
      'q4_lineage_fallback_hit',
      expect.objectContaining({
        executionSessionId: 'retry-session-2',
        rootExecutionId: 'original-session-1',
        nodeId: 'node-A',
        actionType: 'stripe_action_create_payment_intent',
      }),
    )
  })

  test('fresh-run gap-window replay: same-session row with NULL root is found via fallback', async () => {
    const { logger } = require('@/lib/utils/logger')
    ;(logger.warn as jest.Mock).mockClear()

    // Same-session replay (e.g. engine restart). KEY has root === session.
    // The seeded row predates dual-write — execution_session_id set, root NULL.
    const stub = makeStubSupabase([
      {
        execution_session_id: KEY.executionSessionId,
        // root_execution_id intentionally absent — pre-rollout shape.
        node_id: KEY.nodeId,
        action_type: KEY.actionType,
        provider: 'gmail',
        external_id: 'msg-gap',
        result_snapshot: SAMPLE_RESULT,
        payload_hash: 'hash-gap',
      },
    ])

    const out = await checkReplay(KEY, 'hash-gap', { supabase: stub.client })
    expect(out.kind).toBe('cached')
    // Fallback log fires — even fresh runs need the safety net during the
    // dual-write gap window.
    expect(logger.warn).toHaveBeenCalledWith(
      'q4_lineage_fallback_hit',
      expect.objectContaining({
        executionSessionId: KEY.executionSessionId,
        rootExecutionId: KEY.rootExecutionId,
      }),
    )
  })

  test('no row in either index → fresh, no fallback log emitted', async () => {
    const { logger } = require('@/lib/utils/logger')
    ;(logger.warn as jest.Mock).mockClear()

    const stub = makeStubSupabase()
    const out = await checkReplay(KEY, 'hash-1', { supabase: stub.client })

    expect(out).toEqual({ kind: 'fresh' })
    expect(logger.warn).not.toHaveBeenCalledWith(
      'q4_lineage_fallback_hit',
      expect.anything(),
    )
  })

  test('truly fresh on retry: primary misses, fallback misses, returns fresh', async () => {
    const stub = makeStubSupabase()
    const out = await checkReplay(RETRY_KEY, 'hash-charge', {
      supabase: stub.client,
    })
    expect(out).toEqual({ kind: 'fresh' })
  })

  test('row exists with mismatching hash → mismatch (read by root)', async () => {
    const stub = makeStubSupabase([
      {
        execution_session_id: 'original-session-1',
        root_execution_id: 'original-session-1',
        node_id: 'node-A',
        action_type: 'stripe_action_create_payment_intent',
        provider: 'stripe',
        external_id: 'pi_123',
        result_snapshot: SAMPLE_RESULT,
        payload_hash: 'hash-original',
      },
    ])

    const out = await checkReplay(RETRY_KEY, 'hash-different', {
      supabase: stub.client,
    })
    expect(out).toEqual({ kind: 'mismatch', storedHash: 'hash-original' })
  })
})

// ─── recordFired ────────────────────────────────────────────────────────

describe('recordFired — Q4 write semantics', () => {
  test('inserts a row with the supplied payload_hash and result_snapshot', async () => {
    const stub = makeStubSupabase()

    await recordFired(KEY, SAMPLE_RESULT, 'hash-1', {
      supabase: stub.client,
      provider: 'gmail',
      externalId: 'msg-123',
    })

    expect(stub.captured.inserts).toHaveLength(1)
    const insertedRow = stub.captured.inserts[0].row
    expect(insertedRow).toMatchObject({
      execution_session_id: KEY.executionSessionId,
      root_execution_id: KEY.rootExecutionId,  // PR-R1a — dual-write
      node_id: KEY.nodeId,
      action_type: KEY.actionType,
      provider: 'gmail',
      external_id: 'msg-123',
      payload_hash: 'hash-1',
      result_snapshot: SAMPLE_RESULT,
    })
  })

  test('PR-R1a dual-write: a retry-context fire writes both id columns with different values', async () => {
    const stub = makeStubSupabase()
    const retryKey: SideEffectKey = {
      executionSessionId: 'retry-session-2',
      rootExecutionId: 'original-session-1',
      nodeId: 'node-A',
      actionType: 'stripe_action_create_payment_intent',
    }
    await recordFired(retryKey, SAMPLE_RESULT, 'hash-charge', {
      supabase: stub.client,
      provider: 'stripe',
      externalId: 'pi_456',
    })
    const row = stub.captured.inserts[0].row
    expect(row.execution_session_id).toBe('retry-session-2')
    expect(row.root_execution_id).toBe('original-session-1')
  })

  test('UNIQUE-violation (23505) is swallowed as no-op (concurrent fire wins)', async () => {
    // Pre-seed a row so the stub produces a 23505 on insert.
    const stub = makeStubSupabase([
      {
        execution_session_id: KEY.executionSessionId,
        node_id: KEY.nodeId,
        action_type: KEY.actionType,
        provider: 'gmail',
        external_id: null,
        result_snapshot: SAMPLE_RESULT,
        payload_hash: 'hash-1',
      },
    ])

    await expect(
      recordFired(KEY, SAMPLE_RESULT, 'hash-1', { supabase: stub.client }),
    ).resolves.toBeUndefined()
  })

  test('non-unique DB error is logged but not re-thrown (provider call already succeeded)', async () => {
    const stub = makeStubSupabase()
    stub.captured.insertError = { code: '08006', message: 'connection lost' }

    await expect(
      recordFired(KEY, SAMPLE_RESULT, 'hash-1', { supabase: stub.client }),
    ).resolves.toBeUndefined()
  })

  test('derives provider from action_type prefix when not supplied', async () => {
    const stub = makeStubSupabase()
    await recordFired(
      { ...KEY, actionType: 'stripe_action_create_payment_intent' },
      SAMPLE_RESULT,
      'hash-1',
      { supabase: stub.client },
    )
    expect(stub.captured.inserts[0].row.provider).toBe('stripe')
  })

  test('externalId defaults to null when omitted', async () => {
    const stub = makeStubSupabase()
    await recordFired(KEY, SAMPLE_RESULT, 'hash-1', {
      supabase: stub.client,
      provider: 'gmail',
    })
    expect(stub.captured.inserts[0].row.external_id).toBeNull()
  })
})
