/**
 * Pure helpers for the "Connect Your Accounts" dialog.
 *
 * Extracted from `DisconnectedIntegrationsDialog.tsx` so the logic can be
 * unit-tested without pulling React / Radix / zustand into the test
 * runner. The component imports `CONNECTION_EXEMPT_PROVIDERS` and
 * `getDisconnectedIntegrations` from this file; tests import the same
 * symbols and exercise them directly.
 *
 * Source of truth for "is this status connected?" lives in
 * `stores/integrationStore.ts` (`isConnectedStatus`). Do not duplicate
 * a narrower set of values here — the regression of 2026-05-05 came
 * from exactly that mistake.
 */

import { isConnectedStatus } from "@/stores/integrationStore"
import { getProviderDisplayName } from "@/lib/workflows/ai-agent/providerDisambiguation"

/**
 * Built-in providers that don't need OAuth connection. Sourced from a
 * grep of `providerId:` across `lib/workflows/nodes/providers/` — only
 * the IDs that actually appear in node schemas are listed.
 */
export const CONNECTION_EXEMPT_PROVIDERS = [
  "ai", // AI Agent / AI Router (platform-managed keys)
  "ask-human", // HITL Conversation
  "automation", // Manual Trigger, Wait-for-Event
  "logic", // if/router/loop/delay/http_request
  "utility", // built-in utility nodes
  "webhook", // built-in webhook trigger (HMAC-secured, no OAuth)
] as const

export interface DisconnectedIntegration {
  providerId: string
  displayName: string
  nodeCount: number
}

/**
 * Compute the list of integrations a workflow needs but the current
 * user hasn't connected.
 *
 * @param nodes — workflow nodes (React Flow shape; reads `node.data.providerId`)
 * @param integrations — current `useIntegrationStore.integrations` array
 */
export function getDisconnectedIntegrations(
  nodes: any[],
  integrations: any[],
): DisconnectedIntegration[] {
  // Group nodes by provider, skipping built-ins that don't need OAuth.
  const providerCounts = new Map<string, number>()

  for (const node of nodes) {
    const providerId = node?.data?.providerId
    if (!providerId) continue
    if ((CONNECTION_EXEMPT_PROVIDERS as readonly string[]).includes(providerId)) continue

    providerCounts.set(providerId, (providerCounts.get(providerId) || 0) + 1)
  }

  const disconnected: DisconnectedIntegration[] = []

  for (const [providerId, count] of providerCounts) {
    const integration = integrations.find((i) => i?.provider === providerId)
    if (isConnectedStatus(integration?.status)) continue

    disconnected.push({
      providerId,
      displayName: getProviderDisplayName(providerId),
      nodeCount: count,
    })
  }

  return disconnected
}
