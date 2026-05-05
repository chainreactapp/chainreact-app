/**
 * Single source of truth for two questions:
 *
 *   1. Given an integration row's `status` field, is it currently
 *      usable for execution? — `isConnectedStatus(status)`
 *   2. Given a node's `providerId`, does it require an OAuth connection
 *      at all, or is it a built-in (Manual Trigger, HITL, Logic, etc.)?
 *      — `isIntegrationRequired(providerId)`
 *
 * Both predicates ship in the same file because consumers usually ask
 * both questions in sequence ("does this node need an account?" and if
 * so "is the user's account in a usable state?"). Keeping them
 * co-located prevents the drift that produced the 2026-05-05
 * "Connect Your Accounts" regression — five separate inline copies of
 * each predicate, each with its own subtly-wrong list.
 *
 * This file is intentionally free of React, zustand, and Next-runtime
 * imports so server-side consumers (e.g. workflow execution, OAuth
 * callbacks) can read the same canonical values without pulling UI
 * code into their bundle.
 *
 * If you add a new built-in provider (no OAuth flow), add its
 * providerId to `CONNECTION_EXEMPT_PROVIDERS` AND add a test case in
 * `__tests__/integrations/disconnected-integrations-dialog.test.ts`.
 */

// ─── Status canonicalization ────────────────────────────────────────────

/**
 * Status values that mean "this integration is currently usable."
 *
 * Different code paths in `lib/integrations/` and `app/api/integrations/`
 * write `'connected'`, `'authorized'`, or `'active'` to the column.
 * Older code may also persist `'valid'`, `'ok'`, or `'ready'`. All six
 * are accepted.
 *
 * Anything outside this set (`'expired'`, `'needs_reauthorization'`,
 * `'disconnected'`, `'error'`, etc.) is NOT connected.
 */
export const CONNECTED_INTEGRATION_STATUSES = [
  'connected',
  'authorized',
  'active',
  'valid',
  'ok',
  'ready',
] as const

export type ConnectedIntegrationStatus = (typeof CONNECTED_INTEGRATION_STATUSES)[number]

export function isConnectedStatus(status?: string | null): boolean {
  if (!status) return false
  return (CONNECTED_INTEGRATION_STATUSES as readonly string[]).includes(status.toLowerCase())
}

/**
 * Mutable `string[]` copy of `CONNECTED_INTEGRATION_STATUSES` for use
 * with Supabase's `.in('status', ...)` filter. The readonly tuple type
 * doesn't satisfy Supabase's filter parameter (which expects
 * `string[]`), so a pre-cast list avoids `[...CONNECTED_INTEGRATION_STATUSES]`
 * at every call site and gives us one canonical reference for server-
 * side queries.
 *
 * Server-side query pattern:
 *   .from('integrations').in('status', CONNECTED_STATUSES_LIST)
 *
 * In-memory filter pattern (when status comes back from a wider fetch):
 *   .filter(i => isConnectedStatus(i.status))
 */
export const CONNECTED_STATUSES_LIST: string[] = [...CONNECTED_INTEGRATION_STATUSES]

// ─── Provider exemptions (built-ins with no OAuth flow) ─────────────────

/**
 * Built-in providers that don't have an OAuth flow. Sourced from a
 * grep of `providerId:` across `lib/workflows/nodes/providers/` —
 * exactly the IDs that appear in node schemas WITHOUT a
 * `/api/oauth/{provider}/authorize` endpoint.
 *
 * Real provider IDs only — no display names, no legacy aliases. If a
 * past consumer used `'manual'` / `'schedule'` / `'core'` / etc., that
 * was already a string mismatch against the actual node schemas; the
 * fix is on the consumer, not by adding the alias here.
 */
export const CONNECTION_EXEMPT_PROVIDERS = [
  'ai', // AI Agent / AI Router (platform-managed keys)
  'ask-human', // HITL Conversation
  'automation', // Manual Trigger, Wait-for-Event
  'logic', // if / router / loop / delay / http_request
  'utility', // built-in utility nodes
  'webhook', // built-in webhook trigger (HMAC-secured, no OAuth)
] as const

export type ExemptProviderId = (typeof CONNECTION_EXEMPT_PROVIDERS)[number]

/**
 * `true` when the given providerId is a third-party integration that
 * requires the user to connect an account.
 *
 * `false` for built-in providers (see `CONNECTION_EXEMPT_PROVIDERS`)
 * and for missing/empty providerIds — both are treated as "no
 * connection prompt needed."
 */
export function isIntegrationRequired(providerId?: string | null): boolean {
  if (!providerId) return false
  return !(CONNECTION_EXEMPT_PROVIDERS as readonly string[]).includes(providerId)
}
