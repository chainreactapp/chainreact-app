import type { ProviderManifest } from "@/contracts/integration";
import type { IntegrationRecord } from "@/repositories/integrations";
import { ConnectButton } from "./ConnectButton";

interface Props {
  providers: readonly ProviderManifest[];
  connections: readonly IntegrationRecord[];
}

/**
 * Pure presentational. Receives the provider catalog and the user's active
 * connections from a server component; renders a row per provider with the
 * appropriate connect / connected state.
 */
export function IntegrationsList({ providers, connections }: Props) {
  const byProvider = new Map(connections.map((c) => [c.provider, c]));
  const visible = providers.filter((p) => p.isEnabled && !p.isExperimental);

  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No integrations available yet.</p>
    );
  }

  return (
    <ul className="flex flex-col gap-3" aria-label="Integrations">
      {visible.map((provider) => {
        const connection = byProvider.get(provider.id) ?? null;
        return (
          <li
            key={provider.id}
            className="flex items-center justify-between rounded border border-input p-4"
          >
            <div>
              <div className="font-medium">{provider.displayName}</div>
              {connection ? (
                <div className="text-sm text-muted-foreground">
                  Connected
                  {connection.displayName ? ` as ${connection.displayName}` : ""}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Not connected</div>
              )}
            </div>
            {!connection && provider.capabilities.oauth && (
              <ConnectButton
                provider={provider.id}
                label={`Connect ${provider.displayName}`}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
