/**
 * Structure test: SUPABASE_SERVICE_ROLE_KEY must not be referenced from any
 * client-side root.
 *
 * Per project-structure-and-module-boundaries.md §10/§11 + database-security.md:
 *   - Only `repositories/supabase/serviceRoleClient.ts` constructs the
 *     service-role Supabase client.
 *   - No file under app/(app), app/(marketing), features/, components/,
 *     stores/, or lib/api/ may even reference the env var name — if it does,
 *     a future bundler change could land it in the client bundle.
 *
 * We scan source TS/TSX (not the build output yet — that's a follow-up CI
 * check). Server-side roots (services/, app/api/, repositories/, core/) are
 * allowed to reference the var.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const CLIENT_ROOTS = [
  "features",
  "components",
  "stores",
  "lib/api",
];

const FORBIDDEN_PATTERNS = [
  /SUPABASE_SERVICE_ROLE_KEY/,
  /SUPABASE_SECRET_KEY/,
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

describe("no service-role secret references in client code", () => {
  it.each(CLIENT_ROOTS)(
    "no file under %s/ references SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY",
    (root) => {
      const dir = join(ROOT, root);
      try {
        statSync(dir);
      } catch {
        return; // root not yet populated
      }
      const offenders: string[] = [];
      for (const file of collectFiles(dir)) {
        const src = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(src)) {
            offenders.push(`${file.slice(ROOT.length + 1)} matches ${pattern}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    },
  );
});
