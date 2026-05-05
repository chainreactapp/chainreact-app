/**
 * Helper for determining which providers / node types do NOT require an
 * OAuth connection.
 *
 * The provider-level exemption (`isProviderConnectionExempt`) consults
 * the canonical `CONNECTION_EXEMPT_PROVIDERS` list from
 * `lib/integrations/connectionStatus` — same source-of-truth as the
 * builder's "Connect Your Accounts" dialog.
 *
 * The node-type-level exemption (`isNodeTypeConnectionExempt`) stays
 * local because it covers a different axis: special-case node types
 * whose provider-side exemption isn't enough (e.g. utility nodes that
 * don't fit any provider category, or trigger types that are
 * configured at the node level rather than via an OAuth account).
 */

import { CONNECTION_EXEMPT_PROVIDERS as CANONICAL_EXEMPT_PROVIDERS } from "@/lib/integrations/connectionStatus"

const CONNECTION_EXEMPT_PROVIDERS = new Set<string>(CANONICAL_EXEMPT_PROVIDERS)

const CONNECTION_EXEMPT_NODE_TYPES = new Set<string>([
  'webhook',
  'format_transformer',
  'parse_file',
  'extract_website_data',
  'conditional_trigger',
  'google_search',
  'tavily_search',
  'hitl_conversation',
  'ai_agent',
  'ai_router',
  'ai_message',
  'ai_action',
])

export const isProviderConnectionExempt = (providerId?: string | null): boolean => {
  if (!providerId) return false
  return CONNECTION_EXEMPT_PROVIDERS.has(providerId)
}

export const isNodeTypeConnectionExempt = (nodeType?: string | null): boolean => {
  if (!nodeType) return false
  return CONNECTION_EXEMPT_NODE_TYPES.has(nodeType)
}

export { CONNECTION_EXEMPT_PROVIDERS, CONNECTION_EXEMPT_NODE_TYPES }
