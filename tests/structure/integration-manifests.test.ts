/**
 * Structure test: every directory under `integrations/` represents a provider
 * and MUST contain a manifest.ts. The aggregator file `_registry.ts` is the
 * one allowed non-provider entity at the root.
 *
 * Per docs/rules/provider-registry.md and project-structure-and-module-boundaries.md §10:
 * "Provider folder without manifest fails CI."
 */
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const INTEGRATIONS_DIR = join(ROOT, "integrations");

describe("every provider folder has a manifest.ts", () => {
  it("checks each integrations/<provider>/ for manifest.ts", () => {
    let entries;
    try {
      entries = readdirSync(INTEGRATIONS_DIR, { withFileTypes: true });
    } catch {
      return; // integrations dir not present yet
    }

    const offenders: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Underscore-prefixed directories are reserved (none today; future-proofing).
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

      const manifestPath = join(INTEGRATIONS_DIR, entry.name, "manifest.ts");
      try {
        statSync(manifestPath);
      } catch {
        offenders.push(`integrations/${entry.name}/ has no manifest.ts`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
