import { createClient } from "@/utils/supabase/server";
import type { EncryptedTokens, ProviderAccountInfo } from "@/contracts/integration";

/**
 * Repository for the integrations table.
 *
 * Per docs/rules/database-security.md and project-structure-and-module-boundaries.md:
 *   - Server-side only. Never imported by client code (lint guard enforces this).
 *   - All token columns are encrypted by the caller before reaching this layer.
 *     Repository never encrypts/decrypts; tokens come in already-encrypted from
 *     the OAuth handler and go out as-encrypted to be decrypted by services
 *     that explicitly need plaintext.
 */

export interface IntegrationRecord {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  displayName: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  /** ISO-8601 string from Postgres timestamptz, null if no expiry. */
  accessTokenExpiresAt: string | null;
  scopes: readonly string[];
  accountMetadata: Readonly<Record<string, unknown>>;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertActiveInput {
  userId: string;
  provider: string;
  providerAccountId: string;
  displayName: string | null;
  tokens: EncryptedTokens;
  accountMetadata: ProviderAccountInfo["metadata"];
}

interface IntegrationsRow {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
  display_name: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  access_token_expires_at: string | null;
  scopes: string[];
  account_metadata: Record<string, unknown>;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: IntegrationsRow): IntegrationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    displayName: row.display_name,
    accessTokenEncrypted: row.access_token_encrypted,
    refreshTokenEncrypted: row.refresh_token_encrypted,
    accessTokenExpiresAt: row.access_token_expires_at,
    scopes: row.scopes,
    accountMetadata: row.account_metadata,
    disconnectedAt: row.disconnected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function expiresAtIso(epochSeconds: number | null): string | null {
  if (epochSeconds === null) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * Insert a new active integration, or update the existing active row if one
 * exists for the (userId, provider, providerAccountId) tuple. The unique index
 * on those three columns (WHERE disconnected_at IS NULL) enforces at-most-one
 * active row.
 *
 * Re-connection flow: if a previously-disconnected row exists, this function
 * inserts a new row rather than reviving the disconnected one — preserving
 * the disconnect history.
 */
export async function upsertActive(input: UpsertActiveInput): Promise<IntegrationRecord> {
  const supabase = await createClient();

  // Check for an existing ACTIVE row.
  const { data: existing, error: existingErr } = await supabase
    .from("integrations")
    .select("*")
    .eq("user_id", input.userId)
    .eq("provider", input.provider)
    .eq("provider_account_id", input.providerAccountId)
    .is("disconnected_at", null)
    .maybeSingle<IntegrationsRow>();
  if (existingErr) {
    throw new Error(`integrations lookup failed: ${existingErr.message}`);
  }

  if (existing) {
    const { data, error } = await supabase
      .from("integrations")
      .update({
        display_name: input.displayName,
        access_token_encrypted: input.tokens.accessTokenEncrypted,
        refresh_token_encrypted: input.tokens.refreshTokenEncrypted,
        access_token_expires_at: expiresAtIso(input.tokens.accessTokenExpiresAt),
        scopes: [...input.tokens.scopes],
        account_metadata: input.accountMetadata,
      })
      .eq("id", existing.id)
      .select()
      .single<IntegrationsRow>();
    if (error || !data) {
      throw new Error(`integrations update failed: ${error?.message ?? "no row returned"}`);
    }
    return rowToRecord(data);
  }

  const { data, error } = await supabase
    .from("integrations")
    .insert({
      user_id: input.userId,
      provider: input.provider,
      provider_account_id: input.providerAccountId,
      display_name: input.displayName,
      access_token_encrypted: input.tokens.accessTokenEncrypted,
      refresh_token_encrypted: input.tokens.refreshTokenEncrypted,
      access_token_expires_at: expiresAtIso(input.tokens.accessTokenExpiresAt),
      scopes: [...input.tokens.scopes],
      account_metadata: input.accountMetadata,
    })
    .select()
    .single<IntegrationsRow>();
  if (error || !data) {
    throw new Error(`integrations insert failed: ${error?.message ?? "no row returned"}`);
  }
  return rowToRecord(data);
}

export async function listActiveByUser(userId: string): Promise<readonly IntegrationRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .is("disconnected_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`integrations list failed: ${error.message}`);
  return (data ?? []).map((row) => rowToRecord(row as IntegrationsRow));
}

export async function markDisconnected(integrationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("integrations")
    .update({ disconnected_at: new Date().toISOString() })
    .eq("id", integrationId);
  if (error) throw new Error(`integrations markDisconnected failed: ${error.message}`);
}
