# Rule: Database Security (RLS, Tenant Isolation, Token Encryption)

## Purpose

Define how ChainReactV2 secures data at rest in Supabase. Every user-data table has Row-Level Security (RLS) enabled with explicit policies the moment it's created — never bolted on later. Service-role access is server-side only and scoped. Sensitive columns (OAuth tokens, secrets) are application-layer encrypted on top of RLS. Tenant isolation across workspaces is enforced in the database, not in application filters.

Security is part of the schema, not a layer above it.

## Resolved Decisions

**Locked for Slice 1:**
- **RLS enabled on every user-data and tenant-data table.** No exceptions. The migration that creates such a table MUST enable RLS and define at least one policy in the **same migration**.
- **Default-deny.** RLS-enabled tables with no policies = no access. Policies are written per-operation (SELECT / INSERT / UPDATE / DELETE) with the narrowest scope that satisfies the use case.
- **Application-layer encryption for sensitive columns.** OAuth access tokens, refresh tokens, signing secrets, webhook secrets, and any user-supplied API keys in the `integrations` table (and equivalents) are encrypted with AES-256 using `TOKEN_ENCRYPTION_KEY` **before** being written. RLS is defense-in-depth; encryption is the primary control.
- **Service-role access is server-side only.** `SUPABASE_SERVICE_ROLE_KEY` never has a `NEXT_PUBLIC_` prefix and never reaches the client bundle. The service-role Supabase client is constructed in a single helper (`repositories/supabase/serviceRoleClient.ts`); repositories that legitimately need RLS bypass (cron tables, system writes, admin tools) request it explicitly per call.
- **Tenant scope via membership join.** Tables involving workspaces / teams include a `workspace_id` column; RLS policies join through `team_members` to verify the caller is a member.
- **Audit columns on every table:** `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ`, plus `created_by uuid` (user id) where ownership is tracked. `updated_at` maintained by trigger.
- **No raw SQL with user input.** Always parameterized through the Supabase JS client. If a query genuinely needs raw SQL, it lives as a Postgres function (`SECURITY DEFINER` only when justified) where user input becomes a parameter.
- **CI migration lint.** A migration that creates a user-data table without `ENABLE ROW LEVEL SECURITY` and at least one policy fails CI.
- **Tests verify policies.** For every table with RLS, an integration test asserts: (a) user A reads/writes their own rows, (b) user A cannot read or write user B's rows, (c) anon role gets nothing, (d) service-role bypass works *only* in repositories declared to use it.

**Deferred decisions:**
- Whether to add `pgsodium` / Vault for column-level encryption inside Postgres in addition to application-layer encryption. Slice 1: app-layer only. Revisit when Vault availability and key-rotation needs are clearer.
- Audit-log table format (every privileged action recorded). Stub the table in Slice 1; full schema lands when admin tooling does.

**Decisions requiring product-owner input:**
- Public-read tables (e.g., predefined templates): final list confirmed when templates land in V2.

## Current V1 problem being solved

V1 has RLS enabled on most tables but with inconsistencies:
- Some tables added during rapid iteration shipped without policies and were patched later.
- Service-role usage is scattered across many service files, not concentrated in one helper. The service-role boundary is enforced by convention, not by structure.
- Token encryption exists but the encryption helpers are mixed with business logic. Decrypt failures aren't handled with the discipline they deserve.
- Migrations don't have a CI lint that fails when a new table lacks RLS.
- Tests for RLS exist (`__tests__/infra/rls.test.ts` and similar) but coverage is uneven — newer tables can ship without policy tests.

The result: RLS is the intent but not always the reality. V2 makes RLS structural, not aspirational.

## V2 intended behavior

Every migration that creates a user-data or tenant-data table follows a strict template:

```sql
CREATE TABLE public.<table> (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- or workspace_id, depending on scope
  -- ... columns ...
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "<table>_select_own" ON public.<table>
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "<table>_insert_own" ON public.<table>
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "<table>_update_own" ON public.<table>
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "<table>_delete_own" ON public.<table>
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER <table>_set_updated_at
  BEFORE UPDATE ON public.<table>
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

Tenant-scoped tables substitute the user-id check with a workspace membership join:

```sql
CREATE POLICY "<table>_select_workspace_member" ON public.<table>
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.workspace_id = <table>.workspace_id
    )
  );
