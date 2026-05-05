# Auth Reliability Refactor — Implementation Plan

**Status:** planning
**Created:** 2026-05-05
**Driver:** the "Create Workflow" silent-click bug ([fix shipped 2026-05-05](../walkthroughs/) — see `lib/auth/session.ts`) exposed a structural problem: ~40 client-side `supabase.auth.getSession()` call sites all share one `@supabase/ssr` navigator lock, and a single hung call wedges every dependent UI flow.

## Goal
Make cached auth state the normal path for client actions. `supabase.auth.getSession()` should be hit only when the cache is cold or expiring, not on every dropdown / API request / cascading-field load.

## Out of scope
- Server-side `auth.getUser()` calls in API routes — those use the SSR cookie-based client and don't share the browser lock.
- The auth boot flow itself (`stores/authBootMachine.ts`) — already mitigated with the `getSession() ↔ onAuthStateChange` race.
- OAuth / magic-link / SSO flows — bootstrapping, not steady-state.
- Replacing the single-flight pattern with the supabase client's own internal lock — we want a layer *above* it, not a replacement.

## Sequencing rationale
- **PR-AUTH-1 first** (defensive): removing the async/await from `onAuthStateChange` is a standalone bug fix and de-risks every later PR (the cache writes in PR-AUTH-2 must run from a fast, lock-safe callback).
- **PR-AUTH-2 + PR-AUTH-3** (foundation): build the cache and the single-flight reader. No migrations yet — these are no-ops until something reads from them.
- **PR-AUTH-4** (highest leverage): `lib/apiClient.ts` is on every API request. Migrating it alone removes ~50% of `getSession()` calls from steady-state traffic.
- **PR-AUTH-5** (sweep): the long tail of dropdown / field / billing / AI / file-upload sites.
- **PR-AUTH-6** (cleanup): once the migration is done, kill the unused parallel clients.
- **PR-AUTH-7** (observe): land the metrics and update guardrails so this doesn't regress.

## Acceptance criteria for the whole refactor
- 0 client-side `supabase.auth.getSession()` calls outside of `lib/auth/` and `stores/auth*.ts`.
- 0 client-side `supabase.auth.getUser()` calls outside of the auth subsystem.
- `onAuthStateChange` callbacks return synchronously (no `async`, no `await`).
- Token-cache hit rate ≥ 95% in steady-state.
- Build green; `npm test` green; `npm run dev` smoke test passes.

---

## PR-AUTH-1: Stop async work inside onAuthStateChange

