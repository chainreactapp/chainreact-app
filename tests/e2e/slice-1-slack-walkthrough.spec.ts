import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { createHmac } from "node:crypto";
import {
  createTestUser,
  deleteTestUser,
  getIntegrationsForUser,
  getNotificationsForUser,
  getWorkflowRunsForUser,
  waitFor,
  type TestUser,
} from "./helpers/supabaseAdmin";
import { readMockState } from "./global-setup";

/**
 * Slice 1 end-to-end walkthrough.
 *
 * Proves the full chain from sign-in through Slack OAuth (mocked at the
 * network boundary), workflow create + activate, signed Slack webhook
 * delivery, execution engine + handler dispatch, and run history surface.
 *
 * Real surfaces exercised:
 *   - Auth (Supabase admin createUser → UI sign-in)
 *   - OAuth dispatcher + signed state + atomic nonce consume
 *   - Service-role integration insert + token encryption
 *   - Workflow CRUD + lifecycle preconditions + activate transition
 *   - Trigger registration (DB row in trigger_resources)
 *   - Webhook receipt + HMAC verify + normalization
 *   - Provider-agnostic dispatcher + dedup
 *   - Execution engine + canonical resolver (strict mode) + handler registry
 *   - Slack send_channel_message handler + token decrypt
 *   - workflow_runs persistence + humanized error_classification (null on success)
 *   - In-app notification orchestrator (atomic claim; no fanout on success)
 *   - Run history UI + notifications UI surfaces
 *
 * Mocked surfaces (Slack network boundary only):
 *   - slack.com/oauth/v2/authorize → 302 to V2's callback with code+state
 *   - slack.com/api/oauth.v2.access → mock token exchange
 *   - slack.com/api/chat.postMessage → mock success
 *
 * NOT mocked: Slack webhook delivery — the test sends a real signed POST.
 *
 * UI shortcut: V2's builder UI doesn't have per-node configuration yet
 * (Slice 1I.2 was minimum picker + list + save). The test patches the
 * workflow draft via the API at step "configure nodes" so the trigger
 * + action have valid `type` + `config` for execution. When per-node
 * configuration UI ships, this step becomes a UI walkthrough.
 *
 * Repeatability: per-test random user via Supabase admin; afterEach
 * deletes the auth user so cascades clear all related rows.
 */

// Test user holder — populated in beforeEach, cleaned in afterEach.
let testUser: TestUser | null = null;

