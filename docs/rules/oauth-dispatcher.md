# Rule: OAuth Dispatcher

## Purpose

Define a generic OAuth dispatcher for ChainReactV2 that routes per-provider OAuth concerns (auth-URL building, callback handling, token refresh, revocation) to per-provider modules. The dispatcher itself contains zero provider-specific logic.

## Current V1 problem being solved

V1's `app/api/integrations/auth/generate-url/route.ts` is 1,316 lines and inlines OAuth URL construction for 20+ providers. Adding a provider requires editing this central file and risks breaking unrelated providers.

OAuth scopes are split across two sources of truth:
- `lib/integrations/integrationScopes.ts` (`INTEGRATION_SCOPES` object)
- `lib/integrations/scope-validator.ts` (`PROVIDER_SCOPES` hardcoded inside the validator class)

Both define overlapping scope sets independently. They drift.

V1's token refresh service (`lib/integrations/tokenRefreshService.ts`, 636 lines) also embeds per-provider quirks. Q3 (refresh-and-retry) is well-conformed by handlers but the underlying implementation has provider-specific logic in the wrong layer.

## V2 intended behavior

## Resolved Decisions

**Locked for Slice 1:**
- Generic dispatcher at `services/oauth/dispatcher.ts` with four operations: `connect`, `handleCallback`, `refresh`, `revoke`.
- Per-provider modules at `integrations/<provider>/oauth.ts` implement the `ProviderOAuth` interface.
- Scopes live in `integrations/<provider>/manifest.ts` — single source of truth. The dual-source-of-truth in V1 (`integrationScopes.ts` + `scope-validator.ts`) collapses into manifests.
- **State storage (decided):**
  - **Signed short-lived state token** (HMAC-signed compact token or signed JWT — pick at implementation time) carrying `userId`, `provider`, `nonce`, `expiresAt`, `requestedScopes`. Returned to the provider as the `state` query param.
  - **Server-side DB row keyed by `nonce`** for PKCE `code_verifier` and any provider-specific temporary metadata. Table: `oauth_states`.
  - Both expire after **15 minutes**.
  - The DB row is deleted after successful callback.
- **Slack refresh-token reality (corrects master plan):** Slack's default OAuth v2 flow does NOT return refresh tokens. Token rotation is opt-in per Slack app config and most apps don't enable it. **Slice 1 does NOT rely on Slack to prove the Q3 refresh-and-retry contract.** Slack remains the slice-1 provider because it best exercises webhook receipt + action dispatch — not because it exercises refresh.
- **Q3 verification for Slice 1:** refresh-and-retry is exercised via (a) a provider mock in unit tests, and (b) a real refreshable provider (Google or Microsoft) added in Slice 2.
- Token storage at rest: encrypted (AES-256, V2 key) in the `integrations` table.
- Concurrent refresh: per-`(userId, provider)` lock so only one refresh hits the provider at a time.

**Deferred decisions:**
- Whether to use a JWT library or a custom HMAC-signed compact token for the signed state. Both work; pick at implementation.
- Provider re-link flow when a user changes their Slack workspace (preserve row + update tokens vs orphan).
- Multi-account discriminator format for providers without a stable account ID (rare).

**Decisions requiring product-owner input:**
- Token re-encryption strategy at V1→V2 migration cutover (master plan §12.C — runbook, not blocking Slice 1 dev).

A small generic dispatcher at `services/oauth/dispatcher.ts` exposes four operations: `connect`, `handleCallback`, `refresh`, `revoke`. Each operation looks up the provider in `integrations/_registry.ts` and delegates to `integrations/<provider>/oauth.ts`.

Per-provider OAuth modules export a stable interface:

```
interface ProviderOAuth {
  buildAuthUrl(state: OAuthState, scopes: string[]): string
  handleCallback(code: string, state: OAuthState): Promise<{ tokens: EncryptedTokens, accountInfo: ProviderAccount }>
  refreshToken(refreshToken: string): Promise<EncryptedTokens>  // optional — provider may declare unsupported
  revoke(token: string): Promise<void>
}
```

Scopes live in `integrations/<provider>/manifest.ts` as the single source of truth. The dispatcher reads them at auth-URL build time. There is no second scope file.

## Single source of truth

- Per-provider OAuth implementation: `integrations/<provider>/oauth.ts`.
- Per-provider scopes: `integrations/<provider>/manifest.ts` (`scopes.required`, `scopes.optional`, `scopes.deprecated`).
- Generic refresh-and-retry contract: `core/integrations/refreshAndRetry.ts` (Q3 invariant carried forward).
- Token storage: `repositories/integrations.ts` (encrypted tokens at rest, AES-256 with V2 key).

## Allowed flows

- **Connect:** `POST /api/integrations/oauth/[provider]/connect` → dispatcher.`connect(provider, userId, requestedScopes)` → reads manifest scopes → calls `provider.buildAuthUrl()` → returns redirect URL with signed state.
- **Callback:** `GET /api/integrations/oauth/[provider]/callback?code=...&state=...` → dispatcher validates state → calls `provider.handleCallback()` → encrypts tokens → repository writes integration row → emits health-engine `recovered` signal.
- **Refresh:** Action handler hits 401 → `core/integrations/refreshAndRetry` → dispatcher.`refresh(provider, userId)` → reads stored refresh token → calls `provider.refreshToken()` → repository updates with new tokens (atomic, per-user lock).
- **Revoke:** User clicks disconnect → dispatcher.`revoke(provider, userId)` → calls `provider.revoke()` (best-effort) → repository deletes/soft-deletes integration row → cascade lifecycle for affected workflows (per workflow-lifecycle rule).

## Disallowed behavior

