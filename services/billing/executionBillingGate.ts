import * as userBillingRepo from "@/repositories/userBilling";

/**
 * Pre-execution billing gate.
 *
 * Per docs/rules/project-structure-and-module-boundaries.md §"Single
 * source of truth", the canonical owner of the gate is
 * core/billing/executionBillingGate.ts + the deduct_tasks_if_available
 * RPC. The gate lives in services/ instead because core/'s ESLint guard
 * restricts imports to contracts/ — and the gate fundamentally needs the
 * userBilling repository. Same precedent as services/triggers/dispatch.ts
 * (Slice 1J.3): rule-doc table puts it in core/, ESLint structurally
 * cannot, services/ is the lint-clean home. Behavior is the rule's spec.
 *
 * Slice 1N: 1 task per run, flat. Per-node pricing comes later.
 *
 * Returns a discriminated outcome:
 *   ok=true               → run may proceed.
 *   ok=false (limit_reached) → run refused; engine surfaces BILLING_EXHAUSTED.
 */

export type BillingGateOutcome =
  | { ok: true; used: number; limit: number }
  | { ok: false; reason: "limit_reached"; used: number; limit: number };

export async function executionBillingGate(
  userId: string,
): Promise<BillingGateOutcome> {
  const result = await userBillingRepo.deductTasks(userId, 1);
  if (result.ok) {
    return { ok: true, used: result.used, limit: result.limit };
  }
  return {
    ok: false,
    reason: "limit_reached",
    used: result.used,
    limit: result.limit,
  };
}
