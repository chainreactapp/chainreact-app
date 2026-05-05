/**
 * Phase 3 of v2 canonical engine plan (PR-V2-FLAG) —
 * dispatch decision: v1 (AdvancedExecutionEngine) vs v2
 * (WorkflowExecutionService) for live / sequential execution.
 *
 * Pure helper — no side effects, no DB. Caller resolves the inputs
 * (env flag + per-user opt-in) and passes them in. Caller logs the
 * returned `log` object so engine selection is observable in
 * production rollout dashboards.
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md
 */
export interface V2DispatchInput {
  /**
   * The mode the caller was asked to run in.
   *
   * Live-eligible modes — gated by flag + opt-in:
   *   - `'live'` / `'sequential'` — manual / direct execution (PR-V2-FLAG)
   *   - `'webhook'` — webhook-triggered execution (PR-V2-WEBHOOKS)
   *   - `'scheduled'` — cron-triggered execution (PR-V2-CRON, forward-looking)
   *
   * Non-live modes — always v2 sandbox path:
   *   - `'sandbox'` / anything else — sandbox / test runs are unaffected
   *     by the flag and always go through v2's existing sandbox path
   */
  executionMode: 'live' | 'sequential' | 'webhook' | 'scheduled' | 'sandbox' | string
  /** `FEATURE_FLAGS.V2_LIVE_EXECUTION` (env-controlled kill switch). */
  flagEnabled: boolean
  /**
   * `user_profiles.opt_in_v2_execution` for the workflow owner.
   * Settable by super_admin during rollout. Conservatively defaults to
   * `false` on lookup error (caller's responsibility).
   */
  userOptedIn: boolean
}

export interface V2DispatchDecision {
  /**
   * True only when live/sequential dispatch should target v2. False for:
   *   - non-live modes (sandbox always uses v2's sandbox path; this flag
   *     governs the live-execution port specifically)
   *   - live/sequential when either gate is missing
   */
  useV2: boolean
  /**
   * Structured log payload — caller passes verbatim to
   * `logger.info(..., decision.log)` so every workflow execution lands
   * one row with the engine choice. Rollout dashboards aggregate on
   * `executionEngine` to track v1 → v2 share.
   *
   * `executionEngine` reflects what actually ran:
   *   - `'v2'` when the run goes to v2 (live-on-v2 or any sandbox)
   *   - `'v1'` only when a live/sequential run lacks flag or opt-in
   */
  log: {
    executionEngine: 'v1' | 'v2'
    executionMode: string
    v2LiveExecutionEnabled: boolean
    userOptedIntoV2Execution: boolean
  }
}

/**
 * Decide which engine handles a workflow run.
 *
 * Behavior matrix:
 *
 * | executionMode | flag  | opt-in | useV2 | log.executionEngine |
 * |---|---|---|---|---|
 * | live       | true  | true  | true  | v2 |
 * | live       | true  | false | false | v1 |
 * | live       | false | *     | false | v1 |
 * | sequential | true  | true  | true  | v2 |
 * | sequential | true  | false | false | v1 |
 * | webhook    | true  | true  | true  | v2 |
 * | webhook    | true  | false | false | v1 |
 * | scheduled  | true  | true  | true  | v2 |
 * | scheduled  | true  | false | false | v1 |
 * | sandbox    | *     | *     | false | v2 |
 *
 * Sandbox always reports `'v2'` because v2 owns the sandbox path
 * (`WorkflowExecutionService` with `testMode: true`). The log reflects
 * what ran, not just whether the live-dispatch gate flipped.
 *
 * `webhook` and `scheduled` are the entry points for PR-V2-WEBHOOKS and
 * PR-V2-CRON respectively. Both gate on the same flag + opt-in pair so
 * a single column flip rolls a user's entire workflow runtime to v2.
 */
export function decideV2LiveDispatch(input: V2DispatchInput): V2DispatchDecision {
  const isLiveMode =
    input.executionMode === 'live' ||
    input.executionMode === 'sequential' ||
    input.executionMode === 'webhook' ||
    input.executionMode === 'scheduled'
  const useV2 = isLiveMode && input.flagEnabled && input.userOptedIn
  const engine: 'v1' | 'v2' = useV2 || !isLiveMode ? 'v2' : 'v1'
  return {
    useV2,
    log: {
      executionEngine: engine,
      executionMode: input.executionMode,
      v2LiveExecutionEnabled: input.flagEnabled,
      userOptedIntoV2Execution: input.userOptedIn,
    },
  }
}
