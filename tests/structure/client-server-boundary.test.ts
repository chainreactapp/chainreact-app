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
const FORBIDDEN = [
  /from\s+['"]@\/repositories(?:\/|['"])/,
  /from\s+['"]@\/services(?:\/|['"])/,
  /from\s+['"](?:\.\.?\/)+repositories(?:\/|['"])/,
  /from\s+['"](?:\.\.?\/)+services(?:\/|['"])/,
];

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
    "no file under %s/ imports from repositories/ or services/",
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
        const src = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN) {
          if (pattern.test(src)) {
            offenders.push(`${file.slice(ROOT.length + 1)} matches ${pattern}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    },
  );
});
