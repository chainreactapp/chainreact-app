/**
 * Contract: PR-R1a, commit 4 — engine writes retry-lineage and workflow
 * definition fingerprint on session creation.
 *
 * Source: lib/execution/sessionLineage.ts (pure helpers extracted from
 * AdvancedExecutionEngine.createExecutionSession)
 *
 * What this file proves:
 *   - Fresh runs: `root_execution_id === id`. Resolved entirely from the
 *     new session id; no DB lookup performed.
 *   - Retry runs: helper reads `original.root_execution_id` and propagates
 *     it. Retry-of-a-retry inherits the same root (lineage stable across
 *     N attempts).
 *   - Retry runs against pre-Phase-0 sessions (root NULL): falls back to
 *     using `retryOf` itself as the root.
 *   - Retry runs where the original is missing entirely: falls back to
 *     using `retryOf`. Run still proceeds.
 *   - Retry runs where the lookup query errors: falls back, run proceeds.
 *   - `workflow_definition_hash` is computed from `workflowData` when
 *     present; null when absent or malformed.
 *   - Volatile UI fields in workflowData do not affect the hash (engine
 *     wires through to the same canonicalization the dedicated hash
 *     helper enforces — `workflowDefinitionHash.test.ts` covers the
 *     exhaustive UI-field exclusion list).
 *
 * Plan: learning/docs/safe-resume-from-failed-node-implementation-plan.md
 */

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}))

import {
  resolveRootExecutionId,
  computeWorkflowDefinitionHash,
} from '@/lib/execution/sessionLineage'
import { hashWorkflowDefinition } from '@/lib/workflows/workflowDefinitionHash'

const NEW_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ORIGINAL_ID = '22222222-2222-2222-2222-222222222222'
const ORIGINAL_ROOT = '11111111-1111-1111-1111-111111111111'

const fixedRoot = (root: string | null) =>
  jest.fn(async (_id: string) => ({ root, error: null }))

const lookupError = (message: string) =>
  jest.fn(async (_id: string) => ({ root: null, error: { message } }))

// ─── resolveRootExecutionId — fresh runs ──────────────────────────────

describe('resolveRootExecutionId — fresh run (no retryOf)', () => {
  test('returns the new session id; no lookup is performed', async () => {
    const lookup = fixedRoot('should-not-be-used')
    const root = await resolveRootExecutionId({
      newSessionId: NEW_ID,
      lookupOriginalRoot: lookup,
    })
    expect(root).toBe(NEW_ID)
    expect(lookup).not.toHaveBeenCalled()
  })

  test('handles undefined retryOf identically to omitted', async () => {
    const lookup = fixedRoot('x')
    const root = await resolveRootExecutionId({
      newSessionId: NEW_ID,
      retryOf: undefined,
      lookupOriginalRoot: lookup,
    })
    expect(root).toBe(NEW_ID)
    expect(lookup).not.toHaveBeenCalled()
  })

  test('handles empty-string retryOf as fresh', async () => {
    const lookup = fixedRoot('x')
    const root = await resolveRootExecutionId({
      newSessionId: NEW_ID,
      retryOf: '',
      lookupOriginalRoot: lookup,
    })
    expect(root).toBe(NEW_ID)
    expect(lookup).not.toHaveBeenCalled()
  })
})

// ─── resolveRootExecutionId — retry runs ──────────────────────────────

