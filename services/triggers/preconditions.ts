import type { LifecycleTransition } from "@/core/workflows/lifecycle";
import type { PreconditionResult } from "@/services/workflows/lifecycleOrchestrator";
import * as integrationsRepo from "@/repositories/integrations";
import type { WorkflowRecord } from "@/repositories/workflows";

/**
 * Activation / resume precondition checks.
 *
 * Per docs/rules/workflow-lifecycle.md §"Allowed transitions" + §"Multi-
 * integration disable cascade":
 *   - All required integrations must be healthy (V2: actively connected,
 *     i.e. integrations row with disconnected_at IS NULL) before a
 *     workflow can move to active.
 *   - Resume from eligible_to_resume re-checks all activation preconditions.
 *
 * pause / disable / delete / markEligibleToResume have no preconditions —
 * the orchestrator skips this hook (returns ok) for those transitions.
 *
 * Failure shape (`MISSING_PRECONDITIONS`):
 *   - `EMPTY_WORKFLOW`: zero nodes; the orchestrator can't activate nothing.
 *   - `INTEGRATION_NOT_CONNECTED`: one entry per missing provider, with a
 *     user-actionable message naming the provider.
 */
export async function checkActivationPreconditions(
  workflow: WorkflowRecord,
  transition: LifecycleTransition,
): Promise<PreconditionResult> {
  if (transition !== "activate" && transition !== "resume") {
    return { ok: true };
  }

  const nodes = workflow.draftDefinition.nodes;
  if (nodes.length === 0) {
    return {
      ok: false,
      failures: [
        {
          code: "EMPTY_WORKFLOW",
          message: "Add at least one node before activating this workflow.",
        },
      ],
    };
  }

  const requiredProviders = new Set<string>();
  for (const node of nodes) requiredProviders.add(node.provider);

  const activeIntegrations = await integrationsRepo.listActiveByUser(workflow.userId);
  const connectedProviders = new Set(activeIntegrations.map((i) => i.provider));

  const failures: { code: string; message: string }[] = [];
  for (const provider of requiredProviders) {
    if (!connectedProviders.has(provider)) {
      failures.push({
        code: "INTEGRATION_NOT_CONNECTED",
        message: `Connect ${provider} before activating this workflow.`,
      });
    }
  }

  if (failures.length > 0) return { ok: false, failures };
  return { ok: true };
}
