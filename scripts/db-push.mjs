#!/usr/bin/env node
/**
 * Apply pending Supabase migrations to the V2 database.
 * Reads POSTGRES_URL_NON_POOLING from .env.local and invokes
 *   supabase db push --db-url <url>
 * via spawn (argv, not shell interpolation) so the connection string never
 * lands in shell history or echoes.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const envPath = resolve(process.cwd(), ".env.local");
if (!existsSync(envPath)) {
  console.error("ABORT — .env.local not found at repo root.");
  process.exit(1);
}

const env = loadEnv(envPath);
const dbUrl = env.POSTGRES_URL_NON_POOLING;
if (!dbUrl) {
  console.error("ABORT — POSTGRES_URL_NON_POOLING missing from .env.local.");
  process.exit(1);
}

const hostMatch = dbUrl.match(/@([^/:]+):(\d+)/);
console.log(`Pushing migrations to: ${hostMatch ? hostMatch[1] + ":" + hostMatch[2] : "(unparsed)"}`);

// supabase db push prompts before applying. Pre-feed "y\n" via stdin so this
// script is non-interactive (works in CI and `npm run db:push`).
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["supabase", "db", "push", "--db-url", dbUrl, "--include-all"],
  { input: "y\n", stdio: ["pipe", "inherit", "inherit"] },
);

process.exit(result.status ?? 1);
