#!/usr/bin/env node
/**
 * Migration RLS lint.
 * Per docs/rules/database-security.md §10:
 *   Every migration that creates a user-data or tenant-data table MUST
 *   enable RLS and define at least one CREATE POLICY in the same migration.
 *
 * System tables that intentionally skip user RLS (cron resources, dedup,
 * etc.) opt out via a header comment in the same file:
 *   -- system-table: <table> — <reason>
 *
 * For every CREATE TABLE in a migration:
 *   - check the same file for ENABLE ROW LEVEL SECURITY targeting that table
 *   - check the same file for at least one CREATE POLICY ... ON public.<table>
 *   - or check for an explicit `system-table: <table>` comment
 *
 * Fails CI on the first violation.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MIGRATIONS = resolve(process.cwd(), "supabase/migrations");
let violations = 0;

let files;
try {
  files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
} catch {
  console.log("OK — no migrations directory yet.");
  process.exit(0);
}

for (const file of files) {
  const path = join(MIGRATIONS, file);
  const sql = readFileSync(path, "utf8");

  const systemTables = new Set(
    [...sql.matchAll(/--\s*system-table:\s*([\w.]+)/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  );

  const createTableMatches = [
    ...sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(\w+)/gi,
    ),
  ];

  for (const match of createTableMatches) {
    const table = match[1].toLowerCase();
    if (systemTables.has(table)) continue;

    const enableRls = new RegExp(
      `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "i",
    ).test(sql);
    if (!enableRls) {
      console.error(
        `MIGRATION-RLS VIOLATION: ${file} creates public.${table} but does not ENABLE ROW LEVEL SECURITY.`,
      );
      violations += 1;
      continue;
    }

    const hasPolicy = new RegExp(
      `CREATE\\s+POLICY\\s+\\S+\\s+ON\\s+public\\.${table}`,
      "i",
    ).test(sql);
    if (!hasPolicy) {
      console.error(
        `MIGRATION-RLS VIOLATION: ${file} creates public.${table} with RLS but no CREATE POLICY in the same file.`,
      );
      violations += 1;
    }
  }
}

if (violations > 0) {
  console.error(
    `\n${violations} migration RLS violation(s). See docs/rules/database-security.md.`,
  );
  console.error(
    `Either add policies, or mark the table system-only with a header comment:`,
  );
  console.error(`  -- system-table: <table_name> — <reason>`);
  process.exit(1);
}

console.log(
  "OK — every migration that creates a user-data table enables RLS + has at least one policy.",
);
