import { mkdir, writeFile, readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  startMockSlackServer,
  type MockSlackHandle,
} from "./helpers/mockSlackServer";
import {
  startMockGoogleServer,
  type MockGoogleHandle,
} from "./helpers/mockGoogleServer";

/**
 * Playwright global setup.
 *
 * Boots the mock Slack + Google servers before any tests run. Writes each
 * resolved base URL to its own state file so individual specs can read
 * them without cross-process plumbing (Playwright's globalSetup return
 * value isn't accessible from spec files in the same way).
 *
 * The dev server (started via webServer in playwright.config.ts) has
 * SLACK_API_BASE / SLACK_AUTHORIZE_BASE / GMAIL_API_BASE /
 * GOOGLE_AUTHORIZE_BASE / GOOGLE_TOKEN_BASE env vars pointing at these
 * same mock URLs — that's what makes V2's server-side calls land on the
 * mocks.
 *
 * Module-level handles: held in module-scoped variables for
 * global-teardown to reach. Playwright invokes both setup + teardown in
 * the same Node process, so module state survives.
 */

let slackHandle: MockSlackHandle | null = null;
let googleHandle: MockGoogleHandle | null = null;

export const STATE_FILE = resolve(__dirname, ".state/mock-slack.json");
export const GOOGLE_STATE_FILE = resolve(
  __dirname,
  ".state/mock-google.json",
);

export function getMockHandle(): MockSlackHandle | null {
  return slackHandle;
}

export function getGoogleMockHandle(): MockGoogleHandle | null {
  return googleHandle;
}

/**
 * Minimal .env.local loader for the Playwright spec process.
 *
 * Next.js auto-loads .env.local for the dev server but Playwright workers
 * don't share that environment. Without this, the spec process is missing
 * SLACK_SIGNING_SECRET (needed to sign the webhook POST) and
 * SUPABASE_SERVICE_ROLE_KEY (needed for createTestUser cleanup helpers),
 * and the test fails with confusing missing-env errors.
 *
 * Lifts variables from .env.local into process.env. Existing values aren't
 * overwritten so a CI environment can still override.
 */
/**
 * Vars that the test spec / helpers explicitly need from .env.local but
 * that aren't picked up automatically (Playwright workers don't share the
 * Next.js dev-server env). Listed here so we don't blindly lift everything
 * from .env.local — most importantly, NEXT_PUBLIC_APP_URL stays whatever
 * it was (or undefined), because the user may have it pointing at an ngrok
 * tunnel for manual testing and we don't want that URL leaking into the
 * spec process.
 */
const SPEC_PROCESS_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SLACK_SIGNING_SECRET",
  // Slice 2f: the spec POSTs to /api/cron/poll-triggers with
  // `Authorization: Bearer $CRON_SECRET`. The dev server reads
  // CRON_SECRET from .env.local automatically; the spec process needs
  // it lifted explicitly.
  "CRON_SECRET",
];

function loadDotEnvLocal(): void {
  const envPath = resolve(__dirname, "../../.env.local");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    if (!SPEC_PROCESS_ENV_KEYS.includes(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = m[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export default async function globalSetup(): Promise<void> {
  loadDotEnvLocal();
  // Mock callbacks land on the e2e dev server, not the dev/manual server.
  // Match playwright.config.ts E2E_PORT default.
  const e2ePort = Number(process.env.E2E_PORT ?? "3001");
  const appBaseUrl = `http://localhost:${e2ePort}`;

  const slackPort = Number(process.env.SLACK_MOCK_PORT ?? "9876");
  slackHandle = await startMockSlackServer({ appBaseUrl, port: slackPort });
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(
    STATE_FILE,
    JSON.stringify({
      port: slackPort,
      baseUrl: slackHandle.baseUrl,
      appBaseUrl,
    }),
    "utf8",
  );
  console.log(
    `[e2e] mock Slack listening at ${slackHandle.baseUrl} (V2 callbacks land on ${appBaseUrl})`,
  );

  const googlePort = Number(process.env.GMAIL_MOCK_PORT ?? "9877");
  googleHandle = await startMockGoogleServer({
    appBaseUrl,
    port: googlePort,
  });
  await writeFile(
    GOOGLE_STATE_FILE,
    JSON.stringify({
      port: googlePort,
      baseUrl: googleHandle.baseUrl,
      appBaseUrl,
    }),
    "utf8",
  );
  console.log(
    `[e2e] mock Google listening at ${googleHandle.baseUrl} (V2 callbacks land on ${appBaseUrl})`,
  );
}

/**
 * Spec-side helper to read the Slack mock URL written by global-setup.
 * Specs that need to assert on the mock's recorded calls go through the
 * shared `getMockHandle()` import — it's the same module instance because
 * Jest/Playwright isolates per-process, not per-import.
 */
export async function readMockState(): Promise<{
  port: number;
  baseUrl: string;
  appBaseUrl: string;
}> {
  const raw = await readFile(STATE_FILE, "utf8");
  return JSON.parse(raw) as {
    port: number;
    baseUrl: string;
    appBaseUrl: string;
  };
}

export async function readGoogleMockState(): Promise<{
  port: number;
  baseUrl: string;
  appBaseUrl: string;
}> {
  const raw = await readFile(GOOGLE_STATE_FILE, "utf8");
  return JSON.parse(raw) as {
    port: number;
    baseUrl: string;
    appBaseUrl: string;
  };
}
