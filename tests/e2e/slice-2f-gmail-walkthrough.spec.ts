import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  createTestUser,
  deleteTestUser,
  getDedupRow,
  getIntegrationsForUser,
  getNotificationsForUser,
  getOAuthStateRowCount,
  getTriggerResourcesForUser,
  getWorkflowRunsForUser,
  rewindTriggerPollingTimestamp,
  waitFor,
  type TestUser,
} from "./helpers/supabaseAdmin";
import { readGoogleMockState } from "./global-setup";

/**
 * Slice 2f end-to-end walkthrough — Gmail polling trigger.
 *
 * Mirrors the shape of Slice 1's Slack walkthrough: real auth, real OAuth
 * dispatcher (PKCE state row + atomic consume), real integration row with
 * AES-encrypted tokens, real workflow create + activate, real polling
 * scheduler, real trigger handler. The Google network boundary is the
 * only thing mocked (authorize, token, profile, history.list, messages.get,
 * messages.send).
 *
 * Real surfaces exercised:
 *   - Auth (Supabase admin createUser → UI sign-in)
 *   - OAuth dispatcher + signed state + atomic consume + PKCE S256
 *   - Token endpoint POST (form-urlencoded with code_verifier)
 *   - Service-role integration insert + token encryption (AES-256-GCM)
 *   - Workflow CRUD + lifecycle preconditions + activate transition
 *   - Activation hook seam (Slice 2e): registerWorkflowTriggers consults
 *     activationRegistry, calls Gmail's activate which fetches getProfile
 *     and snapshots the historyId BEFORE upserting trigger_resources
 *   - Polling cron auth (CRON_SECRET bearer)
 *   - Polling scheduler iteration with concurrency/timeout
 *   - Gmail polling handler: history.list (V1 port), messages.get
 *     (format=metadata), filter matching (default INBOX), DB-backed
 *     dedup via webhook_event_dedup, checkpoint advancement
 *   - Engine + canonical resolver + Gmail send_email handler
 *   - refreshAndRetry token decryption on the send call
 *
 * Mocked surfaces (Google network boundary only):
 *   - accounts.google.com/o/oauth2/v2/auth → 302 to V2's gmail callback
 *   - oauth2.googleapis.com/token → canned access + refresh token
 *   - gmail.googleapis.com/gmail/v1/users/me/profile
 *   - gmail.googleapis.com/gmail/v1/users/me/history
 *   - gmail.googleapis.com/gmail/v1/users/me/messages/{id}
 *   - gmail.googleapis.com/gmail/v1/users/me/messages/send
 *
 * UI shortcut: V2's builder UI doesn't have per-node configuration yet
 * (Slice 1I.2 was minimum picker + list + save). The test patches the
 * workflow draft via the API at step "configure nodes" so the trigger
 * + action have valid `type` + `config` for execution. When per-node
 * configuration UI ships, this step becomes a UI walkthrough — same
 * comment as the Slice 1 spec.
 *
 * Two-run stability: every test run uses a fresh `msg-e2e-${randomUUID()}`
 * gmail message id, so the `webhook_event_dedup` row written by the first
 * run never collides with a second run. All other tables are cleaned via
 * `deleteTestUser`'s FK cascade.
 */

let testUser: TestUser | null = null;

