/**
 * Cross-session idempotency registry (PR-C4 → PR-R1a, Q4).
 *
 * Keyed on `SideEffectKey` `(executionSessionId, rootExecutionId,
 * nodeId, actionType)`. Reads use `(rootExecutionId, nodeId, actionType)`
 * so retries and resumes that share a lineage root see each other's
 * marker rows. Writes dual-write both id columns during the read-
 * fallback window (see below).
 *
 * Two functions:
 *
 *   - `checkReplay(key, payloadHash)` — atomic read of any prior row.
 *     Returns `{kind: 'fresh'}` (no row, fire normally),
 *     `{kind: 'cached', result}` (matching hash, return cached
 *     ActionResult and skip the provider call), or
 *     `{kind: 'mismatch', storedHash}` (different hash, handler must
 *     return PAYLOAD_MISMATCH).
 *
 *     Read sequence (PR-R1a):
 *       1. Try `(root_execution_id, node_id, action_type)`.
 *       2. If no row, fall back to
 *          `(execution_session_id, node_id, action_type)` to catch
 *          rows written between Phase 0 (column added) and Phase 1
 *          (this commit, dual-write enabled). Emit
 *          `q4_lineage_fallback_hit` so the cleanup PR (PR-R1b) can
 *          gate on zero hits.
 *
 *   - `recordFired(key, result, payloadHash, options?)` — write the
 *     marker after a successful first fire. Idempotent on its own:
 *     a UNIQUE-violation is caught and treated as already-recorded,
 *     so a concurrent fire that loses the unique-constraint race
 *     doesn't error.
 *
 *     Write (PR-R1a): always populates BOTH `execution_session_id`
 *     and `root_execution_id`. The UNIQUE constraint on
 *     `(execution_session_id, node_id, action_type)` still holds
 *     during the dual-write window; PR-R1b will swap it for a
 *     UNIQUE on the lineage tuple once the fallback log is silent.
 *
 * Both calls go through the service-role admin client. Failures are
 * conservative:
 *   - `checkReplay` failure → returns `{kind: 'fresh'}` (fire
 *     normally — better to risk a duplicate than to wedge the run).
 *     Logged at error level.
 *   - `recordFired` failure → swallowed with an error log, NOT
 *     re-thrown. The provider call already succeeded; rolling it
 *     back is impossible (design doc §4.3).
 *
 * Failed previous fires (rows where `result_snapshot.success === false`)
 * are NOT written by `recordFired` — handlers only call it on success.
 * A retry after a failed first attempt therefore sees `{kind: 'fresh'}`
 * and re-attempts the provider call, as intended.
 *
 * Contract: see `learning/docs/handler-contracts.md` Q4 and
 * `learning/docs/session-side-effects-design.md` §3.
 * Lineage rationale: `learning/docs/safe-resume-from-failed-node-implementation-plan.md`.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/utils/logger'
import type { ActionResult } from './executeWait'
import type { SideEffectKey } from './idempotencyKey'

const TABLE = 'session_side_effects'

export type ReplayOutcome =
  | { kind: 'fresh' }
  | { kind: 'cached'; result: ActionResult }
  | { kind: 'mismatch'; storedHash: string }

export interface RecordFiredOptions {
  externalId?: string | null
  provider?: string
  /**
   * Optional Supabase client. Defaults to the admin client. Tests
   * inject a stub.
   */
  supabase?: any
}

export interface CheckReplayOptions {
  supabase?: any
}

/**
 * Atomically read the existing marker for `key` and compare its
 * stored hash to `payloadHash`. See `ReplayOutcome` for the three
 * exhaustive return shapes.
 *
 * Read sequence (PR-R1a): root_execution_id → execution_session_id
 * fallback. The fallback path catches rows written between Phase 0
 * deploy (column added) and Phase 1 deploy (dual-write enabled) —
 * those rows have only execution_session_id populated. Each
 * fallback hit emits `q4_lineage_fallback_hit` so PR-R1b can gate
 * on a zero count over the observation window.
 */
