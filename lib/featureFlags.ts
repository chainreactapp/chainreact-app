/**
 * Centralized feature flags for ChainReact.
 *
 * Follows the ENABLE_ environment variable pattern
 * (precedent: ENABLE_FILE_LOGGING in lib/logging/).
 *
 * Usage:
 *   import { FEATURE_FLAGS } from '@/lib/featureFlags'
 *   if (FEATURE_FLAGS.LOOP_COST_EXPANSION) { ... }
 */
export const FEATURE_FLAGS = {
  /**
   * When true, loop nodes are charged upfront at worst-case cost
   * (inner node cost × configured max iterations, capped at 500).
   * When false, loops are treated as logic nodes (0 cost) and
   * inner nodes are counted once (flat cost).
   *
   * Rollout: deploy false → validate audit logs → enable for beta → enable for all.
   */
  LOOP_COST_EXPANSION: process.env.ENABLE_LOOP_COST_EXPANSION === 'true',

  /**
   * When true, opted-in users on Pro/Team/Business can execute past their monthly
   * task limit at a per-task overage rate, capped at overage_cap_multiplier × plan.
   * Stripe usage records are pushed at period close by the report-overage cron.
   *
   * Rollout: deploy false → create live metered prices → enable for self → flip on.
   */
  OVERAGE_BILLING: process.env.ENABLE_OVERAGE_BILLING === 'true',

  /**
   * When true, users on Pro/Team/Business can purchase one-time task packs that
   * survive period rolls (decision #5: never expire). Pack balance is consumed
   * AFTER monthly tasks but BEFORE overage (decision #6).
   *
   * When `auto_buy_packs` is also true on a user, hitting insufficient_balance
   * triggers an off-session payment intent against the user's saved card.
   *
   * Rollout: deploy false → create live pack prices → enable for self → flip on.
   */
  TASK_PACKS: process.env.ENABLE_TASK_PACKS === 'true',

  /**
   * When true, the workflow execution history surfaces a "Resume from failed
   * step" button alongside the existing "Retry full workflow" button, and the
   * `/api/executions/[id]/resume` endpoint accepts traffic. When false, the
   * endpoint returns 404 and the button is hidden.
   *
   * Resume re-runs only the unfinished portion of a failed workflow, replaying
   * upstream completed nodes' outputs from `execution_steps.output_data` and
   * relying on retry-lineage Q4 idempotency to prevent any provider-side
   * double-fire. Eligibility is bounded by RESUME_FROM_FAILED_NODE_WINDOW_DAYS.
   *
   * Plan: learning/docs/safe-resume-from-failed-node-implementation-plan.md
   * Rollout: super_admin → 1% → 10% → 100% → drop Q4 read-fallback.
   */
  RESUME_FROM_FAILED_NODE: process.env.ENABLE_RESUME_FROM_FAILED_NODE === 'true',
} as const

/**
 * Eligibility window (in days) past which a failed run can no longer be resumed
 * from its broken step. Full retry remains available regardless. Default: 7.
 *
 * Beyond this window, provider state may have drifted (deleted Stripe customers,
 * archived Slack channels) such that replaying upstream outputs would mislead
 * the user about what actually happened in the resumed run.
 */
export const RESUME_FROM_FAILED_NODE_WINDOW_DAYS: number = (() => {
  const raw = process.env.RESUME_FROM_FAILED_NODE_WINDOW_DAYS
  if (!raw) return 7
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7
})()
