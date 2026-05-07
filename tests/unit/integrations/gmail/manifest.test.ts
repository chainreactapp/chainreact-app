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
import { listRegisteredHandlers } from "@/services/execution/handlers/_registry";

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

  it("declares honest capabilities post-Slice 2e (oauth + actions + pollingTrigger)", () => {
    // Slice 2d shipped sendEmail handler → actions: true.
    // Slice 2e shipped newEmail polling trigger → pollingTrigger: true.
    expect(gmailManifest.capabilities).toEqual({
      oauth: true,
      webhookTrigger: false,
      pollingTrigger: true,
      actions: true,
    });
    expect(providerSupports("gmail", "oauth")).toBe(true);
    expect(providerSupports("gmail", "actions")).toBe(true);
    expect(providerSupports("gmail", "pollingTrigger")).toBe(true);
    expect(providerSupports("gmail", "webhookTrigger")).toBe(false);
  });

  it("when actions: true, the action-handler registry contains gmail:send_email", () => {
    // Honest-capability invariant: the manifest only claims `actions: true`
    // when there's at least one corresponding handler registered.
    if (gmailManifest.capabilities.actions) {
      const registered = listRegisteredHandlers().filter(
        (h) => h.provider === "gmail",
      );
      expect(registered).toContainEqual({
        provider: "gmail",
        type: "send_email",
      });
    }
  });

  it("uses 6h health-check interval matching V1 Google cadence", () => {
    expect(gmailManifest.healthCheckIntervalMs).toBe(6 * 60 * 60 * 1000);
  });
});