```

Sensitive columns (OAuth tokens, secrets) go through an encryption helper before being written:

```ts
// repositories/integrations.ts (server-side)
const encryptedToken = encryptToken(plaintextToken);
await supabase.from("integrations").insert({
  /* ... */
  access_token: encryptedToken,
});
```

Reading and decrypting is symmetric and lives in the same repository.

The service-role client is constructed once and used through a typed wrapper:

```ts
// repositories/supabase/serviceRoleClient.ts
export function getServiceRoleClient(reason: string): SupabaseClient {
  // log the reason for audit; return cached client
}
```

Repositories that need it call `getServiceRoleClient("renew-microsoft-graph-subscription")` explicitly. The reason string ends up in logs.

## Single source of truth

- **RLS policies** for a table live in the migration that creates the table. Subsequent policy changes are forward-only migrations.
- **Token encryption / decryption helpers:** `core/encryption/tokens.ts` (a pure module that takes the key from env and exports `encryptToken(plaintext)` / `decryptToken(ciphertext)`).
- **Service-role client construction:** `repositories/supabase/serviceRoleClient.ts`. Nothing else imports `createClient(... SERVICE_ROLE_KEY ...)` directly.
- **Tenant membership policy template:** `supabase/migrations/<initial>_membership_helpers.sql` — a reusable pattern referenced from per-table migrations.
- **Audit triggers** (`set_updated_at` function): defined once in the initial migration, reused by every table.

## Allowed flows

- **User-scoped read:** anon-key Supabase client with the user's session token → RLS enforces `auth.uid() = user_id`.
- **User-scoped write:** same as above; policies' `WITH CHECK` clauses prevent users from writing rows owned by others.
- **Tenant-scoped read/write:** anon-key client → RLS joins `team_members` to verify membership.
- **Cron / system write that legitimately bypasses user scope:** server-side service calls a repository that explicitly invokes `getServiceRoleClient("<reason>")`. Reason logged.
- **Webhook receipt insertions:** thin route hands off to `services/webhooks/`; the service uses `getServiceRoleClient("webhook-event-dedup")` to write to `webhook_event_dedup`.
- **OAuth callback after out-of-band identity proof:** the dispatcher (`services/oauth/dispatcher.ts:handleCallback`) verifies user identity via signed state token + atomic `oauth_states` nonce consume. The `integrations` row insert (`repositories/integrations.ts:upsertActive`) then uses `getServiceRoleClient("oauth callback: upsertActive <provider> for user <id>")` because the SSR-cookie path is unreliable (cookies don't cross hosts in tunnel/proxy/multi-tenant scenarios) AND redundant (identity is already proven). State-token persistence (`oauth_states`) is system-table — service-role only end to end.
- **Admin tooling:** route uses `requireAdmin({ capabilities: [...] })` plus a service that uses `getServiceRoleClient("admin-action-<name>")` for the writes that need it. Step-up auth as documented in the V1 admin pattern.
- **Token storage:** repository encrypts before insert; reads decrypt on the way out, only for the immediate caller, never logged.

## Disallowed behavior

- Creating a user-data table without RLS in the same migration.
- Defining RLS but no policies and shipping the table — that's "deny everything, no one can use it" (which is a different bug, also caught in CI).
- Using `auth.role() = 'authenticated'` as the only check on a user-data table. Authenticated users can still see other users' rows that way. Always include an ownership / membership check.
- Letting `SUPABASE_SERVICE_ROLE_KEY` reach client code (no `NEXT_PUBLIC_` prefix; ESLint rule blocks importing from env on the client side).
- Constructing a service-role Supabase client outside `repositories/supabase/serviceRoleClient.ts`.
- Using the service-role client in a path triggered by a regular user request without an explicit reason and audit log entry.
- Storing OAuth tokens, refresh tokens, signing secrets, or user-supplied API keys in plaintext.
- Logging decrypted tokens, even at debug level. Even one slip leaks production secrets to log aggregators.
- Building SQL strings via interpolation with user input. Always parameterized; raw SQL only inside Postgres functions.
- Modifying an existing applied migration. Forward-only after merge.
- Skipping policy tests for a new table. The integration test goes in the same PR as the migration.

## Edge cases

- **Public-read tables** (predefined templates, public docs): `SELECT` policy `USING (true)` and no INSERT/UPDATE/DELETE policies. RLS still enabled.
- **System tables** (cron-resource state, webhook dedup, OAuth state nonces): no user RLS scope; service-role only. Document the table's reason in a header comment in the migration (`-- system-table: <table> — <reason>` opts the migration out of the user-data RLS lint). RLS still ENABLE'd as defense-in-depth with a deny-all policy (`FOR ALL USING (false) WITH CHECK (false)`). Tests verify anon and authenticated roles cannot read. Examples: `webhook_event_dedup`, `oauth_states`.
- **Admin-only tables:** policy joins `user_profiles.admin_capabilities`; admin route uses `requireAdmin({ capabilities: [...] })` upstream.
- **Multi-tenant user in multiple workspaces:** the membership-join policy handles this cleanly because `team_members` has one row per (user, workspace) pair.
- **User account deletion (`auth.users` cascade):** `ON DELETE CASCADE` on user-scoped tables removes orphans automatically. Tenant-scoped tables retain rows with the workspace.
- **Webhooks for unauthenticated events** (Slack URL verification, Stripe webhook): the route uses service-role to insert / dedup; no user session exists at that point.
- **Encrypted-token migration during V1 → V2 cutover:** decrypt with V1 key, re-encrypt with V2 key, in an isolated environment. Master plan §12.C is the runbook.
- **Key rotation:** if `TOKEN_ENCRYPTION_KEY` rotates, a one-shot script reads, decrypts with old key, re-encrypts with new key, in batches. Document in `docs/runbooks/`.
- **Decryption failure:** treated as a fatal integration error — the integration row's health flips to `disconnected`, user is forced to reconnect, the cleartext is never reconstructed. Never silently retry decryption.

## Required tests

Integration tests in `tests/integration/security/`:

1. **RLS smoke test per table.** For every user-data table: user A creates a row; user A reads it (succeeds); user B reads it (returns nothing or 0 rows); anon reads it (returns nothing); user B updates it (no rows affected); user B deletes it (no rows affected).
2. **Tenant isolation test.** For every workspace-scoped table: workspace A's rows are invisible to workspace B's members.
3. **Service-role bypass test.** For tables that intentionally allow service-role bypass (`webhook_event_dedup`, cron tables): the service-role client can write; the anon-key client cannot.
4. **No service-role exposure test.** A static check (`tests/structure/`) scans the client bundle output for any reference to `SERVICE_ROLE` env var name. Fails if found.
5. **Encryption round-trip test.** `encryptToken(plaintext)` → store → fetch → `decryptToken(...)` returns the original plaintext exactly.
6. **No-cleartext-tokens test.** Pattern-scan the `integrations` table's encrypted columns to assert they don't look like plaintext (e.g., not `xoxb-...`, `gho_...`, `sk-...`, etc.). Catch accidental cleartext writes.

CI checks (lint-style):

7. **Migration RLS lint.** A linter scans every migration file for `CREATE TABLE` and verifies the same migration contains `ENABLE ROW LEVEL SECURITY` and at least one `CREATE POLICY` for the table — unless the migration declares the table as a system table with a header comment that justifies it.
8. **Service-role import guard.** ESLint rule restricts `createClient` calls with `SERVICE_ROLE_KEY` to `repositories/supabase/serviceRoleClient.ts`.

## V1 behavior to preserve

- Existing RLS policies that work — port them as-is into the V2 initial migration where they apply.
- Token encryption pattern (AES-256, encryption key from env) — port the helper and tests, relocate to `core/encryption/tokens.ts`.
- Three-layer admin auth (middleware → `requireAdmin` → scoped helpers) — port from V1's [admin auth architecture](../../../../nstoddard17/chainreact-app-9e/lib/utils/admin-auth.ts).
- `set_updated_at` trigger pattern.

## V1 behavior to drop

- Any table with RLS disabled or with no policies (the "open" tables).
- Service-role client construction scattered across files.
- Plaintext tokens that may have leaked into other columns or backups.
- Admin actions that take a service-role client at the route layer instead of inside a scoped helper.

## Open questions

No open questions block Slice 1. Slice 1 establishes the migration template, the encryption module, the service-role helper, and the policy-test scaffold. Subsequent slices use them.
