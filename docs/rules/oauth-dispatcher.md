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

**Locked for Slice 1 (shipped):**
- Generic dispatcher at `services/oauth/dispatcher.ts` with four operations: `connect`, `handleCallback`, `refresh`, `revoke`.
- Per-provider modules at `integrations/<provider>/oauth.ts` implement the `ProviderOAuth` interface.
- Scopes live in `integrations/<provider>/manifest.ts` — single source of truth. The dual-source-of-truth in V1 (`integrationScopes.ts` + `scope-validator.ts`) collapses into manifests.
- **State storage — two layers, two purposes:**
  - **Signed short-lived state token (custom HMAC-SHA256 compact token, not a JWT library).** Format: `<base64url(JSON(payload))>.<base64url(hmac)>`. Payload carries `userId`, `provider`, `nonce`, `expiresAt`, `requestedScopes`. Returned to the provider as the `state` query param. Verified via timing-safe comparison. **Purpose:** proves a state value originated server-side, carries the dispatcher's callback-time inputs, can't be forged.
  - **Server-side DB row keyed by `nonce` in the `oauth_states` system table.** Holds `user_id`, `provider`, `expires_at`, optional `pkce_code_verifier` + `pkce_code_challenge_method` (NULL for Slack default v2). **Purpose:** atomic one-time-use semantics. The signed JWT alone proves origin but cannot prevent replay; the DB row makes replay impossible because the consume path is `DELETE … WHERE nonce=$1 AND expires_at > now() RETURNING` — race-safe by primary-key lock.
  - Both expire after **15 minutes**.
  - DB row is deleted at callback. The atomic delete-if-fresh predicate also reaps expired rows lazily; a future cron runs `reapExpired()` for batch cleanup.
  - Verify-and-consume is one operation (`consumeState` in `services/oauth/state.ts`) and runs **before** the provider-mismatch check in `handleCallback` — a wrong-provider callback with valid state still uses up the nonce so it can't be re-played at the correct route either.
