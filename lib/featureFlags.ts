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
} as const
