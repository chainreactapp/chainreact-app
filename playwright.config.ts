import { defineConfig, devices } from "@playwright/test";

/**
 * Slack mock server runs on this port (started by global-setup.ts). The
 * dev server inherits SLACK_API_BASE / SLACK_AUTHORIZE_BASE pointing here,
 * so all of V2's Slack outbound calls land on the mock.
 *
 * Fixed port: keeps the dev-server env vars stable across the run. If the
 * port collides with something else local, fail loud at globalSetup time.
 */
const SLACK_MOCK_PORT = Number(process.env.SLACK_MOCK_PORT ?? "9876");
const MOCK_BASE = `http://127.0.0.1:${SLACK_MOCK_PORT}`;

/**
 * E2e dev server port. Default 3001 — separate from the typical dev port
 * (3000) so a developer keeping a dev server running for manual testing
 * doesn't collide with the e2e dev server, and so the e2e dev server
 * doesn't accidentally inherit a manual setup's env. Overridable via
 * E2E_PORT.
 */
const E2E_PORT = Number(process.env.E2E_PORT ?? "3001");
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    // E2e baseURL is hardcoded to the dev server Playwright starts.
    // .env.local's NEXT_PUBLIC_APP_URL may point at an ngrok tunnel for
    // manual OAuth testing — that's irrelevant here. The webServer below
    // also explicitly overrides NEXT_PUBLIC_APP_URL so the app's OAuth
    // callback redirects stay on localhost.
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Different port from the typical dev server (3000) so a developer
      // can keep a dev server running for manual testing without colliding.
      PORT: String(E2E_PORT),
      // Route V2's Slack OAuth + chat.postMessage calls through the mock.
      // Production never sets these; the override is e2e-only.
      SLACK_API_BASE: MOCK_BASE,
      SLACK_AUTHORIZE_BASE: MOCK_BASE,
      // Force the dev server to use the e2e port as its public URL even
      // when .env.local sets NEXT_PUBLIC_APP_URL to something else (e.g.
      // an ngrok tunnel for manual testing). The OAuth dispatcher reads
      // this for redirect_uri construction.
      NEXT_PUBLIC_APP_URL: E2E_BASE_URL,
    },
  },
});