**Goal:** the `onAuthStateChange` callback at [stores/authStore.ts:543](../../stores/authStore.ts#L543) becomes synchronous. Profile fetches and `boot()` calls are dispatched via `queueMicrotask` so the supabase listener returns immediately and releases the navigator lock.

**Files touched**
- `stores/authStore.ts:543-617` — convert the listener body to sync, schedule async work via `queueMicrotask`.
- `stores/authStore.ts:202-206` — `refreshSession()` on plan-change is already fire-and-forget, but verify it isn't called from inside the listener path; if it is, also defer.

**Key changes**
```ts
// before
supabase.auth.onAuthStateChange(async (event, session) => {
  ...
  const { data: profileData } = await supabase.from('user_profiles')...
  ...
  state.boot()
})

// after
supabase.auth.onAuthStateChange((event, session) => {
  // Snapshot the event payload synchronously (fast — just zustand writes).
  if (event === 'SIGNED_IN' && session?.user) { useAuthStore.setState({ user: ... }) }
  if (event === 'SIGNED_OUT')                  { useAuthStore.setState({ user: null, ... }) }

  // Defer any Supabase REST / boot work to a microtask so the SDK callback
  // returns before we re-enter the auth subsystem.
  queueMicrotask(() => { void handleAuthEventAsync(event, session) })
})
```

**Tests**
- New: `__tests__/auth/onAuthStateChange-sync.test.ts` — given a slow `from('user_profiles')` mock, the callback returns within 5ms; the async profile fetch resolves later.
- Existing: re-run `__tests__/auth/session-fallback.test.ts` (no changes expected; this PR shouldn't affect SessionManager).

**Risks**
- Profile state lags the user state by one microtask. Most consumers already handle a `user` without `profile` (the boot machine does). Verify `WorkflowsContentInner` and `LayoutSidebar` don't crash on `profile === null`.
- Cross-tab broadcasts (`sync.broadcast('auth-login', ...)`) currently include the profile snapshot. After this PR they may be sent before the profile is hydrated. Either accept that (next tab will fetch its own profile) or move the broadcast into the deferred handler.

**Acceptance**
- No `async` keyword on the `onAuthStateChange` callback.
- New test passes.
- Manual smoke test: log in, log out, refresh — no regression.

---

## PR-AUTH-2: Add accessToken/accessTokenExpiresAt to the auth store

**Goal:** Zustand owns the access token. Whenever the SDK gives us a fresh session, we mirror `access_token` + `expires_at` into the store. Reading is synchronous; no lock involved.

**Files touched**
- `stores/authStore.ts` — extend `BootSlice` (or add a new slice) with `accessToken: string | null`, `accessTokenExpiresAt: number | null` (epoch seconds).
- `stores/authBootMachine.ts:402-410` — on session resolution, write the token to the store alongside `user`/`profile`.
- `stores/authStore.ts` `onAuthStateChange` (now sync per PR-AUTH-1) — write the token on every SIGNED_IN / TOKEN_REFRESHED event.
- `stores/authStore.ts` `refreshSession`, `signIn`, OAuth helpers — write the token on success.
- `persist` config — **do NOT persist the token** to localStorage (it's already in `sb-*-auth-token` and persisting twice is a security/sync hazard). Mark `accessToken`/`accessTokenExpiresAt` as transient via the `partialize` option.

**Key changes**
```ts
interface BootSlice {
  ...
  accessToken: string | null
  accessTokenExpiresAt: number | null  // epoch seconds (matches supabase shape)
}

function setSessionTokens(session: Session | null) {
  useAuthStore.setState({
    accessToken: session?.access_token ?? null,
    accessTokenExpiresAt: session?.expires_at ?? null,
  })
}
```

**Tests**
- New: `__tests__/auth/authStore-token-cache.test.ts`
  - boot resolution writes token + expiry
  - SIGNED_IN event updates token
  - SIGNED_OUT event clears token
  - `signIn` success writes token
  - `refreshSession` success updates token
  - persist `partialize` excludes `accessToken`/`accessTokenExpiresAt`

**Risks**
- Token in memory is fine; token in localStorage would be a regression. The `partialize` test guards this.
- `expires_at` is sometimes missing on older sessions — treat null as "expired" (forces refresh).

**Acceptance**
- All 6 unit tests pass.
- Manual: `useAuthStore.getState().accessToken` is populated after login.
- localStorage `chainreact-auth` does NOT contain `accessToken`.

---

## PR-AUTH-3: Add getAuthHeader() single-flight helper

**Goal:** one function, callable from anywhere, returns `{ Authorization: 'Bearer ...' }` without hitting `getSession()` when the cached token is fresh. When refresh is needed, deduplicate concurrent calls via a single-flight promise.

**Files touched**
- New: `lib/auth/getAuthHeader.ts` — the helper.
- New: `__tests__/auth/getAuthHeader.test.ts` — tests.

**Contract**
```ts
// Returns { Authorization: 'Bearer <token>' }, or {} if user is not authenticated.
// Throws never — failures degrade to {} so callers' fetch sees a 401 they can handle.
export async function getAuthHeader(opts?: {
  // 'cache-only' returns {} immediately if cache is stale instead of refreshing.
  // Useful for fire-and-forget telemetry calls that mustn't block on auth.
  mode?: 'auto' | 'cache-only'
}): Promise<Record<string, string>>
```

**Algorithm**
1. Read `accessToken` + `accessTokenExpiresAt` from `useAuthStore.getState()`.
2. If token present AND `expiresAt - now > 60s` → return `{ Authorization: ... }` synchronously. **Cache hit.**
3. If `mode === 'cache-only'` → return `{}`. **Cache miss, no refresh.**
4. Else → enter single-flight refresh:
   - If a refresh promise is already pending → `await` it.
   - Otherwise create one: `refreshPromise = SessionManager.getSecureUserAndSession()`. On resolve, write token to store + clear ref. On reject, clear ref.
5. After refresh, re-read store. Token present → return header. Else → return `{}`.

**Single-flight implementation**
```ts
let inflight: Promise<UserSession | null> | null = null
async function ensureFreshToken(): Promise<void> {
  if (inflight) { await inflight; return }
  inflight = SessionManager.getSecureUserAndSession()
    .catch((err) => { logger.warn(...); return null })
  try {
    const result = await inflight
    if (result) setSessionTokens(result.session)  // PR-AUTH-2 helper
  } finally {
    inflight = null
  }
}
```

**Tests** (`__tests__/auth/getAuthHeader.test.ts`)
- cache hit → returns header synchronously, no SDK call
- cache stale (expiring < 60s) → calls refresh, returns new header
- cache miss → calls refresh, returns header
- 100 concurrent calls during refresh → SDK called exactly once (single-flight)
- refresh failure → returns `{}`, no throw
- `mode: 'cache-only'` with stale cache → returns `{}` immediately, no SDK call
- token cleared after SIGNED_OUT → returns `{}`

**Risks**
- 60-second safety margin: if a request takes >60s, the token might expire mid-flight. The server already returns 401 in that case; callers should handle 401 → retry-with-refresh (existing pattern in `apiClient`).
- Single-flight is intra-tab; multi-tab refresh storms still happen but supabase's own lock serializes them.

**Acceptance**
- All 7 tests pass.
- Helper exported from `lib/auth/getAuthHeader.ts` and re-exported from a stable barrel (`lib/auth/index.ts`).

---

## PR-AUTH-4: Migrate lib/apiClient.ts first

**Goal:** the per-request `getUser()` + `getSession()` double-call at [lib/apiClient.ts:44-51](../../lib/apiClient.ts#L44-L51) becomes one call to `getAuthHeader()`. Highest-traffic site in the app.

**Files touched**
- `lib/apiClient.ts:35-71` — replace `getAuthHeaders()` body with `getAuthHeader()` call.
- `lib/apiClient.ts:119-141` — keep the 431-recovery path; on 401, call `getAuthHeader()` again with a forced-refresh option (small extension to PR-AUTH-3 if needed).

**Key change**
```ts
// before
private async getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error("Not authenticated")
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) return { Authorization: `Bearer ${session.access_token}` }
  return {}
}

// after
private async getAuthHeaders(): Promise<Record<string, string>> {
  return getAuthHeader()  // cached path; falls back to refresh internally
}
```

**Tests**
- New: `__tests__/lib/apiClient-cached-auth.test.ts`
  - apiClient request uses cached token, no `getSession` call
  - apiClient request with hung `getSession` mock → still completes via cache (regression guard for the original bug)
  - 401 response triggers a refresh + retry once, then surfaces the error

**Risks**
- Some routes accept the `Authorization` header *and* the cookie. Both should still work — the helper only changes how the header is sourced.
- Logging spam: the existing `getAuthHeaders` logs a lot. Drop the noisy `🔍 Getting auth headers...` lines or move them to debug.

**Acceptance**
- New tests pass; existing `apiClient`-touching tests pass.
- Manual: open the workflows page, count `getSession` calls in DevTools → drops to 0 for normal navigation.

---

## PR-AUTH-5: Migrate workflow config field loaders, billing, AI, file-upload

**Goal:** the long-tail call sites (39 client-side `getSession` calls across 23 files identified in the audit) all switch to `getAuthHeader()`.

**Files touched** (grouped by area)

| Area | Files |
|---|---|
| Workflow config field loaders | `components/workflows/configuration/providers/GenericConfiguration.tsx` (×6), `components/workflows/configuration/fields/gmail/GmailAttachmentField.tsx` (×3), `components/workflows/configuration/fields/googledrive/GoogleDriveFileField.tsx` (×3), `components/workflows/configuration/ShareConnectionDialog.tsx` (×3), `components/workflows/configuration/ServiceConnectionSelector.tsx`, `components/workflows/configuration/tabs/SetupTab.tsx`, `components/workflows/configuration/hooks/useFieldChangeHandler.ts`, `components/workflows/configuration/providers/dropbox/dropboxOptionsLoader.ts`, `components/workflows/configuration/providers/google-drive/GoogleDriveOptionsLoader.ts`, `components/workflows/configuration/fields/notion/NotionBlockFields.tsx`, `components/workflows/configuration/fields/shared/GenericTextInput.tsx`, `components/workflows/OneNoteSelector.tsx` |
| AI surfaces | `components/ai/AIAssistantContent.tsx` (×8 + ×2 getUser), `components/ai/VoiceMode.tsx`, `components/ai/VoiceModeSimple.tsx` (×2), `components/ai/AIAssistantComingSoon.tsx` (getUser) |
| Billing | `components/billing/OverageToggle.tsx`, `components/billing/TaskPackSection.tsx`, `stores/billingStore.ts` (×3 — getSession + 2 getUser) |
| File upload | `components/ui/file-upload.tsx` |
| Other stores using getUser | `stores/activityStore.ts`, `stores/businessContextStore.ts` (×2), `stores/userProfileStore.ts` (×2), `stores/workflowPreferencesStore.ts` (×2), `stores/workflowStore.ts:1171` |
| Hooks | `hooks/workflows/useWorkflowActions.ts:64`, `hooks/workflows/useWorkflowExecution.ts:823` |

**Migration pattern**
```ts
// before
const { data: { session } } = await supabase.auth.getSession()
const res = await fetch('/api/foo', {
  headers: { Authorization: `Bearer ${session?.access_token}` }
})

// after
const headers = await getAuthHeader()
const res = await fetch('/api/foo', { headers })
```

For `getUser()` call sites that just need `user.id`: read from `useAuthStore.getState().user?.id` instead.

**Strategy**
- Land in 3 sub-PRs to keep diffs reviewable: (a) config field loaders, (b) AI + billing, (c) stores + hooks + remaining components.
- Each sub-PR includes a smoke test for one representative call site (don't aim for 1:1 coverage — too much busywork).
- Add an ESLint rule (or a custom grep-based CI check) that fails if `supabase.auth.getSession\(\)` appears outside `lib/auth/`, `stores/auth*.ts`, `app/auth/**`, `components/auth/**`.

**Tests**
- Representative integration tests (one per area) using RTL: open the dropdown / panel → `getAuthHeader` called, `getSession` NOT called.
- ESLint / grep guard added to CI.

**Risks**
- Some call sites also rely on `session.user` (not just `access_token`). Switch those to `useAuthStore.getState().user`.
- `useFieldChangeHandler.ts` is hot-path code in the builder; benchmark before/after to ensure no perf regression from the indirection (expect it to be faster, not slower).

**Acceptance**
- Each sub-PR independently green.
- Final state: grep for `supabase.auth.getSession\(\)` returns zero hits outside the auth subsystem.

---

## PR-AUTH-6: Remove duplicate/unused Supabase browser clients

**Goal:** one browser client, one auth owner.

**Files touched**
- Delete `components/providers/SupabaseProvider.tsx` (zero consumers — verified in audit).
- Delete `lib/supabase-context.ts` (only consumer is the provider above).
- Delete `lib/supabase.ts` (zero in-app importers — verified in audit).
- `app/layout.tsx:8,157,176` — remove `<SupabaseProvider>` wrapper.
- `app/invite/page.tsx` + `app/invite/signup/page.tsx` — replace `createClient` from `@supabase/supabase-js` with `createClient` from `@/utils/supabase/client`. Removes the divergent-cookie-stack class.

**Verification before delete**
```bash
grep -rn "from '@/components/providers/SupabaseProvider'" .
grep -rn "from '@/lib/supabase-context'" .
grep -rn "from '@/lib/supabase'" .
grep -rn "useSupabase\|SupabaseContext" .
```
All four should return zero hits before the delete commit.

**Tests**
- No new tests; `npm run build` + existing test suite passing is the contract.
- Manual smoke: invite link flow (`/invite?token=...&org=...`) — load, accept, sign-up.

**Risks**
- Invite pages currently lazy-construct their own client. After migration they share the singleton — auth state from a logged-in user will leak in. That's actually desired (auto-accept flow at line 68 already wants this), but verify the unauthenticated invite flow still works.

**Acceptance**
- 4 deleted files, 1 layout edit, 2 invite pages migrated.
- Build + tests green.
- Invite flow manually verified.

---

## PR-AUTH-7: Add monitoring/logging and update CLAUDE.md auth guardrails

**Goal:** instrument the cache so we can see hit rate, fallback frequency, and refresh storms. Lock in the patterns via CLAUDE.md.

**Files touched**
- `lib/auth/getAuthHeader.ts` — emit counters (existing `logger.debug` at first; promote to a real metric sink only if/when one exists).
- `lib/auth/session.ts` — already has timeout-fallback log from the 2026-05-05 fix; promote to `logger.warn` and add a structured tag (`event: 'auth.getSession_timeout_fallback'`) so it's queryable.
- `stores/authStore.ts` — log every `onAuthStateChange` event with phase + cache hit/miss.
- `CLAUDE.md` Section 10 (Auth Store Guardrails) — append the new rules.

**Counters to track** (logger.debug, structured)
- `auth.cache_hit` — incremented on every cache hit (mode=auto)
- `auth.cache_miss_refreshed` — refresh succeeded
- `auth.cache_miss_failed` — refresh returned `{}` (user signed out / refresh failed)
- `auth.single_flight_dedup` — concurrent caller awaited in-flight refresh
- `auth.getSession_timeout_fallback` — the 2026-05-05 path (refreshSession after timeout)
- `auth.refresh_failure` — both getSession AND refreshSession failed

**CLAUDE.md additions** (Section 10)
```markdown
## Auth Token Access — Use Cached Header
- **NEVER** call `supabase.auth.getSession()` from client components, hooks, or stores outside `lib/auth/`, `stores/auth*.ts`, `app/auth/**`, or `components/auth/**`. Use `getAuthHeader()` from `@/lib/auth/getAuthHeader` instead.
- **NEVER** call `supabase.auth.getUser()` client-side to get the current user id. Read `useAuthStore.getState().user?.id` from the cached store.
- `onAuthStateChange` callbacks MUST be synchronous. Defer any Supabase / REST / boot work via `queueMicrotask`. Awaiting inside the listener holds the navigator lock and deadlocks `getSession()` callers.
- Only `lib/auth/session.ts` (and the boot machine's race) may call `getSession()` / `refreshSession()` directly.
- ESLint guard at `.eslintrc` enforces these rules — see `no-restricted-syntax` rule for `supabase.auth.getSession`.
```

**Tests**
- Unit test that the structured log tags are emitted on each path.
- ESLint rule has a passing test (an allowed file) and a failing test (a disallowed file).

**Risks**
- Logger spam if cache hits are very frequent. Emit hits at `debug` (off in prod), misses at `info`, failures at `warn`.

**Acceptance**
- Counters emit at expected log levels.
- CLAUDE.md updated, lint rule added.
- Final grep confirms zero `supabase.auth.getSession()` outside the allowed paths.

---

## Cross-cutting concerns

### Rollback strategy
Each PR is independently revertable. PR-AUTH-2/3 land changes that no caller exercises until PR-AUTH-4. If PR-AUTH-4 misbehaves in production, revert it; PR-AUTH-2/3 stay as dormant infrastructure. PR-AUTH-1 is the only one whose revert affects user-visible behavior (the listener goes back to async).

### Testing approach
- **Unit:** every new helper has a Jest test (PR-AUTH-2/3/7).
- **Integration:** representative call-site test per area in PR-AUTH-5.
- **Regression:** PR-AUTH-4 includes a "hung getSession" test that proves the original "Create Workflow" silent-click bug stays dead.
- **Manual smoke:** after PR-AUTH-5 sub-c, walk through workflow create → config a Gmail node → open the integrations page → trigger an AI suggestion. Verify zero `auth.getSession` calls in DevTools network/console.

### Estimated effort
Rough sizing — adjust as we go:

| PR | Size | Risk |
|---|---|---|
| PR-AUTH-1 | S (1 file, ~20 lines) | low |
| PR-AUTH-2 | S (3 files, ~50 lines + tests) | low |
| PR-AUTH-3 | M (1 new file ~80 lines + tests) | medium |
| PR-AUTH-4 | S (1 file, ~10 lines + tests) | medium |
| PR-AUTH-5 | L (~25 files, mechanical, 3 sub-PRs) | low-medium |
| PR-AUTH-6 | S (4 deletes + 2 migrations) | low |
| PR-AUTH-7 | S (logging + docs + lint rule) | low |

### Decisions to confirm before starting
1. Token cache safety margin: **60 seconds** (recommended). Larger = more cache misses; smaller = more requests with about-to-expire tokens.
2. Single-flight scope: **intra-tab only** (recommended; cross-tab serialization is supabase's job).
3. ESLint guard placement: prefer a custom rule in `.eslintrc.cjs`; alternative is a CI grep check. Custom rule is more discoverable but adds plugin maintenance.
4. Whether to bundle `lib/auth/getAuthHeader.ts` and `lib/auth/session.ts` exports under a single `@/lib/auth` barrel. Recommend yes.
5. PR-AUTH-7 instrumentation sink: the codebase has `logger.debug/info/warn` but no metrics platform wired up. Plan documents structured log tags so a real metrics sink can scrape them later — no separate metrics infrastructure in this PR.
