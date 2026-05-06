import { ProviderManifestSchema, type ProviderManifest } from "@/contracts/integration";

/**
 * Slack provider manifest.
 *
 * Defaults to OAuth v2 with bot tokens (xoxb-*). Slack's default v2 flow does
 * NOT return refresh tokens — token rotation is opt-in per app config and the
 * Slice 1 app does not enable it. Q3 refresh-and-retry is therefore verified
 * via mock providers (oauth-dispatcher.md tests #14 + #15), not against Slack.
 *
 * Slice 1 capabilities:
 *   - OAuth (connect / callback / no refresh / revoke)
 *   - Webhook trigger (Events API → public URL)
 *   - Action handler (chat.postMessage)
 */
export const slackManifest: ProviderManifest = ProviderManifestSchema.parse({
  id: "slack",
  displayName: "Slack",
  isEnabled: true,
  apiVersion: "v2",
  tokenScope: "workspace",
  oauthFlows: ["v2"],
  accountIdField: "team_id",
  scopes: {
    required: [
      "channels:history",
      "channels:read",
      "chat:write",
    ],
    optional: ["users:read"],
    deprecated: [],
  },
  capabilities: {
    oauth: true,
    webhookTrigger: true,
    pollingTrigger: false,
    actions: true,
  },
  healthCheckIntervalMs: 4 * 60 * 60 * 1000, // 4h — per CLAUDE.md V1 health-check intervals.
  refreshable: false,
});
