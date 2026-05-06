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
