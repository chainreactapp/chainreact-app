import {
  LifecycleOrchestrator,
  type LifecycleSideEffects,
} from "./lifecycleOrchestrator";
import { checkActivationPreconditions } from "@/services/triggers/preconditions";
import {
  registerWorkflowTriggers,
  unregisterWorkflowTriggers,
} from "@/services/triggers/lifecycle";

/**
 * Single construction point for the LifecycleOrchestrator with the real
 * side-effect hooks wired in.
 *
 * Per docs/rules/workflow-lifecycle.md §"V2 intended behavior":
 *   - Trigger registration / unregistration → services/triggers/lifecycle.ts.
 *   - Precondition checks (integration-connected) → services/triggers/
 *     preconditions.ts.
 *   - Notification delivery is deferred (Slice 1M ships the in-app
 *     notification surface).
 *
 * API routes call this factory instead of `new LifecycleOrchestrator()` so
 * a future change to the hooks (e.g. wiring notify in 1M, adding billing
 * gating in 1N) lands in one place rather than four route files.
 */
export function createLifecycleOrchestrator(): LifecycleOrchestrator {
  const hooks: LifecycleSideEffects = {
    checkPreconditions: checkActivationPreconditions,
    registerTrigger: registerWorkflowTriggers,
    unregisterTrigger: unregisterWorkflowTriggers,
  };
  return new LifecycleOrchestrator(hooks);
}