- **OAuth callback writes use service-role** (per [database-security.md](./database-security.md) "system writes after out-of-band identity proof"). The signed state + DB nonce consume cryptographically verify user identity; the SSR-cookie path was redundant AND broken across hosts (cookies don't cross origins → ngrok dev / multi-tenant subdomains / CDN-fronted callbacks all break with cookie-coupled inserts). Repository: `repositories/integrations.ts:upsertActive` uses `getServiceRoleClient("oauth callback: upsertActive <provider> for user <id>")`.
- **Callback redirect base** uses `NEXT_PUBLIC_APP_URL`, not `request.url`. Behind a tunnel (ngrok) or proxy the upstream Host header may be rewritten; using it as the redirect Location origin pointed users at the wrong host (e.g. `http://localhost:3000` even though the browser is on the public URL → Chrome HSTS-upgrade → ERR_SSL_PROTOCOL_ERROR). Env value is the canonical public URL of the deployment.
- **Slack refresh-token reality (corrects master plan):** Slack's default OAuth v2 flow does NOT return refresh tokens. Token rotation is opt-in per Slack app config and most apps don't enable it. **Slice 1 does NOT rely on Slack to prove the Q3 refresh-and-retry contract.** Slack remains the slice-1 provider because it best exercises webhook receipt + action dispatch — not because it exercises refresh.
- **Q3 verification for Slice 1:** refresh-and-retry is exercised via (a) a provider mock in unit tests, and (b) a real refreshable provider (Google or Microsoft) added in Slice 2.
- Token storage at rest: encrypted (AES-256, V2 key) in the `integrations` table.
- Concurrent refresh: per-`(userId, provider)` lock so only one refresh hits the provider at a time.

**Deferred decisions:**
- Cron schedule for `oauthStates.reapExpired()` (the function is implemented; not yet wired to a cron). Low urgency — the consume path's `expires_at > now()` predicate already filters out expired rows, so unreaped rows are inert. Free-tier load doesn't need a reaper; lands when traffic justifies it.
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
- Token storage: `repositories/integrations.ts` (encrypted tokens at rest, AES-256 with V2 key; `upsertActive` uses service-role per the OAuth-callback rationale above).
- State-token signing + verify-and-consume: `services/oauth/state.ts` (`createState` writes the `oauth_states` row; `consumeState` does verify + atomic DB consume).
- State-row persistence: `repositories/oauthStates.ts` (`create`, `consumeByNonce` atomic delete-if-fresh, `reapExpired`).

## Allowed flows

- **Connect:** `POST /api/integrations/oauth/[provider]/connect` → dispatcher.`connect(provider, userId, requestedScopes)` → reads manifest scopes → `createState(...)` signs the JWT AND inserts the `oauth_states` row → calls `provider.buildAuthUrl()` → returns redirect URL with signed state.
- **Callback:** `GET /api/integrations/oauth/[provider]/callback?code=...&state=...` → dispatcher.`handleCallback` calls `consumeState(state)` (atomic verify + DB-row delete-if-fresh) → checks provider mismatch → calls `provider.handleCallback()` → encrypts tokens → repository writes integration row via service-role → emits health-engine `recovered` signal → redirect base from `NEXT_PUBLIC_APP_URL` (proxy/tunnel-safe).
- **Refresh:** Action handler hits 401 → `core/integrations/refreshAndRetry` → dispatcher.`refresh(provider, userId)` → reads stored refresh token → calls `provider.refreshToken()` → repository updates with new tokens (atomic, per-user lock).
- **Revoke:** User clicks disconnect → dispatcher.`revoke(provider, userId)` → calls `provider.revoke()` (best-effort) → repository deletes/soft-deletes integration row → cascade lifecycle for affected workflows (per workflow-lifecycle rule).

## Disallowed behavior

- Per-provider blocks inside the dispatcher.
- Scope definitions outside `manifest.ts`.
- Auth-URL construction inside route handlers.
- Token refresh logic inside route handlers or store actions.
- Plaintext tokens in logs, error messages, or response bodies. Ever.
- Storing the `code_verifier` (PKCE) outside the dispatcher's state-management layer.
- Storing the `code_verifier` inside the signed state JWT (it is the secret half — putting it in the JWT defeats PKCE).
- OAuth-callback writes to `integrations` going through the SSR-cookie client. Cookies don't cross hosts; user identity is already proven by the signed state + DB nonce consume; the path must use service-role with an explicit reason.
- OAuth-callback redirect Locations using `request.url` as the base. Behind a tunnel/proxy the upstream Host header may be rewritten — use `NEXT_PUBLIC_APP_URL` as the canonical public origin.
- Skipping the DB nonce consume in any callback path. The signed JWT alone does not prevent replay.
- Dispatcher importing from a specific provider module — only via the registry.

## Edge cases

- **PKCE providers (Twitter, future Google native flows, others):** Dispatcher generates `code_verifier` + `code_challenge` at connect time, persists `code_verifier` on the `oauth_states` row keyed by `nonce`, retrieves at callback via `consumeByNonce`. State expiry: 15 minutes. The `code_verifier` lives only in the DB row — it is the secret half and **never** appears in the signed JWT (would defeat PKCE). Slack default v2 does NOT use PKCE; the columns stay NULL.
- **Rotating refresh tokens (Microsoft, some Google flows):** Refresh response returns a new refresh token. Persistence must be atomic — old refresh token is invalidated server-side as soon as the new one is issued. Lock per `(userId, provider)` during refresh.
- **Non-refreshable providers (Slack default v2 flow, Discord, GitHub Apps with offline tokens, Stripe restricted keys):** Provider's `refreshToken()` is unimplemented or throws `RefreshNotSupported`. On 401, the refresh path emits `action_required` health signal immediately, no refresh attempt. Slack token rotation is opt-in and not used in Slice 1; if a future Slack app enables rotation, the provider module gains a real `refreshToken()` implementation and the manifest declares it refreshable.
- **State CSRF + replay:** State param is signed (HMAC-SHA256) and contains `userId`, `provider`, `nonce`, `expiresAt`, `requestedScopes`. Callback validates signature, expiry, AND atomically consumes the matching `oauth_states` row (`DELETE … WHERE nonce=$1 AND expires_at > now() RETURNING`). A second callback with the same state finds no row and throws `InvalidStateError("already consumed or expired")`. The DB row's `userId` and `provider` are also checked against the JWT payload — a mismatch (key rotation mid-flow, DB tampering) throws `InvalidStateError("state row mismatch")`. After consume, `provider` is verified against the route param; mismatch throws `InvalidStateError("provider mismatch …")` — the consume happens FIRST so a wrong-provider callback still uses up the nonce.
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
5. **Replay protection:** second consume of the same state token rejects with `InvalidStateError("already consumed or expired")`. Provider call + integration insert do not happen on the replay attempt.
6. **State-row mismatch:** JWT and DB row disagreement on `userId` or `provider` rejects with `InvalidStateError("state row mismatch")`.
7. **Provider mismatch + nonce burn:** wrong-provider callback with valid state still consumes the nonce before throwing — replay against the correct provider's route then also fails.
8. PKCE: `code_verifier` persisted on the `oauth_states` row at connect, retrieved at callback. Never present in the signed JWT.
9. Refresh path locks per `(userId, provider)`.
10. Concurrent refresh: only one provider call.
11. Non-refreshable provider on refresh: throws `RefreshNotSupported`, dispatcher emits `action_required`.

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