test.describe("Slice 2f — full Gmail walkthrough", () => {
  test.beforeEach(async () => {
    testUser = await createTestUser();
  });

  test.afterEach(async () => {
    if (testUser) {
      await deleteTestUser(testUser.id);
      testUser = null;
    }
  });

  test("sign in → connect Gmail → build + activate → poll cycle → succeeded run → dedup blocks duplicate", async ({
    page,
    request,
  }) => {
    if (!testUser) throw new Error("test user setup failed");
    const user = testUser;
    const mock = await readGoogleMockState();
    const cronSecret = requireEnv("CRON_SECRET");

    // Per-run unique gmail message id so the webhook_event_dedup row
    // never collides across consecutive runs (the table is system-wide,
    // no user FK, so user-delete cascades don't clean it).
    const messageId = `msg-e2e-${randomUUID()}`;

    // Reset Google mock counters + email store so per-test assertions
    // are scoped to this run.
    await page.request.post(`${mock.baseUrl}/__reset`);

    // ── 1. Sign in via UI ──
    await signIn(page, user);

    // ── 2. Snapshot oauth_states count for the consumed-state assertion ──
    const oauthStatesBefore = await getOAuthStateRowCount();

    // ── 3. Connect Gmail (UI → mocked authorize → V2 callback → land) ──
    // The dynamic [provider]/callback route handles all providers; for
    // gmail it lands at /api/integrations/oauth/gmail/callback. After the
    // callback redirects, we land on /?integration=connected&provider=gmail.
    await page.goto("/integrations");
    await Promise.all([
      page.waitForURL(/\/\?integration=connected&provider=gmail/),
      page.getByRole("button", { name: "Connect Gmail" }).click(),
    ]);

    // After OAuth: navigate to integrations page; Gmail row shows connected.
    await page.goto("/integrations");
    await expect(
      page.locator('ul[aria-label="Integrations"]').getByText(/Connected/),
    ).toBeVisible();

    // DB assertions: integration row exists with encrypted tokens.
    const integrations = await getIntegrationsForUser(user.id, "gmail");
    expect(integrations).toHaveLength(1);
    const integration = integrations[0]! as Record<string, unknown>;
    expect(integration.provider_account_id).toBe("alice@e2e.test");
    expect(integration.access_token_encrypted).toBeTruthy();
    // Encryption invariant: ciphertext must NOT equal plaintext mock value.
    expect(integration.access_token_encrypted).not.toBe("ya29.mock-e2e-access");
    expect(integration.refresh_token_encrypted).toBeTruthy();
    expect(integration.refresh_token_encrypted).not.toBe("1//mock-e2e-refresh");
    // Scopes: exactly the manifest's required pair.
    const scopes = integration.scopes as readonly string[];
    expect([...scopes].sort()).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ]);

    // OAuth state row was atomically consumed — total count back to baseline.
    const oauthStatesAfter = await getOAuthStateRowCount();
    expect(oauthStatesAfter).toBe(oauthStatesBefore);

    // Mock-call assertions: exactly one authorize, one token exchange,
    // one profile call (the OAuth callback's accountId lookup).
    const callsAfterOAuth = await fetchMockCalls(request, mock.baseUrl);
    expect(callsAfterOAuth.calls.authorize).toHaveLength(1);
    expect(callsAfterOAuth.calls.tokenExchange).toHaveLength(1);
    expect(callsAfterOAuth.calls.profile).toHaveLength(1);
    expect(callsAfterOAuth.calls.send).toHaveLength(0);
    // Token exchange used PKCE: code_verifier was sent.
    expect(
      callsAfterOAuth.calls.tokenExchange[0]!.parsedBody.code_verifier,
    ).toBeTruthy();

    // ── 4. Create workflow via UI ──
    await page.goto("/workflows");
    await page.getByRole("button", { name: "Create workflow" }).click();
    await page.getByLabel(/workflow name/i).fill("E2E Gmail Walkthrough");
    await Promise.all([
      page.waitForURL(/\/workflows\/[0-9a-f-]+/),
      page.getByRole("button", { name: "Create", exact: true }).click(),
    ]);
    const workflowId = page.url().match(/\/workflows\/([0-9a-f-]+)/)![1]!;

    // ── 5. Configure trigger + action via API patch ──
    // V2's builder UI cannot configure node `type` + `config` yet
    // (Slice 1I.2 was minimum picker + list + save). When per-node
    // configuration UI ships, replace this with UI interaction.
    const draftDefinition = {
      nodes: [
        {
          id: "trigger-node",
          kind: "trigger" as const,
          provider: "gmail",
          type: "new_email",
          // labelIds defaults to ["INBOX"] in the schema; we make it
          // explicit so the test reads the same way as the V2 schema.
          config: { labelIds: ["INBOX"] },
          position: { x: 0, y: 0 },
        },
        {
          id: "action-node",
          kind: "action" as const,
          provider: "gmail",
          type: "send_email",
          // Hardcoded recipient/subject/body — variable resolution from
          // trigger event is unit-tested elsewhere; this e2e exercises the
          // poll → enqueue → handler chain, not variable plumbing.
          // Both textBody + htmlBody set so the handler sends
          // `multipart/alternative` (Slice 2d Decision 2d-1, Option C).
          config: {
            to: "alice@e2e.test",
            subject: "Hello back",
            textBody: "Hello from e2e",
            htmlBody: "<p>Hello from e2e</p>",
          },
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
    // This triggers the Slice 2e activation hook: registerWorkflowTriggers
    // consults activationRegistry, calls Gmail's activate function, which
    // fetches users.getProfile against the mock and stamps
    // config.snapshot.historyId BEFORE upsert.
    await page.getByRole("button", { name: "Activate" }).click();
    await expect(
      page.locator("[data-status-kind=active]"),
    ).toBeVisible({ timeout: 10_000 });

    // DB: trigger_resources row has the snapshot from the mock's
    // currentHistoryId (seed = "100000").
    const triggerRowsAfterActivate = await getTriggerResourcesForUser(user.id);
    expect(triggerRowsAfterActivate).toHaveLength(1);
    const triggerAfterActivate = triggerRowsAfterActivate[0]! as Record<
      string,
      unknown
    >;
    expect(triggerAfterActivate.provider).toBe("gmail");
    expect(triggerAfterActivate.event_type).toBe("new_email");
    const configAfterActivate = triggerAfterActivate.config as {
      pollingEnabled?: boolean;
      snapshot?: { historyId?: string; capturedAt?: string };
    };
    expect(configAfterActivate.pollingEnabled).toBe(true);
    expect(configAfterActivate.snapshot?.historyId).toBe("100000");
    expect(configAfterActivate.snapshot?.capturedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );

    // Mock saw a second profile call (one from OAuth callback, one from
    // activation hook). No history.list / messages.get yet.
    const callsAfterActivate = await fetchMockCalls(request, mock.baseUrl);
    expect(callsAfterActivate.calls.profile).toHaveLength(2);
    expect(callsAfterActivate.calls.historyList).toHaveLength(0);
    expect(callsAfterActivate.calls.send).toHaveLength(0);

    // ── 7. Inject a new email via the mock control plane ──
    // Bumps mock currentHistoryId from "100000" to "100001" and queues
    // a `messageAdded` entry for the next history.list call.
    const injectResp = await page.request.post(
      `${mock.baseUrl}/__injectEmail`,
      {
        data: {
          id: messageId,
          headers: {
            From: "Bob <bob@e2e.test>",
            To: "alice@e2e.test",
            Subject: "Hello",
            Date: new Date().toUTCString(),
          },
          mimeType: "multipart/alternative",
          snippet: "Test inbound message",
        },
      },
    );
    expect(injectResp.status()).toBe(200);

    // ── 8. Trigger a poll cycle ──
    const pollResp = await request.post("/api/cron/poll-triggers", {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    expect(pollResp.status(), await pollResp.text()).toBe(200);

    // ── 9. Wait for workflow_run → assert succeeded ──
    const runs = await waitFor(
      async () => {
        const rows = await getWorkflowRunsForUser(user.id);
        return rows.length > 0 ? rows : null;
      },
      { description: "workflow_runs row to appear", timeoutMs: 15_000 },
    );
    expect(runs).toHaveLength(1);
    const run = runs[0]! as Record<string, unknown>;
    expect(run.status).toBe("succeeded");
    expect(run.error_classification).toBeNull();

    // ── 10. Mock saw exactly the expected Gmail calls ──
    const callsAfterPoll = await fetchMockCalls(request, mock.baseUrl);
    // history.list called once with the activation snapshot as start cursor.
    expect(callsAfterPoll.calls.historyList).toHaveLength(1);
    const historyCall = callsAfterPoll.calls.historyList[0]!;
    expect(historyCall.startHistoryId).toBe("100000");
    // V1-port behavior: BOTH messageAdded and labelAdded queried.
    expect(historyCall.historyTypes.sort()).toEqual([
      "labelAdded",
      "messageAdded",
    ]);
    // No labelId param — multi-label is filtered client-side (V1 parity).
    expect(historyCall.url).not.toMatch(/labelId=/);

    // messages.get called once for the injected message, format=metadata.
    expect(callsAfterPoll.calls.messagesGet).toHaveLength(1);
    expect(callsAfterPoll.calls.messagesGet[0]!.messageId).toBe(messageId);
    expect(callsAfterPoll.calls.messagesGet[0]!.format).toBe("metadata");

    // messages.send called exactly once with the right multipart body.
    expect(callsAfterPoll.calls.send).toHaveLength(1);
    const send = callsAfterPoll.calls.send[0]!;
    expect(send.parsed.mimeType).toBe("multipart/alternative");
    expect(send.parsed.headers.to).toBe("alice@e2e.test");
    expect(send.parsed.headers.subject).toBe("Hello back");
    expect(send.parsed.partsByMimeType["text/plain"] ?? "").toContain(
      "Hello from e2e",
    );
    // Authorization header carries the (decrypted) access token — proves
    // the encryption round-trip + refreshAndRetry plumbing.
    expect(send.authorization).toBe("Bearer ya29.mock-e2e-access");

    // ── 11. trigger_resources cursor advanced + dedup row written ──
    const triggerRowsAfterPoll = await getTriggerResourcesForUser(user.id);
    expect(triggerRowsAfterPoll).toHaveLength(1);
    const triggerAfterPoll = triggerRowsAfterPoll[0]! as Record<
      string,
      unknown
    >;
    const configAfterPoll = triggerAfterPoll.config as {
      snapshot?: { historyId?: string };
      polling?: { lastPolledAt?: string };
    };
    expect(configAfterPoll.snapshot?.historyId).toBe("100001");
    expect(configAfterPoll.polling?.lastPolledAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );

    // Dedup row written under (provider='gmail', event_id=messageId).
    const dedupRow = await getDedupRow("gmail", messageId);
    expect(dedupRow).not.toBeNull();

    // ── 12. UI: Run history shows the succeeded run ──
    await page.reload();
    const runHistory = page.locator('section[aria-label="Run history"]');
    await expect(runHistory).toBeVisible();
    await expect(runHistory.getByText(/succeeded/i)).toBeVisible();

    // ── 13. No notification on success path ──
    expect(await getNotificationsForUser(user.id)).toHaveLength(0);

    // ── 14. Dedup probe — replay same email and re-poll ──
    // /__replayLastEmail re-queues the same gmail message id at its
    // original historyId (does NOT bump currentHistoryId). On the next
    // poll, history.list will surface the same message id; dedup must
    // catch it via webhook_event_dedup keyed on (gmail, messageId), and
    // no second workflow_run + no second send must occur.
    //
    // Rewind the polling cursor BEFORE the second poll so the
    // scheduler's 5-min interval gate doesn't skip this trigger. The
    // gate reads `config.polling.lastPolledAt`; setting it to 24h ago
    // simulates enough time elapsed.
    await rewindTriggerPollingTimestamp(triggerAfterPoll.id as string);
    const replayResp = await page.request.post(
      `${mock.baseUrl}/__replayLastEmail`,
    );
    expect(replayResp.status()).toBe(200);

    const pollResp2 = await request.post("/api/cron/poll-triggers", {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    expect(pollResp2.status(), await pollResp2.text()).toBe(200);

    // Give the engine a moment to NOT execute a second run. We can't
    // wait-for-row (the row should not appear), so we busy-poll briefly
    // then assert the count stayed at 1.
    await new Promise((r) => setTimeout(r, 1500));
    const runsAfterReplay = await getWorkflowRunsForUser(user.id);
    expect(runsAfterReplay).toHaveLength(1);

    const callsAfterReplay = await fetchMockCalls(request, mock.baseUrl);
    // The second poll DID hit history.list + messages.get (we don't
    // dedup at the API call boundary — we dedup at the enqueue boundary,
    // which is correct because the dedup table is the single source of
    // truth for "did this message already trigger a run").
    expect(callsAfterReplay.calls.historyList).toHaveLength(2);
    // messages.get may or may not have been called a second time —
    // it's called per-history-message before the dedup check in the
    // current Slice 2e implementation. The send count is the load-
    // bearing assertion: send must NOT have fired twice.
    expect(callsAfterReplay.calls.send).toHaveLength(1);
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

interface MockInspect {
  calls: {
    authorize: { state: string; scope: string; codeChallenge: string | null }[];
    tokenExchange: { body: string; parsedBody: Record<string, string> }[];
    profile: { authorization: string | undefined; responseHistoryId: string }[];
    historyList: {
      authorization: string | undefined;
      url: string;
      startHistoryId: string;
      pageToken: string | null;
      historyTypes: string[];
      responseEntries: number;
    }[];
    messagesGet: {
      authorization: string | undefined;
      url: string;
      messageId: string;
      format: string;
    }[];
    send: {
      authorization: string | undefined;
      raw: string;
      decoded: string;
      parsed: {
        headers: Record<string, string>;
        mimeType: string;
        partsByMimeType: Record<string, string>;
      };
    }[];
  };
  currentHistoryId: string;
  emailCount: number;
  pendingHistoryEntries: { historyId: string; messageId: string }[];
  lastInjectedMessageId: string | null;
}

async function fetchMockCalls(
  request: APIRequestContext,
  mockBaseUrl: string,
): Promise<MockInspect> {
  const resp = await request.get(`${mockBaseUrl}/__inspect`);
  return (await resp.json()) as MockInspect;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`e2e: ${name} env var is required`);
  return v;
}
