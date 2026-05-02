/**
 * Auth-scheme registry for runtime 401 handling (PR-C3, Q3).
 *
 * Different providers expose fundamentally different recovery paths when an
 * outbound call returns 401:
 *
 *   - **oauth_with_refresh** — the integration stored a refresh token. On
 *     401 we should try `tokenRefreshService.refresh(provider, userId)`,
 *     re-issue the call with the new access token once, and only then fall
 *     back to a user-action signal. Examples: Google (Gmail / Calendar /
 *     Drive / Sheets / Docs), Microsoft (Outlook / OneDrive / OneNote /
 *     Excel / Teams), Notion, Shopify (offline access), HubSpot, Mailchimp,
 *     Airtable, Dropbox.
 *
 *   - **non_refreshable** — auth is a long-lived bot token, personal access
 *     token, or plain API key. There is nothing to refresh against. On 401
 *     we go straight to a user-action signal — attempting a refresh would
 *     burn time and produce a misleading log line. Examples: Slack bot
 *     tokens, Discord bot tokens, GitHub PAT, Stripe API key, Twilio API
 *     key, raw webhook integrations.
 *
 * Contract: see `learning/docs/handler-contracts.md` Q3.
 *
 * Adding a new provider:
 *   1. Pick the scheme that matches the auth model (NOT what's most
 *      convenient).
 *   2. Add an entry below.
 *   3. If the provider's OAuth dialect is unusual (e.g., requires extra
 *      headers on refresh), wire it up in `oauthConfig.ts` first — this
 *      registry only encodes the high-level scheme, not the wire format.
 */

export type AuthScheme = 'oauth_with_refresh' | 'non_refreshable'

const AUTH_SCHEME_BY_PROVIDER: Record<string, AuthScheme> = {
  // ─── OAuth-with-refresh ────────────────────────────────────────────────
  // Google family — every Google integration uses the same OAuth2 flow.
  google: 'oauth_with_refresh',
  gmail: 'oauth_with_refresh',
  'google-calendar': 'oauth_with_refresh',
  google_calendar: 'oauth_with_refresh',
  'google-drive': 'oauth_with_refresh',
  google_drive: 'oauth_with_refresh',
  'google-sheets': 'oauth_with_refresh',
  google_sheets: 'oauth_with_refresh',
  'google-docs': 'oauth_with_refresh',
  google_docs: 'oauth_with_refresh',
  'google-analytics': 'oauth_with_refresh',
  youtube: 'oauth_with_refresh',

  // Microsoft family — Graph-API providers all use the v2 token endpoint.
  microsoft: 'oauth_with_refresh',
  'microsoft-outlook': 'oauth_with_refresh',
  'microsoft-onenote': 'oauth_with_refresh',
  'microsoft-excel': 'oauth_with_refresh',
  outlook: 'oauth_with_refresh',
  onedrive: 'oauth_with_refresh',
  onenote: 'oauth_with_refresh',
  teams: 'oauth_with_refresh',

  // Other refresh-token providers.
  notion: 'oauth_with_refresh',
  hubspot: 'oauth_with_refresh',
  mailchimp: 'oauth_with_refresh',
  airtable: 'oauth_with_refresh',
  // Shopify uses offline access tokens that don't expire and have no refresh
  // grant. A 401 means the merchant uninstalled / the token was revoked —
  // there's nothing to refresh against, so route directly to action_required.
  shopify: 'non_refreshable',
  dropbox: 'oauth_with_refresh',
  trello: 'oauth_with_refresh',
  facebook: 'oauth_with_refresh',
  instagram: 'oauth_with_refresh',
  linkedin: 'oauth_with_refresh',
  twitter: 'oauth_with_refresh',
  monday: 'oauth_with_refresh',
  gumroad: 'oauth_with_refresh',

  // ─── Non-refreshable ────────────────────────────────────────────────────
  // Bot tokens, PATs, plain API keys — no refresh round-trip possible.
  slack: 'non_refreshable',
  discord: 'non_refreshable',
  github: 'non_refreshable',
  stripe: 'non_refreshable',
}

/**
 * Look up the auth scheme for a provider.
 *
 * Unknown providers default to `non_refreshable`. This is the safe default —
 * it means refreshAndRetry won't attempt an impossible token exchange and
 * will signal the user immediately. If a new provider really IS OAuth-with-
 * refresh, the registry above is the single source of truth — add it there.
 */
export function getAuthScheme(provider: string): AuthScheme {
  return AUTH_SCHEME_BY_PROVIDER[provider] ?? 'non_refreshable'
}

/**
 * Convenience predicate. Returns true iff the provider has a refresh-token
 * recovery path. Used by `refreshAndRetry` and surrounding telemetry.
 */
export function isRefreshableProvider(provider: string): boolean {
  return getAuthScheme(provider) === 'oauth_with_refresh'
}
