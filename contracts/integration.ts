import { z } from "zod";

/**
 * Cross-layer contract for provider integrations.
 * Per docs/rules/provider-registry.md and oauth-dispatcher.md:
 *   - Each provider declares its capabilities, scopes, and OAuth shape via a
 *     ProviderManifest. The manifest IS the registry entry.
 *   - Provider id is the stable identifier from V1 (slack, gmail, discord, …)
 *     and matches the `integrations/<id>/` folder name.
 *
 * Provider-specific *action* and *trigger* schemas live next to the handlers
 * (integrations/<p>/actions/<action>.schema.ts), NOT in this file.
 */

export const ProviderIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/, "Provider ids are lowercase, dash- or underscore-separated.");

export const ProviderCapabilitySchema = z.enum([
  "oauth",
  "webhookTrigger",
  "pollingTrigger",
  "actions",
]);
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

export const TokenScopeSchema = z.enum(["user", "workspace"]);
export type TokenScope = z.infer<typeof TokenScopeSchema>;

export const ProviderManifestSchema = z
  .object({
    /** Stable id; matches the integrations/<id>/ folder name. */
    id: ProviderIdSchema,
    /** Display label for UI. */
    displayName: z.string().min(1),
    /** When false, existing tokens still work but new connect flows refuse. */
    isEnabled: z.boolean().default(true),
    /** Hidden from the default integrations list unless an env flag opts in. */
    isExperimental: z.boolean().default(false),
    /** Provider API version pinned by this manifest, if applicable. */
    apiVersion: z.string().optional(),
    /** Whether tokens are bound to a user or to a workspace/team. */
    tokenScope: TokenScopeSchema,
    /** Provider-specific OAuth flow names (e.g., 'v2', 'bot', 'user'). */
    oauthFlows: z.array(z.string()).default([]),
    /** Scopes declared by the provider; the only source of truth for scopes. */
    scopes: z.object({
      required: z.array(z.string()),
      optional: z.array(z.string()).default([]),
      deprecated: z.array(z.string()).default([]),
    }),
    capabilities: z.object({
      oauth: z.boolean().default(false),
      webhookTrigger: z.boolean().default(false),
      pollingTrigger: z.boolean().default(false),
      actions: z.boolean().default(false),
    }),
    /** How often the health-engine cron should poll this provider's health. */
    healthCheckIntervalMs: z.number().int().positive(),
    /** True if the provider's OAuth flow returns a refresh token. */
    refreshable: z.boolean().default(false),
    /**
     * Field in the provider's callback payload that uniquely identifies the
     * account (e.g., 'team_id' for Slack, 'workspace_id' for Notion).
     * Required for tokenScope='workspace'.
     */
    accountIdField: z.string().optional(),
  })
  .superRefine((m, ctx) => {
    if (m.tokenScope === "workspace" && !m.accountIdField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountIdField"],
        message: "tokenScope='workspace' requires an accountIdField.",
      });
    }
    if (m.scopes.required.length === 0 && m.capabilities.oauth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopes", "required"],
        message: "OAuth providers must declare at least one required scope.",
      });
    }
  });

export type ProviderManifest = z.infer<typeof ProviderManifestSchema>;

// ─── OAuth contracts ──────────────────────────────────────────────────────────
// Server-side only. Client code never imports types that hold token material.

/** Provider returns these tokens after a successful OAuth callback. */
export interface EncryptedTokens {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  /** Epoch seconds, or null if the provider doesn't expose token expiry. */
  accessTokenExpiresAt: number | null;
  scopes: readonly string[];
}

/** Identifying fields about the connected account, parsed from the OAuth callback. */
export interface ProviderAccountInfo {
  providerAccountId: string;
  displayName: string | null;
  metadata: Record<string, unknown>;
}

/**
 * PKCE inputs persisted on the `oauth_states` row at connect time and
 * forwarded to the provider's callback handler at consume time. The
 * `codeVerifier` is the secret half — it lives only on the row, never in
 * the signed state JWT.
 */
export interface PkceInputs {
  codeVerifier: string;
  codeChallengeMethod: string;
}

/**
 * Per-provider OAuth implementation. Each provider in `integrations/<id>/oauth.ts`
 * exports an object that satisfies this shape. The generic dispatcher in
 * `services/oauth/dispatcher.ts` is the only caller.
 */
export interface ProviderOAuth {
  /** Builds the redirect URL the user is sent to. `state` is the signed token from createState(). */
  buildAuthUrl(state: string, scopes: readonly string[]): string;
  /**
   * Exchanges the authorization code for tokens. `pkce` is non-null only for
   * providers that asked the dispatcher to issue a PKCE challenge at connect
   * time (manifest-driven). Non-PKCE providers receive `null` and ignore it.
   */
  handleCallback(
    code: string,
    state: string,
    pkce: PkceInputs | null,
  ): Promise<{ tokens: EncryptedTokens; account: ProviderAccountInfo }>;
  /** Returns fresh tokens, or throws RefreshNotSupportedError on non-refreshable providers. */
  refreshToken(refreshToken: string): Promise<EncryptedTokens>;
  /** Best-effort token revocation at the provider; safe to call on disconnect. */
  revoke(token: string): Promise<void>;
}

/** Thrown by refreshToken() on providers whose flow does not return refresh tokens. */
export class RefreshNotSupportedError extends Error {
  constructor(provider: string) {
    super(`Provider '${provider}' does not support token refresh.`);
    this.name = "RefreshNotSupportedError";
  }
}