test.describe("Slice 1 — full Slack walkthrough", () => {
  test.beforeEach(async () => {
    testUser = await createTestUser();
  });

  test.afterEach(async () => {
    if (testUser) {
      await deleteTestUser(testUser.id);
      testUser = null;
    }
  });

  test("sign in → connect Slack → build + activate workflow → fire webhook → see succeeded run", async ({
    page,
    request,
  }) => {
    if (!testUser) throw new Error("test user setup failed");
    const user = testUser;
    const mock = await readMockState();

    // Reset mock counters so per-test assertions are scoped to this run.
    await page.request.post(`${mock.baseUrl}/__reset`);

    // ── 1. Sign in via UI (user already exists via admin createUser) ──
    await signIn(page, user);

    // ── 2. Visit home; assert signed-in surface + Notifications link ──
    await page.goto("/");
    await expect(
      page.getByText(`Signed in as`, { exact: false }),
    ).toBeVisible();
    await expect(page.getByText(user.email)).toBeVisible();

    // ── 3. Connect Slack (UI → mocked authorize → V2 callback) ──
    // V2's callback redirects to /?integration=connected&provider=slack
    // (root, not /integrations). After OAuth lands, navigate back to
    // /integrations to verify the connected display.
    await page.goto("/integrations");
    await Promise.all([
      page.waitForURL(/\/\?integration=connected&provider=slack/),
      page.getByRole("button", { name: "Connect Slack" }).click(),
    ]);

    // After OAuth: navigate to integrations page; Slack row shows connected.
    await page.goto("/integrations");
    await expect(
      page.locator('ul[aria-label="Integrations"]').getByText(/Connected/),
    ).toBeVisible();

    // DB assertions: integration row exists with mock-recognizable encrypted token.
    const integrations = await getIntegrationsForUser(user.id, "slack");
    expect(integrations).toHaveLength(1);
    const integration = integrations[0]!;
    expect(integration.provider_account_id).toBe("T-MOCK-TEAM");
    expect(integration.access_token_encrypted).toBeTruthy();
    expect(integration.access_token_encrypted).not.toBe(
      "xoxb-mock-bot-token-e2e",
    );

    // Mock recorded exactly one token exchange.
    const callsAfterOAuth = await fetchMockCalls(request, mock.baseUrl);
    expect(callsAfterOAuth.authorize).toBe(1);
    expect(callsAfterOAuth.tokenExchange).toHaveLength(1);
    expect(callsAfterOAuth.chatPostMessage).toHaveLength(0);

    // ── 4. Create workflow via UI ──
    // CreateWorkflowButton opens an inline form; type name, submit, navigate.
    await page.goto("/workflows");
    await page.getByRole("button", { name: "Create workflow" }).click();
    await page.getByLabel(/workflow name/i).fill("E2E Walkthrough Workflow");
    await Promise.all([
      page.waitForURL(/\/workflows\/[0-9a-f-]+/),
      page.getByRole("button", { name: "Create", exact: true }).click(),
    ]);
    const workflowId = page.url().match(/\/workflows\/([0-9a-f-]+)/)![1]!;

    // ── 5. Configure trigger + action via API patch ──
    // V2's builder UI cannot configure node `type` + `config` yet (Slice 1I.2
    // was minimum picker + list + save). When per-node config UI ships,
    // replace this with UI interaction.
    const draftDefinition = {
      nodes: [
        {
          id: "trigger-node",
          kind: "trigger" as const,
          provider: "slack",
          type: "message",
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: "action-node",
          kind: "action" as const,
          provider: "slack",
          type: "send_channel_message",
          config: { channel: "C-MOCK-CHANNEL", text: "Hello from e2e" },
          position: { x: 0, y: 100 },
        },
      ],
      edges: [{ id: "e1", from: "trigger-node", to: "action-node" }],
    };
    const patch = await page.request.patch(`/api/workflows/${workflowId}`, {
      data: { draftDefinition },
    });
    expect(patch.status(), await patch.text()).toBe(200);

    // Reload so the server-rendered builder picks up the patched definition.
    await page.reload();
    const nodeList = page.locator('ol[aria-label="Workflow nodes"]');
    await expect(nodeList.getByText(/trigger/i).first()).toBeVisible();
    await expect(nodeList.getByText(/action/i).first()).toBeVisible();

    // ── 6. Activate workflow via UI ──
    await page.getByRole("button", { name: "Activate" }).click();
    await expect(
      page.locator("[data-status-kind=active]"),
    ).toBeVisible({ timeout: 10_000 });

    // ── 7. POST signed Slack webhook event to V2 ──
    const webhookBody = buildSlackEventBody({ teamId: "T-MOCK-TEAM" });
    const ts = Math.floor(Date.now() / 1000).toString();
    const signature = signSlackWebhook(
      ts,
      webhookBody,
      requireEnv("SLACK_SIGNING_SECRET"),
    );
    const webhookResp = await request.post("/api/webhooks/slack", {
      headers: {
        "x-slack-request-timestamp": ts,
        "x-slack-signature": signature,
        "content-type": "application/json",
      },
      data: webhookBody,
    });
    expect(webhookResp.status(), await webhookResp.text()).toBe(200);

    // ── 8. Wait for execution → workflow_runs row → assert succeeded ──
    const runs = await waitFor(
      async () => {
        const rows = await getWorkflowRunsForUser(user.id);
        return rows.length > 0 ? rows : null;
      },
      { description: "workflow_runs row to appear", timeoutMs: 15_000 },
    );
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.status).toBe("succeeded");
    expect(run.error_classification).toBeNull();
    expect(run.error_notifications_sent_at).toBeNull();

    // Mock recorded exactly one chat.postMessage with our text.
    const callsAfterRun = await fetchMockCalls(request, mock.baseUrl);
    expect(callsAfterRun.chatPostMessage).toHaveLength(1);
    expect(callsAfterRun.chatPostMessage[0]!.body).toEqual({
      channel: "C-MOCK-CHANNEL",
      text: "Hello from e2e",
    });
    // Authorization header carries the (decrypted) bot token.
    expect(callsAfterRun.chatPostMessage[0]!.authorization).toBe(
      "Bearer xoxb-mock-bot-token-e2e",
    );

    // ── 9. UI: Run history shows the succeeded run ──
    await page.reload();
    const runHistory = page.locator('section[aria-label="Run history"]');
    await expect(runHistory).toBeVisible();
    await expect(runHistory.getByText(/succeeded/i)).toBeVisible();

    // ── 10. No notification on success path ──
    const notifications = await getNotificationsForUser(user.id);
    expect(notifications).toHaveLength(0);

    // /notifications page shows empty state.
    await page.goto("/notifications");
    await expect(page.getByText(/no notifications yet/i)).toBeVisible();
  });
});

// ── helpers ─────────────────────────────────────────────────────────────

async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await Promise.all([
    page.waitForURL((url) => !/\/auth\/sign-in/.test(url.toString()), {
      timeout: 15_000,
    }),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
}

interface MockCalls {
  authorize: number;
  tokenExchange: { body: string; parsedBody: Record<string, string> }[];
  chatPostMessage: {
    authorization: string | undefined;
    body: { channel: string; text: string };
  }[];
}

async function fetchMockCalls(
  request: APIRequestContext,
  mockBaseUrl: string,
): Promise<MockCalls> {
  const resp = await request.get(`${mockBaseUrl}/__inspect`);
  return (await resp.json()) as MockCalls;
}

function buildSlackEventBody(opts: { teamId: string }): string {
  return JSON.stringify({
    type: "event_callback",
    team_id: opts.teamId,
    event_id: `Ev${Date.now()}`,
    event_time: Math.floor(Date.now() / 1000),
    event: {
      type: "message",
      channel: "C-MOCK-CHANNEL",
      user: "U-MOCK-SENDER",
      text: "test message",
      ts: `${Date.now() / 1000}`,
    },
  });
}

function signSlackWebhook(
  ts: string,
  rawBody: string,
  signingSecret: string,
): string {
  const base = `v0:${ts}:${rawBody}`;
  const hex = createHmac("sha256", signingSecret).update(base).digest("hex");
  return `v0=${hex}`;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`e2e: ${name} env var is required`);
  return v;
}