describe('resolveRootExecutionId — retry / resume', () => {
  test('inherits original.root_execution_id when populated', async () => {
    const lookup = fixedRoot(ORIGINAL_ROOT)
    const root = await resolveRootExecutionId({
      newSessionId: NEW_ID,
      retryOf: ORIGINAL_ID,
      lookupOriginalRoot: lookup,
    })
    expect(root).toBe(ORIGINAL_ROOT)
    expect(lookup).toHaveBeenCalledWith(ORIGINAL_ID)
  })

  test('retry-of-a-retry inherits the same root (lineage stable across attempts)', async () => {
    // Imagine: original (root=A) → retry-1 (root=A) → retry-2 (this call).
    // retryOf points at retry-1, whose root is A. Result must be A.
    const lookup = fixedRoot(ORIGINAL_ROOT)
    const root = await resolveRootExecutionId({
      newSessionId: NEW_ID,
      retryOf: ORIGINAL_ID,
      lookupOriginalRoot: lookup,
    })
    expect(root).toBe(ORIGINAL_ROOT)
  })

  test('falls back to retryOf when original predates Phase 0 (root NULL)', async () => {
    const lookup = fixedRoot(null)
    const root = await resolveRootExecutionId({
      newSessionId: NEW_ID,
      retryOf: ORIGINAL_ID,
      lookupOriginalRoot: lookup,
    })
    expect(root).toBe(ORIGINAL_ID)
  })

  test('falls back to retryOf when the original row cannot be found', async () => {
    // Lookup returns root=null and no error — same shape as "no row".
    const lookup = fixedRoot(null)
    const root = await resolveRootExecutionId({
      newSessionId: NEW_ID,
      retryOf: ORIGINAL_ID,
      lookupOriginalRoot: lookup,
    })
    expect(root).toBe(ORIGINAL_ID)
  })

  test('falls back to retryOf and continues when the lookup query errors', async () => {
    const lookup = lookupError('connection lost')
    const root = await resolveRootExecutionId({
      newSessionId: NEW_ID,
      retryOf: ORIGINAL_ID,
      lookupOriginalRoot: lookup,
    })
    expect(root).toBe(ORIGINAL_ID)
  })

  test('does not blow up when retryOf is supplied but newSessionId is also valid', async () => {
    // Sanity: retry path must not accidentally use newSessionId.
    const lookup = fixedRoot(ORIGINAL_ROOT)
    const root = await resolveRootExecutionId({
      newSessionId: NEW_ID,
      retryOf: ORIGINAL_ID,
      lookupOriginalRoot: lookup,
    })
    expect(root).not.toBe(NEW_ID)
  })
})

// ─── computeWorkflowDefinitionHash ─────────────────────────────────────

describe('computeWorkflowDefinitionHash', () => {
  test('returns the workflow hash when nodes/edges are present', () => {
    const wd = {
      nodes: [{ id: 'n1', type: 't1', config: { x: 1 } }],
      edges: [],
    }
    expect(computeWorkflowDefinitionHash(wd)).toBe(hashWorkflowDefinition(wd))
  })

  test('returns null when workflowData is undefined', () => {
    expect(computeWorkflowDefinitionHash(undefined)).toBeNull()
  })

  test('returns null when workflowData is null', () => {
    expect(computeWorkflowDefinitionHash(null)).toBeNull()
  })

  test('returns null when workflowData is not an object', () => {
    expect(computeWorkflowDefinitionHash('not-an-object')).toBeNull()
    expect(computeWorkflowDefinitionHash(42)).toBeNull()
  })

  test('returns null when hashing throws (cyclic structure)', () => {
    const cyclicNodes: any[] = [{ id: 'n1', type: 't1' }]
    cyclicNodes[0].self = cyclicNodes[0]
    const wd = { nodes: cyclicNodes, edges: [] }
    expect(computeWorkflowDefinitionHash(wd)).toBeNull()
  })

  test('volatile UI fields do not affect the engine-persisted hash', () => {
    const noisy = {
      nodes: [
        {
          id: 'n1',
          type: 't1',
          config: { x: 1 },
          position: { x: 999, y: 999 },
          selected: true,
          dragging: true,
        },
      ],
      edges: [],
    }
    const clean = {
      nodes: [{ id: 'n1', type: 't1', config: { x: 1 } }],
      edges: [],
    }
    expect(computeWorkflowDefinitionHash(noisy)).toBe(
      computeWorkflowDefinitionHash(clean),
    )
  })

  test('accepts the legacy `connections` field as an alias for `edges`', () => {
    const a = {
      nodes: [{ id: 'n1', type: 't1' }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    }
    const b = {
      nodes: [{ id: 'n1', type: 't1' }],
      connections: [{ id: 'e1', source: 'n1', target: 'n2' }],
    }
    expect(computeWorkflowDefinitionHash(a)).toBe(
      computeWorkflowDefinitionHash(b),
    )
  })
})
