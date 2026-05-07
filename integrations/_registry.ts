import {
  type ProviderCapability,
  type ProviderManifest,
  ProviderManifestSchema,
} from "@/contracts/integration";
import { gmailManifest } from "./gmail/manifest";
import { slackManifest } from "./slack/manifest";

// Side-effect imports: each provider's trigger/handler modules self-register
// with the polling + activation registries at module load. Adding a new
// polling-trigger provider means adding its registration import here.
import "./gmail/triggers/newEmail";

/**
 * Aggregated provider registry.
 *
 * Per docs/rules/provider-registry.md:
 *   - Hand-maintained explicit imports. Adding a provider requires adding it
 *     to ALL_MANIFESTS below.
 *   - Every manifest is validated against ProviderManifestSchema at module
 *     load. Build fails on a malformed manifest.
 *   - The exported PROVIDERS object is frozen — no runtime mutation.
 */

const ALL_MANIFESTS: readonly ProviderManifest[] = [slackManifest, gmailManifest];

// Validate every manifest against the schema at module load. parse() throws
// on any malformed manifest; loading any importer of this module fails the
// build with a clear error.
for (const m of ALL_MANIFESTS) {
  ProviderManifestSchema.parse(m);
}

const byId = new Map<string, ProviderManifest>();
for (const m of ALL_MANIFESTS) {
  if (byId.has(m.id)) {
    throw new Error(`Duplicate provider id in registry: ${m.id}`);
  }
  byId.set(m.id, m);
}

export const PROVIDERS: Readonly<Record<string, ProviderManifest>> = Object.freeze(
  Object.fromEntries(byId),
);

export function getProvider(id: string): ProviderManifest | undefined {
  return byId.get(id);
}

export function listProviders(): readonly ProviderManifest[] {
  return ALL_MANIFESTS;
}

export function providerSupports(id: string, capability: ProviderCapability): boolean {
  const m = byId.get(id);
  if (!m) return false;
  return m.capabilities[capability] === true;
}
