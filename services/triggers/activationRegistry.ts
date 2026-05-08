import type { WorkflowNode } from "@/contracts/workflowDefinition";
import type { IntegrationRecord } from "@/repositories/integrations";

/**
 * Trigger activation registry.
 *
 * Slice 2e introduces a new seam V1 didn't have. V1 used a 779-line
 * `TriggerLifecycleManager` with per-provider lifecycle classes; V2's
 * `services/triggers/lifecycle.ts` is intentionally simpler — it just
 * upserts a trigger_resources row.
 *
 * For polling triggers we still need V1's "snapshot init at activation
 * time, not first poll" rule (CLAUDE.md "first poll miss" bug — the first
 * poll without a baseline silently drops events that arrived before it).
 * The minimum addition that buys us the rule is this registry: each
 * polling provider registers an `activate(node, integration)` function
 * that returns a `Partial<config>` (e.g. `{ snapshot: { historyId } }`)
 * which `lifecycle.ts` merges into `node.config` before persisting.
 *
 * Webhook triggers don't need this — the trigger_resources row is
 * sufficient on its own (Slack uses a single global webhook URL; future
 * providers that need per-workflow webhook subscriptions can use this
 * same hook by returning the subscription id).
 *
 * First match wins; registrations must be unique on (provider, eventType)
 * — the registrar throws on duplicate.
 */

export interface ActivationContext {
  node: WorkflowNode;
  /** The user's active integration for this provider. */
  integration: IntegrationRecord;
}

/**
 * Returns a partial config patch to merge into the node's config before
 * `trigger_resources.upsert`. Throwing aborts the activate transition;
 * the orchestrator wraps the throw with TRIGGER_REGISTRATION_FAILED.
 */
export type ActivationFn = (
  ctx: ActivationContext,
) => Promise<Record<string, unknown>>;

const activations = new Map<string, ActivationFn>();

function key(provider: string, eventType: string): string {
  return `${provider}:${eventType}`;
}

export function registerActivation(
  provider: string,
  eventType: string,
  fn: ActivationFn,
): void {
  const k = key(provider, eventType);
  if (activations.has(k)) {
    throw new Error(
      `activationRegistry: duplicate registration for ${k}.`,
    );
  }
  activations.set(k, fn);
}

export function findActivation(
  provider: string,
  eventType: string,
): ActivationFn | null {
  return activations.get(key(provider, eventType)) ?? null;
}

/** Test seam — clears the registry between tests. */
export function __resetActivationRegistryForTests(): void {
  activations.clear();
}
