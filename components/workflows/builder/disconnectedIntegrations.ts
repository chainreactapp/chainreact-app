/**
 * Pure helper for the "Connect Your Accounts" dialog —
 * `getDisconnectedIntegrations` walks a workflow's nodes and returns
 * the third-party providers the current user hasn't connected yet.
 *
 * Lives outside `DisconnectedIntegrationsDialog.tsx` so unit tests can
 * load it without pulling React / Radix / zustand through Jest's
 * transform path.
 *
 * Both connection predicates (`isConnectedStatus` and
 * `isIntegrationRequired`) come from `lib/integrations/connectionStatus`
 * — that's the single source of truth. Do not duplicate either one
 * here.
 */

import {
  isConnectedStatus,
  isIntegrationRequired,
} from "@/lib/integrations/connectionStatus"
import { getProviderDisplayName } from "@/lib/workflows/ai-agent/providerDisambiguation"

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
    if (!isIntegrationRequired(providerId)) continue

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

/**
 * Re-exported from the canonical module so legacy imports of
 * `CONNECTION_EXEMPT_PROVIDERS` from this file continue to work.
 * New code should import from `@/lib/integrations/connectionStatus`
 * directly.
 */
export { CONNECTION_EXEMPT_PROVIDERS } from "@/lib/integrations/connectionStatus"
