/**
 * Per-tier polling intervals.
 *
 * Slice 2e: single 5-minute default for every role. V1 ships per-tier
 * intervals (free=15min, pro=2min, business=1min) but threading the user's
 * billing tier into the cron-scheduler context requires plumbing that
 * Slice 2e is intentionally not building (the scheduler iterates
 * trigger_resources rows; userId → plan_tier lookup would mean either an
 * extra per-row query or a join). The shape below preserves the V1 API
 * (`getIntervalMsForRole(role)`) so per-tier intervals can land in a
 * follow-up by swapping the body without touching callers.
 *
 * Decision recorded for the follow-up:
 *   - Read user_profiles.role (or whatever V2's billing slice introduces)
 *     once per cron tick into a per-cron-invocation cache keyed by userId.
 *   - Replace DEFAULT_INTERVAL_MS below with the V1 PLAN_POLL_INTERVALS map.
 *
 * Any non-recognized role today falls through to DEFAULT_INTERVAL_MS, so
 * the upgrade is a behavior addition, not a breaking change.
 */

export const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export function getIntervalMsForRole(_role: string | null | undefined): number {
  return DEFAULT_INTERVAL_MS;
}
