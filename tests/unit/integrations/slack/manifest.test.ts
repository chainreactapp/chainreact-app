import { slackManifest } from "@/integrations/slack/manifest";
import { ProviderManifestSchema } from "@/contracts/integration";

describe("Slack manifest", () => {
  it("validates against ProviderManifestSchema", () => {
    expect(() => ProviderManifestSchema.parse(slackManifest)).not.toThrow();
  });

  it("declares Slice 1 capabilities (oauth + webhookTrigger + actions)", () => {
    expect(slackManifest.capabilities.oauth).toBe(true);
    expect(slackManifest.capabilities.webhookTrigger).toBe(true);
    expect(slackManifest.capabilities.actions).toBe(true);
    expect(slackManifest.capabilities.pollingTrigger).toBe(false);
  });

  it("is non-refreshable (Slack default v2 has no refresh tokens)", () => {
    expect(slackManifest.refreshable).toBe(false);
  });

  it("uses team_id as the multi-account discriminator", () => {
    expect(slackManifest.tokenScope).toBe("workspace");
    expect(slackManifest.accountIdField).toBe("team_id");
  });

  it("required scopes cover trigger + action paths for slice 1", () => {
    expect(slackManifest.scopes.required).toEqual(
      expect.arrayContaining(["channels:history", "channels:read", "chat:write"]),
    );
  });
});
