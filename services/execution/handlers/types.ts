import type { TriggerEvent } from "@/contracts/triggerEvent";

/**
 * Per-provider action handler contract.
 *
 * Per docs/rules/variable-resolver.md §"Allowed flows":
 *   - The engine pre-resolves the entire `config` via resolveStrict before
 *     dispatching. Handlers receive a fully-resolved object — never raw
 *     {{...}} templates.
 *   - Handlers are pure adapters between resolved config and the provider
 *     API. They MUST NOT call the variable resolver themselves.
 *
 * The output value becomes a variable the engine exposes to downstream
 * nodes as `{{nodeId.<output-field>}}`. Keep the shape stable per
 * (provider, type) — workflows pin their downstream references against it.
 */

export interface ActionHandlerInput {
  /** Workflow id (for logging / future billing attribution). */
  workflowId: string;
  /**
   * Owner of the workflow. Handlers use this to look up the user's
   * integration row + decrypt the provider token. Threaded through from
   * workflow.userId at engine entry.
   */
  userId: string;
  /** Run id assigned at engine entry; carried through every handler call. */
  runId: string;
  /** Node id of the action being executed. */
  nodeId: string;
  /** Resolved config payload (no remaining `{{...}}` references). */
  config: Readonly<Record<string, unknown>>;
  /** The original trigger event that started the run. */
  triggerEvent: TriggerEvent;
}

export interface ActionHandlerResult {
  /** Becomes `context.variables[nodeId]` for downstream nodes. */
  output: Readonly<Record<string, unknown>>;
}

export type ActionHandler = (
  input: ActionHandlerInput,
) => Promise<ActionHandlerResult>;