export async function checkReplay(
  key: SideEffectKey,
  payloadHash: string,
  options: CheckReplayOptions = {},
): Promise<ReplayOutcome> {
  try {
    const supabase = options.supabase ?? createAdminClient()

    // Primary read: by retry-lineage root.
    const primary = await supabase
      .from(TABLE)
      .select('payload_hash, result_snapshot')
      .eq('root_execution_id', key.rootExecutionId)
      .eq('node_id', key.nodeId)
      .eq('action_type', key.actionType)
      .maybeSingle()

    if (primary.error) {
      logger.error(
        '[sessionSideEffects.checkReplay] root-keyed DB read failed; falling back to fresh',
        { error: primary.error.message, key },
      )
      return { kind: 'fresh' }
    }

    let data: any = primary.data

    // Fallback read (PR-R1a, removed in PR-R1b): by execution_session_id
    // = root, for rows written before dual-write rolled out. Pre-rollout
    // rows have root_execution_id NULL but execution_session_id = the
    // run's own id, which is precisely what we passed as `rootExecutionId`
    // in the key (lineage anchors at the originating session). The
    // fallback runs even when root === session because a fresh run can
    // also have a pre-rollout marker for itself (engine restart in the
    // gap window).
    if (!data) {
      const fallback = await supabase
        .from(TABLE)
        .select('payload_hash, result_snapshot')
        .eq('execution_session_id', key.rootExecutionId)
        .eq('node_id', key.nodeId)
        .eq('action_type', key.actionType)
        .maybeSingle()

      if (fallback.error) {
        logger.error(
          '[sessionSideEffects.checkReplay] session-id fallback read failed; treating as fresh',
          { error: fallback.error.message, key },
        )
        return { kind: 'fresh' }
      }

      if (fallback.data) {
        // Structured log line so a dashboard / alert can gate PR-R1b
        // (drop the fallback path) on this counter staying at zero.
        logger.warn('q4_lineage_fallback_hit', {
          executionSessionId: key.executionSessionId,
          rootExecutionId: key.rootExecutionId,
          nodeId: key.nodeId,
          actionType: key.actionType,
        })
        data = fallback.data
      }
    }

    if (!data) return { kind: 'fresh' }

    if (data.payload_hash !== payloadHash) {
      return { kind: 'mismatch', storedHash: data.payload_hash }
    }

    return { kind: 'cached', result: data.result_snapshot as ActionResult }
  } catch (err: any) {
    logger.error(
      '[sessionSideEffects.checkReplay] threw; falling back to fresh',
      { error: err?.message, key },
    )
    return { kind: 'fresh' }
  }
}

/**
 * Record a successful side effect. UNIQUE-violation on the
 * (executionSessionId, nodeId, actionType) tuple is treated as
 * already-recorded — the row from the first fire wins, this call is
 * a no-op. All other DB errors are logged but NOT re-thrown: the
 * provider call already succeeded, so failing the handler here would
 * cause the next replay to re-fire the side effect (worse than the
 * lost record).
 */
export async function recordFired(
  key: SideEffectKey,
  result: ActionResult,
  payloadHash: string,
  options: RecordFiredOptions = {},
): Promise<void> {
  try {
    const supabase = options.supabase ?? createAdminClient()
    const provider =
      options.provider ?? deriveProviderFromActionType(key.actionType)

    // PR-R1a — dual-write: populate both id columns. The UNIQUE constraint
    // is still on `(execution_session_id, node_id, action_type)` during
    // this window; PR-R1b will swap it for the lineage tuple once the
    // q4_lineage_fallback_hit counter is silent.
    const row = {
      execution_session_id: key.executionSessionId,
      root_execution_id: key.rootExecutionId,
      node_id: key.nodeId,
      action_type: key.actionType,
      provider,
      external_id: options.externalId ?? null,
      result_snapshot: result,
      payload_hash: payloadHash,
    }

    const { error } = await supabase.from(TABLE).insert(row)

    if (error) {
      // Postgres UNIQUE-violation: SQLSTATE 23505. Supabase surfaces this
      // as `code: '23505'` on the error object. Treat as already-recorded.
      const code = (error as any)?.code
      if (code === '23505') {
        logger.debug(
          '[sessionSideEffects.recordFired] row already exists (UNIQUE) — treating as no-op',
          { key },
        )
        return
      }
      logger.error('[sessionSideEffects.recordFired] DB write failed', {
        error: error.message,
        code,
        key,
      })
    }
  } catch (err: any) {
    logger.error('[sessionSideEffects.recordFired] threw', {
      error: err?.message,
      key,
    })
  }
}

/**
 * Best-effort provider extraction from an action type identifier.
 * `gmail_action_send_email` → `gmail`, `stripe_action_create_payment_intent`
 * → `stripe`, etc. Falls back to `'unknown'` for unrecognized shapes.
 *
 * Callers can override via `options.provider` when they have direct
 * knowledge (e.g. the handler already loaded the integration row).
 */
function deriveProviderFromActionType(actionType: string): string {
  const idx = actionType.indexOf('_')
  if (idx <= 0) return actionType || 'unknown'
  return actionType.slice(0, idx)
}
