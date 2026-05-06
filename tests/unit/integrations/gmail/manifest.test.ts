/**
 * @jest-environment node
 *
 * Tests for the Gmail provider manifest. Validation against
 * ProviderManifestSchema happens at module load (it would throw on import
 * if malformed); these tests assert the specific manifest values that
 * downstream code depends on.
 */
import { gmailManifest } from "@/integrations/gmail/manifest";
import { getProvider, providerSupports } from "@/integrations/_registry";

describe("gmail manifest", () => {
  it("is registered in the provider registry under id 'gmail'", () => {
    expect(getProvider("gmail")).toBe(gmailManifest);
  });

  it("declares Gmail-required scopes exactly (Slice 2 Q6 narrow set)", () => {
    expect(gmailManifest.scopes.required).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
    expect(gmailManifest.scopes.optional).toEqual([]);
    expect(gmailManifest.scopes.deprecated).toEqual([]);
  });

  it("is refreshable: true (first refreshable provider in V2)", () => {
    expect(gmailManifest.refreshable).toBe(true);
  });

  it("uses tokenScope: user with accountIdField: email (multi-account ready)", () => {
    expect(gmailManifest.tokenScope).toBe("user");
    expect(gmailManifest.accountIdField).toBe("email");
  });

  it("declares honest capabilities — only oauth: true in Slice 2c", () => {
    // Capabilities flip true in Slice 2d (actions: sendEmail) and Slice 2e
    // (pollingTrigger: newEmail). Until then, the manifest does not
    // advertise capabilities that don't ship.
    expect(gmailManifest.capabilities).toEqual({
      oauth: true,
      webhookTrigger: false,
      pollingTrigger: false,
      actions: false,
    });
    expect(providerSupports("gmail", "oauth")).toBe(true);
    expect(providerSupports("gmail", "actions")).toBe(false);
    expect(providerSupports("gmail", "pollingTrigger")).toBe(false);
    expect(providerSupports("gmail", "webhookTrigger")).toBe(false);
  });

  it("uses 6h health-check interval matching V1 Google cadence", () => {
    expect(gmailManifest.healthCheckIntervalMs).toBe(6 * 60 * 60 * 1000);
  });
});
