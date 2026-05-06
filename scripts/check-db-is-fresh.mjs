#!/usr/bin/env node
/**
 * Pre-migration safety check: assert the connected Supabase database does NOT
 * already contain V1's tables. If it does, the URL in .env.local is pointing
 * at V1 (or any populated database) and we MUST NOT push migrations there.
 *
 * Probes for `public.workflows`, a V1 table that does not exist in a fresh
 * V2 project. PostgREST returns 42P01 ("relation does not exist") when the
 * table is absent → safe. Any other response (including success or "no rows")
 * means the table exists → abort.
 */
import { readFileSync } from "node:fs";
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

const env = loadEnv(resolve(process.cwd(), ".env.local"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
// Prefer the new-format secret key when present; fall back to legacy service-role JWT.
const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("FAIL — NEXT_PUBLIC_SUPABASE_URL or a service/secret key missing from .env.local.");
  process.exit(2);
}

// Print diagnostic about which key family we're using (without leaking the key).
const keyFamily = env.SUPABASE_SECRET_KEY ? "SUPABASE_SECRET_KEY (new sb_secret_*)" : "SUPABASE_SERVICE_ROLE_KEY (legacy JWT)";
console.log(`Using URL host: ${new URL(url).host}`);
console.log(`Using key family: ${keyFamily}`);

// Direct REST probe — diagnostic: prints status text on failure so we can see
// what the server actually says rather than an opaque supabase-js error.
const v1Probes = ["workflows", "integrations", "user_profiles"];
let foundV1Table = null;

for (const table of v1Probes) {
  const probeUrl = `${url}/rest/v1/${table}?select=count&head=true`;
  const res = await fetch(probeUrl, {
    method: "HEAD",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (res.ok) {
    foundV1Table = table;
    break;
  }
  if (res.status === 404) continue; // table absent — fresh DB signal
  // Any other status (401/403 auth, 5xx, etc.) is a setup problem we need to surface.
  const body = await res.text();
  console.error(
    `FAIL — probe of public.${table} returned ${res.status} ${res.statusText}\nBody: ${body.slice(0, 400)}`,
  );
  process.exit(2);
}

if (foundV1Table) {
  console.error(
    `ABORT — database already contains public.${foundV1Table}. The connection URL is NOT pointing at a fresh V2 project. Refusing to push migrations.`,
  );
  process.exit(1);
}

console.log("OK — public schema is fresh (none of the V1 probe tables exist). Safe to push V2 migrations.");
