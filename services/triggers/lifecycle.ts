import { getActiveForExecution } from "@/repositories/integrations";
import * as triggerResourcesRepo from "@/repositories/triggerResources";
import type { WorkflowRecord } from "@/repositories/workflows";
import { findActivation } from "@/services/triggers/activationRegistry";

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
 * Slice 2e — activation hook seam: a (provider, eventType) may register an
 * activation function via `activationRegistry`. When present, lifecycle
 * calls it BEFORE the upsert and merges its returned partial config into
 * the node's config. Polling triggers (Gmail new_email) use this to fetch
 * the initial historyId snapshot — without it, the first poll establishes
 * a baseline and silently drops events that arrived between activation
 * and the first poll (V1 CLAUDE.md "first poll miss" bug).
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
    const activation = findActivation(node.provider, node.type);
    let mergedConfig: Record<string, unknown> = { ...node.config };

    if (activation) {
      const integration = await getActiveForExecution(
        workflow.userId,
        node.provider,
        null,
      );
      if (!integration) {
        throw new Error(
          `registerWorkflowTriggers: no active ${node.provider} integration for user ${workflow.userId}.`,
        );
      }
      const patch = await activation({ node, integration });
      mergedConfig = { ...mergedConfig, ...patch };
    }

    await triggerResourcesRepo.upsert({
      workflowId: workflow.id,
      userId: workflow.userId,
      provider: node.provider,
      eventType: node.type,
      nodeId: node.id,
      config: mergedConfig,
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
