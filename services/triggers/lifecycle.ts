import * as triggerResourcesRepo from "@/repositories/triggerResources";
import type { WorkflowRecord } from "@/repositories/workflows";

/**
 * Trigger lifecycle service.
 *
 * Per docs/rules/workflow-lifecycle.md §"V2 intended behavior":
 *   - registerTrigger runs BEFORE persisting state during activate / resume
 *     (from eligible_to_resume). A throw aborts the transition; the
 *     orchestrator wraps with TRIGGER_REGISTRATION_FAILED.
 *   - unregisterTrigger runs AFTER persisting state during disable / delete
 *     and is best-effort (the orchestrator swallows errors). Webhook
 *     dispatcher (1J.3) independently guards against disabled / deleted
 *     workflows.
 *
 * For Slack the registration is purely a DB record — Slack's Events API
 * uses one global webhook URL per app, so per-workflow registration lives
 * in trigger_resources alone. Providers that need per-workflow
 * subscriptions (Microsoft Graph, Stripe webhooks, etc.) extend this
 * service with provider-side API calls when their slice ships.
 *
 * Manual-only workflows (zero trigger nodes) are a no-op — registration
 * doesn't apply, but the precondition checks in services/triggers/
 * preconditions.ts still run.
 */

export async function registerWorkflowTriggers(
  workflow: WorkflowRecord,
): Promise<void> {
  const triggers = workflow.draftDefinition.nodes.filter(
    (n) => n.kind === "trigger",
  );
  if (triggers.length === 0) return; // manual-only workflow

  for (const node of triggers) {
    await triggerResourcesRepo.upsert({
      workflowId: workflow.id,
      userId: workflow.userId,
      provider: node.provider,
      eventType: node.type,
      nodeId: node.id,
      config: node.config,
      // accountId is resolved later via the user's integrations row when the
      // dispatcher needs it; storing null here keeps registration cheap and
      // avoids a stale account_id when the user reconnects with a new account.
    });
  }
}

export async function unregisterWorkflowTriggers(
  workflow: WorkflowRecord,
): Promise<void> {
  // No provider-side API call required for Slack. Other providers (Microsoft
  // Graph, etc.) will branch on node.provider and call provider-specific
  // unsubscribe APIs before the row is removed.
  await triggerResourcesRepo.deleteByWorkflow(workflow.id);
}
