/**
 * Idempotency key construction for cross-session side-effect dedup
 * (PR-C4 → PR-R1a).
 *
 * The handler-execution metadata threaded through the engine into each
 * action handler is the source of truth. `(rootExecutionId, nodeId,
 * actionType)` identifies a single side effect within a logical run —
 * the SAME triple appears for the original run and any of its retries
 * or resumes (because they share the lineage root).
 *
 * `buildIdempotencyKey(meta)` returns:
 *   - a populated `SideEffectKey` when `executionSessionId`, `nodeId`,
 *     and `actionType` are all present,
 *   - `null` when any piece is missing (test-only paths or non-engine
 *     callers — handlers MUST treat this as a no-op idempotency case
 *     and skip the replay/record dance entirely).
 *
 * `rootExecutionId` falls back to `executionSessionId` when not
 * supplied — fresh non-retry runs naturally have root === session, so
 * older callers that haven't been updated to thread lineage continue
 * to work without behavior change.
 *
 * Stripe's `Idempotency-Key` header uses the same key, formatted as
 * `${rootExecutionId}:${nodeId}:${actionType}` — stable across all
 * retries of the same logical run, so Stripe's server-side dedup
 * window correctly rejects a retry's repeated charge.
 *
 * Contract: see `learning/docs/handler-contracts.md` Q4 and
 * `learning/docs/session-side-effects-design.md` §3.
 * Lineage rationale: `learning/docs/safe-resume-from-failed-node-implementation-plan.md`.
 */

/**
 * Engine-thread metadata passed alongside `(config, userId, input)` to
 * every action handler. All fields optional — handlers run normally
 * when meta is absent (test-only paths) but skip the idempotency
 * checks.
 */
export interface HandlerExecutionMeta {
  executionSessionId?: string
  /**
   * Retry-lineage root (PR-R1a). For a fresh run, equals
   * executionSessionId. For a retry/resume, equals the originating
   * run's executionSessionId. Persisted on
   * `workflow_execution_sessions.root_execution_id`.
   *
   * Optional for backward compatibility: callers (and tests) that
   * have not been updated to thread lineage continue to work —
   * `buildIdempotencyKey` falls back to `executionSessionId` so the
   * key's `rootExecutionId` is always populated.
   */
  rootExecutionId?: string
  nodeId?: string
  actionType?: string
  provider?: string
  testMode?: boolean
  // PR-G1 (Q12) — workspace tier of timezone / locale resolution. Engine
  // populates this from `ExecutionContext.workspaceId`, which itself is
  // populated from `workflows.workspace_id` at workflow load time. Helpers
  // pass it to `resolveTimezone` / `resolveLocale`.
  workspaceId?: string
}

export interface SideEffectKey {
  executionSessionId: string
  /**
   * Always populated. Equals `executionSessionId` for fresh runs (the
   * builder fills it in from session id when meta does not supply
   * lineage). Differs only on retries and resumes — there it equals
   * the originating run's session id.
   */
  rootExecutionId: string
  nodeId: string
  actionType: string
}

/**
 * Build a `SideEffectKey` from handler execution metadata. Returns
 * `null` when the metadata can't identify a unique side effect (any
 * of executionSessionId / nodeId / actionType missing or empty).
 *
 * `rootExecutionId` defaults to `executionSessionId` when meta does
 * not supply it. The resulting key always has both fields populated.
 *
 * Handlers branch on the null return:
 *   const key = buildIdempotencyKey(meta)
 *   if (!key) {
 *     // No idempotency — fire normally.
 *   } else {
 *     // checkReplay → fire/cached/mismatch → recordFired
 *   }
 */
export function buildIdempotencyKey(
  meta: HandlerExecutionMeta | undefined,
): SideEffectKey | null {
  if (!meta) return null
  const { executionSessionId, rootExecutionId, nodeId, actionType } = meta
  if (!executionSessionId || !nodeId || !actionType) return null
  return {
    executionSessionId,
    rootExecutionId: rootExecutionId || executionSessionId,
    nodeId,
    actionType,
  }
}

/**
 * Render a `SideEffectKey` as the colon-joined string used for
 * provider-side idempotency headers (Stripe `Idempotency-Key`, etc.).
 *
 * Uses `rootExecutionId` so the header value is stable across retries
 * and resumes of the same logical run. For fresh non-retry runs, this
 * value matches the pre-PR-R1a shape (root === session) — no behavior
 * change at the provider boundary.
 */
export function formatProviderIdempotencyKey(key: SideEffectKey): string {
  return `${key.rootExecutionId}:${key.nodeId}:${key.actionType}`
}