- Per-provider blocks inside the dispatcher.
- Scope definitions outside `manifest.ts`.
- Auth-URL construction inside route handlers.
- Token refresh logic inside route handlers or store actions.
- Plaintext tokens in logs, error messages, or response bodies. Ever.
- Storing the `code_verifier` (PKCE) outside the dispatcher's state-management layer.
- Dispatcher importing from a specific provider module — only via the registry.

## Edge cases

- **PKCE providers (Slack, Twitter, others):** Dispatcher generates `code_verifier` + `code_challenge` at connect time, persists `code_verifier` keyed by state, retrieves at callback. State expiry: 15 minutes.
- **Rotating refresh tokens (Microsoft, some Google flows):** Refresh response returns a new refresh token. Persistence must be atomic — old refresh token is invalidated server-side as soon as the new one is issued. Lock per `(userId, provider)` during refresh.
- **Non-refreshable providers (Slack default v2 flow, Discord, GitHub Apps with offline tokens, Stripe restricted keys):** Provider's `refreshToken()` is unimplemented or throws `RefreshNotSupported`. On 401, the refresh path emits `action_required` health signal immediately, no refresh attempt. Slack token rotation is opt-in and not used in Slice 1; if a future Slack app enables rotation, the provider module gains a real `refreshToken()` implementation and the manifest declares it refreshable.
- **State CSRF:** State param is signed (HMAC) and contains `userId`, `provider`, `nonce`, `expiresAt`, `requestedScopes`. Callback validates signature, expiry, and `provider` match.
- **Failed callback:** Provider redirects with `error=access_denied` — dispatcher records the denial, redirects to the integrations page with a humanized error.
- **Scope upgrade:** User reconnects to grant additional scopes — dispatcher detects existing connection by `(userId, provider, providerAccountId)`, updates scopes on the existing row, does not duplicate.
- **Multi-account per provider:** A user has two Slack workspaces. Each `(userId, provider, providerAccountId)` is a unique integration row. Account discriminator (`team_id` for Slack, `workspace_id` for Notion, etc.) is provider-specific and lives in the manifest.
- **Concurrent refresh:** Two action handlers trigger refresh at the same time. Per-user-per-provider lock ensures only one refresh call hits the provider; the second waits and re-reads the refreshed tokens.
- **Token decrypt failure:** Decryption failure is treated as a fatal integration error — emit `disconnected` health signal, force user reconnect, never retry decryption.

## Required tests

Unit tests in `tests/unit/services/oauth/dispatcher.test.ts`:

1. Dispatcher routes to correct provider module by name.
2. Unknown provider name → 404-shaped error.
3. State validation rejects forged signature.
4. State validation rejects expired state.
5. PKCE: `code_verifier` persisted at connect, retrieved at callback.
6. Refresh path locks per `(userId, provider)`.
7. Concurrent refresh: only one provider call.
8. Non-refreshable provider on refresh: throws `RefreshNotSupported`, dispatcher emits `action_required`.

Per-provider unit tests at `tests/unit/integrations/<p>/oauth.test.ts`:

9. `buildAuthUrl` produces a URL matching the provider's documented contract for each provider implemented in V2.
10. `handleCallback` exchanges code for tokens; rejects bad codes.
11. `refreshToken` for refreshable providers; throws `RefreshNotSupported` for non-refreshable.
12. `revoke` calls the provider's revocation endpoint where one exists; no-ops cleanly where it doesn't.

Integration tests in `tests/integration/oauth-flows/<provider>.test.ts`:

13. **Slice 1 Slack OAuth integration test:** full Slack connect → callback → encrypted token storage → action call succeeds. If a Slack action returns 401 and the Slack manifest declares the provider non-refreshable, the dispatcher throws `RefreshNotSupported` and emits the `action_required` health signal. **No refresh attempt is made.**
14. **Slice 1 Q3 cycle with refreshable mock provider:** full connect → callback → token storage → action call → 401 → refresh → retry → success cycle using a refreshable mock provider in unit/integration tests. This is how Q3 is proved for Slice 1, since Slack default v2 cannot prove it.
15. **Slice 2 Q3 cycle with the first real refreshable provider** (Google or Microsoft, whichever lands in Slice 2): repeat the full refresh cycle against the real provider's auth endpoints (with credentials from a sandbox app).
16. Scope upgrade flow: existing integration, reconnect with broader scopes, single row updated.
17. Multi-account: two Slack workspaces, two integration rows distinguished by `team_id`.

## V1 behavior to preserve

- Q3 refresh-and-retry contract on action handlers.
- Per-provider auth-scheme classification (refreshable vs non-refreshable) — the right idea, just relocated to manifest.
- Health-engine integration on token revoked / refresh failure.
- Encrypted token storage at rest.
- PKCE for providers that require it.

## V1 behavior to drop

- Inline per-provider blocks inside the generate-url route.
- The dual scope-source-of-truth (`integrationScopes.ts` and `scope-validator.ts`).
- The 1,316-line generate-url route — its 5–10 lines of logic per provider absorb into provider modules; routing logic absorbs into the dispatcher.
- Token refresh service's per-provider quirks — those move to provider modules.

## Open questions

1. **Provider re-link flow:** existing user changes Slack workspace — preserve the integration row with new tokens, or create a new row and orphan the old? Recommendation: preserve and update; archive workflows tied to the old workspace via lifecycle rule.
2. **Multi-account discriminator:** providers vary in how they expose account IDs. Manifest should declare the field name explicitly. Where there's no stable account ID (rare), use a UUID assigned at first callback.
3. **Per-provider scope validation:** if a provider returns *fewer* scopes than requested (user denied some), dispatcher records the granted scopes, but who decides whether the integration is usable — dispatcher, manifest, or scope-validator service? Recommendation: scope-validator service reads granted scopes against `manifest.scopes.required`.
