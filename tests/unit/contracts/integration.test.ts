import { ProviderManifestSchema } from "@/contracts/integration";

const baseValid = {
  id: "slack",
  displayName: "Slack",
  tokenScope: "workspace",
  accountIdField: "team_id",
  scopes: { required: ["chat:write"], optional: [], deprecated: [] },
  capabilities: { oauth: true, webhookTrigger: true, pollingTrigger: false, actions: true },
  healthCheckIntervalMs: 60_000,
  refreshable: false,
};

describe("ProviderManifestSchema", () => {
  it("accepts a well-formed manifest", () => {
    const result = ProviderManifestSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
  });

  it("applies defaults for isEnabled / isExperimental / oauthFlows / capabilities", () => {
    const minimal = {
      id: "slack",
      displayName: "Slack",
      tokenScope: "workspace",
      accountIdField: "team_id",
      scopes: { required: ["chat:write"] },
      capabilities: { oauth: true },
      healthCheckIntervalMs: 60_000,
    };
    const m = ProviderManifestSchema.parse(minimal);
    expect(m.isEnabled).toBe(true);
    expect(m.isExperimental).toBe(false);
    expect(m.oauthFlows).toEqual([]);
    expect(m.refreshable).toBe(false);
    expect(m.capabilities.webhookTrigger).toBe(false);
    expect(m.scopes.optional).toEqual([]);
    expect(m.scopes.deprecated).toEqual([]);
  });

  it("rejects an id with uppercase or special chars", () => {
    expect(ProviderManifestSchema.safeParse({ ...baseValid, id: "Slack" }).success).toBe(false);
    expect(ProviderManifestSchema.safeParse({ ...baseValid, id: "slack!" }).success).toBe(false);
    expect(ProviderManifestSchema.safeParse({ ...baseValid, id: "1slack" }).success).toBe(false);
  });

  it("requires accountIdField when tokenScope is 'workspace'", () => {
    const m = { ...baseValid, accountIdField: undefined };
    const r = ProviderManifestSchema.safeParse(m);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "accountIdField")).toBe(true);
    }
  });

  it("does NOT require accountIdField when tokenScope is 'user'", () => {
    const m = { ...baseValid, tokenScope: "user", accountIdField: undefined };
    const r = ProviderManifestSchema.safeParse(m);
    expect(r.success).toBe(true);
  });

  it("requires at least one scope.required when capabilities.oauth is true", () => {
    const m = { ...baseValid, scopes: { required: [], optional: [], deprecated: [] } };
    const r = ProviderManifestSchema.safeParse(m);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "scopes.required")).toBe(true);
    }
  });

  it("rejects healthCheckIntervalMs of 0 or negative", () => {
    expect(
      ProviderManifestSchema.safeParse({ ...baseValid, healthCheckIntervalMs: 0 }).success,
    ).toBe(false);
    expect(
      ProviderManifestSchema.safeParse({ ...baseValid, healthCheckIntervalMs: -1 }).success,
    ).toBe(false);
  });
});
