import type { ActionHandler } from "./types";

/**
 * Hand-maintained action handler registry.
 *
 * Per docs/rules/provider-registry.md (same convention as the integration
 * manifest registry): explicit imports surface in PRs. Each provider's
 * action slice (1L for Slack, future slices for others) appends an entry
 * to ALL_HANDLERS below.
 *
 * Slice 1K.2 ships an empty registry — the engine's "handler missing"
 * path is exercised in tests. Slice 1L adds the first real entry.
 */

interface HandlerEntry {
  provider: string;
  /** Provider-scoped type matching WorkflowNode.type. */
  type: string;
  handler: ActionHandler;
}

const ALL_HANDLERS: ReadonlyArray<HandlerEntry> = [
  // Slack handlers will be added in Slice 1L:
  //   { provider: "slack", type: "send_channel_message", handler: sendChannelMessage },
];

const byKey: ReadonlyMap<string, ActionHandler> = (() => {
  const m = new Map<string, ActionHandler>();
  for (const entry of ALL_HANDLERS) {
    const key = `${entry.provider}:${entry.type}`;
    if (m.has(key)) {
      throw new Error(`Duplicate action handler registered for ${key}.`);
    }
    m.set(key, entry.handler);
  }
  return m;
})();

export function getActionHandler(
  provider: string,
  type: string,
): ActionHandler | undefined {
  return byKey.get(`${provider}:${type}`);
}

export function listRegisteredHandlers(): ReadonlyArray<{
  provider: string;
  type: string;
}> {
  return ALL_HANDLERS.map(({ provider, type }) => ({ provider, type }));
}
