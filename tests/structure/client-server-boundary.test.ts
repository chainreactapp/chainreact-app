/**
 * Structure boundary test: client code may not import server-only modules.
 *
 * Per project-structure-and-module-boundaries.md §11 test #1:
 * Scan files under client-side roots (features/, components/, stores/, lib/api/)
 * for any import of services/ or repositories/. Fail if any are found.
 *
 * This complements the ESLint no-restricted-imports rule with a layer-of-defense
 * check that survives ESLint disable-comments and runs in `npm test`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const CLIENT_ROOTS = ["features", "components", "stores", "lib/api"];

// Match a `from '@/repositories/...'` or `from '@/services/...'` import target.
// Type-only imports (`import type { X } from '...'`) are erased at compile time
// and don't cross the runtime boundary, so they're allowed.
const TARGETS = [
  /from\s+['"]@\/repositories(?:\/|['"])/,
  /from\s+['"]@\/services(?:\/|['"])/,
  /from\s+['"](?:\.\.?\/)+repositories(?:\/|['"])/,
  /from\s+['"](?:\.\.?\/)+services(?:\/|['"])/,
];

function isTypeOnlyImportLine(line: string): boolean {
  return /^\s*import\s+type\s/.test(line);
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("client/server import boundary", () => {
  it.each(CLIENT_ROOTS)(
    "no file under %s/ imports a value from repositories/ or services/ (type-only imports are OK)",
    (root) => {
      const dir = join(ROOT, root);
      try {
        statSync(dir);
      } catch {
        return; // root not yet populated; nothing to check
      }
      const files = collectFiles(dir);
      const offenders: string[] = [];
      for (const file of files) {
        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        for (const line of lines) {
          if (isTypeOnlyImportLine(line)) continue;
          for (const pattern of TARGETS) {
            if (pattern.test(line)) {
              offenders.push(
                `${file.slice(ROOT.length + 1)} :: ${line.trim()}`,
              );
            }
          }
        }
      }
      expect(offenders).toEqual([]);
    },
  );
});
