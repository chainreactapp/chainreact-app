import { ProviderManifestSchema, type ProviderManifest } from "@/contracts/integration";

/**
 * Gmail provider manifest.
 *
 * Capability flags reflect honest current state — they flip true only
 * when a real handler/trigger is registered. As of Slice 2d, `actions`
 * is `true` (sendEmail handler shipped); `pollingTrigger` flips true
 * in Slice 2e when newEmail trigger ships. This convention keeps the
 * manifest from advertising capabilities that don't exist.
 *
 * OAuth shape (via integrations/gmail/oauth.ts):
 *   - PKCE S256 (Slice 2a infra; Gmail is the first real consumer).
 *   - access_type=offline + prompt=consent — guarantees a refresh token on
 *     every connect (Google's quirk: refresh token only returned on first
 *     consent OR when prompt=consent forces re-consent). UX cost accepted
 *     per Slice 2 plan deferred-polish status.
 *   - tokenScope: "user" — one Gmail integration row per (user, email).
 *     Multi-account users connect each inbox separately.
 *   - accountIdField: "email" — providerAccountId is the Gmail
 *     emailAddress fetched from users.getProfile at callback time.
 *   - refreshable: true — Gmail's refreshToken is the first end-to-end
 *     refresh path against a real provider (Slice 2b infra).
 *
 * Scopes (Slice 2 Q6 confirmation — narrowest practical set):
 *   - gmail.readonly: required for the polling trigger AND for the
 *     callback-time accountId lookup via users.getProfile.
 *   - gmail.send: required for the send action handler.
 *   - No gmail.modify, no openid/email/profile — userinfo lookup uses
 *     gmail.googleapis.com/v1/users/me/profile (covered by gmail.readonly),
 *     not the OAuth identity endpoint.
 *
 * Health-check interval: 6h matches the V1 cadence for Google integrations
 * (CLAUDE.md "Google/Microsoft: 6h"). The future health engine consumes
 * this; Slice 2c just declares it.
 */
export const gmailManifest: ProviderManifest = ProviderManifestSchema.parse({
  id: "gmail",
  displayName: "Gmail",
  isEnabled: true,
  apiVersion: "v1",
  tokenScope: "user",
  oauthFlows: ["v2"],
  accountIdField: "email",
  scopes: {
    required: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    optional: [],
    deprecated: [],
  },
  capabilities: {
    oauth: true,
    webhookTrigger: false,
    pollingTrigger: false, // flips true in Slice 2e when newEmail trigger ships
    actions: true, // Slice 2d: sendEmail handler shipped + registered
  },
  healthCheckIntervalMs: 6 * 60 * 60 * 1000, // 6h
  refreshable: true,
});
