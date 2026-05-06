import {
  PROVIDERS,
  getProvider,
  listProviders,
  providerSupports,
} from "@/integrations/_registry";

describe("integration registry", () => {
  it("exposes PROVIDERS as a frozen object", () => {
    expect(Object.isFrozen(PROVIDERS)).toBe(true);
  });

  it("getProvider returns the manifest for a known id", () => {
    const m = getProvider("slack");
    expect(m).toBeDefined();
    expect(m?.id).toBe("slack");
    expect(m?.displayName).toBe("Slack");
  });

  it("getProvider returns undefined for an unknown id (does not throw)", () => {
    expect(getProvider("does-not-exist")).toBeUndefined();
  });

  it("listProviders returns all manifests", () => {
    const all = listProviders();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.some((m) => m.id === "slack")).toBe(true);
  });

  it("providerSupports answers true for declared capabilities, false otherwise", () => {
    expect(providerSupports("slack", "oauth")).toBe(true);
    expect(providerSupports("slack", "webhookTrigger")).toBe(true);
    expect(providerSupports("slack", "actions")).toBe(true);
    expect(providerSupports("slack", "pollingTrigger")).toBe(false);
  });

  it("providerSupports returns false for an unknown provider (does not throw)", () => {
    expect(providerSupports("does-not-exist", "oauth")).toBe(false);
  });
});
