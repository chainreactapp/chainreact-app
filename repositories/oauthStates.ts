import { getServiceRoleClient } from "./supabase/serviceRoleClient";

/**
 * Repository for the oauth_states system table.
 *
 * Per docs/rules/oauth-dispatcher.md + database-security.md: service-role
 * only. No user RLS scope — the table holds ephemeral OAuth state nonces
 * tied to in-flight authorization flows; nothing user-facing reads it.
 *
 * Only consumer is services/oauth/state.ts (createState writes; consumeState
 * atomically deletes-if-fresh).
 */

export interface OAuthStateRow {
  nonce: string;
  userId: string;
  provider: string;
  /** ISO-8601. */
  expiresAt: string;
  pkceCodeVerifier: string | null;
  pkceCodeChallengeMethod: string | null;
  createdAt: string;
}

export interface CreateOAuthStateInput {
  nonce: string;
  userId: string;
  provider: string;
  /** ISO-8601 string. */
  expiresAt: string;
  /** Optional — only providers that use PKCE store a verifier. */
  pkceCodeVerifier?: string;
  pkceCodeChallengeMethod?: string;
}

interface OAuthStatesRow {
  nonce: string;
  user_id: string;
  provider: string;
  expires_at: string;
  pkce_code_verifier: string | null;
  pkce_code_challenge_method: string | null;
  created_at: string;
}

function rowToRecord(row: OAuthStatesRow): OAuthStateRow {
  return {
    nonce: row.nonce,
    userId: row.user_id,
    provider: row.provider,
    expiresAt: row.expires_at,
    pkceCodeVerifier: row.pkce_code_verifier,
    pkceCodeChallengeMethod: row.pkce_code_challenge_method,
    createdAt: row.created_at,
  };
}

export async function create(input: CreateOAuthStateInput): Promise<void> {
  const supabase = getServiceRoleClient(
    `oauth state: create nonce for ${input.provider} (user ${input.userId})`,
  );
  const { error } = await supabase.from("oauth_states").insert({
    nonce: input.nonce,
    user_id: input.userId,
    provider: input.provider,
    expires_at: input.expiresAt,
    pkce_code_verifier: input.pkceCodeVerifier ?? null,
    pkce_code_challenge_method: input.pkceCodeChallengeMethod ?? null,
  });
  if (error) {
    throw new Error(`oauth_states.create failed: ${error.message}`);
  }
}

/**
 * Atomic delete-if-fresh. Returns the row if it existed and hadn't expired
 * (caller proceeds with the OAuth flow); returns null if the row was missing
 * (replay attempt / first-time use of an unknown nonce) or expired.
 *
 * The expires_at predicate inside the DELETE is what makes this race-free:
 * two concurrent callbacks for the same state can both run, but only one
 * will see a row in RETURNING — the other gets an empty result and rejects.
 *
 * Expired rows are intentionally not deleted here so the reaper can sweep
 * them in batches (and so post-mortem queries can distinguish "expired" from
 * "never existed" if needed). The cron reaper handles eventual cleanup.
 */
export async function consumeByNonce(nonce: string): Promise<OAuthStateRow | null> {
  const supabase = getServiceRoleClient(
    `oauth state: consume nonce ${nonce.slice(0, 8)}…`,
  );
  const { data, error } = await supabase
    .from("oauth_states")
    .delete()
    .eq("nonce", nonce)
    .gt("expires_at", new Date().toISOString())
    .select("*")
    .maybeSingle<OAuthStatesRow>();
  if (error) {
    throw new Error(`oauth_states.consumeByNonce failed: ${error.message}`);
  }
  return data ? rowToRecord(data) : null;
}

/**
 * Reaper: deletes all rows past their expiry. Called by a future cron
 * (slice TBD). Returns the number of rows deleted for observability.
 */
export async function reapExpired(): Promise<number> {
  const supabase = getServiceRoleClient("oauth state: reap expired rows");
  const { data, error } = await supabase
    .from("oauth_states")
    .delete()
    .lte("expires_at", new Date().toISOString())
    .select("nonce");
  if (error) {
    throw new Error(`oauth_states.reapExpired failed: ${error.message}`);
  }
  return data?.length ?? 0;
}
