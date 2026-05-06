import { render, screen } from "@testing-library/react";
import { IntegrationsList } from "@/features/integrations/IntegrationsList";
import type { ProviderManifest } from "@/contracts/integration";
import type { IntegrationRecord } from "@/repositories/integrations";

const slackManifest: ProviderManifest = {
  id: "slack",
  displayName: "Slack",
  isEnabled: true,
  isExperimental: false,
  apiVersion: "v2",
  tokenScope: "workspace",
  oauthFlows: ["v2"],
  accountIdField: "team_id",
  scopes: { required: ["chat:write"], optional: [], deprecated: [] },
  capabilities: { oauth: true, webhookTrigger: true, pollingTrigger: false, actions: true },
  healthCheckIntervalMs: 60_000,
  refreshable: false,
};

const slackConnection: IntegrationRecord = {
  id: "int-1",
  userId: "user-1",
  provider: "slack",
  providerAccountId: "T123",
  displayName: "Acme Slack",
  accessTokenEncrypted: "ENC",
  refreshTokenEncrypted: null,
  accessTokenExpiresAt: null,
  scopes: ["chat:write"],
  accountMetadata: {},
  disconnectedAt: null,
  createdAt: "2026-05-05T00:00:00Z",
  updatedAt: "2026-05-05T00:00:00Z",
};

describe("IntegrationsList", () => {
  it("renders 'Not connected' + Connect button when there is no connection", () => {
    render(<IntegrationsList providers={[slackManifest]} connections={[]} />);
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect slack/i })).toBeInTheDocument();
  });

  it("renders 'Connected as <displayName>' and hides the Connect button when connected", () => {
    render(
      <IntegrationsList providers={[slackManifest]} connections={[slackConnection]} />,
    );
    expect(screen.getByText(/connected as acme slack/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect slack/i })).not.toBeInTheDocument();
  });

  it("hides experimental and disabled providers", () => {
    const experimental: ProviderManifest = { ...slackManifest, id: "experimental", displayName: "Experimental Provider", isExperimental: true };
    const disabled: ProviderManifest = { ...slackManifest, id: "disabled", displayName: "Disabled Provider", isEnabled: false };
    render(<IntegrationsList providers={[slackManifest, experimental, disabled]} connections={[]} />);
    expect(screen.queryByText("Experimental Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Disabled Provider")).not.toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
  });

  it("renders an empty-state message when no providers are visible", () => {
    render(<IntegrationsList providers={[]} connections={[]} />);
    expect(screen.getByText(/no integrations available/i)).toBeInTheDocument();
  });

  it("renders 'Connected' (without 'as ...') when displayName is null", () => {
    const conn = { ...slackConnection, displayName: null };
    render(<IntegrationsList providers={[slackManifest]} connections={[conn]} />);
    const status = screen.getByText(/^connected$/i);
    expect(status).toBeInTheDocument();
    expect(status.textContent).not.toMatch(/ as /i);
  });
});
