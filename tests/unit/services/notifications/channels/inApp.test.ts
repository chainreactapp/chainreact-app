/**
 * @jest-environment node
 *
 * Tests for services/notifications/channels/inApp.ts.
 *
 * Covers the in-app channel contract:
 *   - Successful create → returns { delivered: true }
 *   - Repository throws → returns { delivered: false, reason } (does NOT throw)
 *   - In-app row shape matches the payload (title, severity, body w/ inlined
 *     hint, action_url, metadata)
 */

const mockNotificationsCreate = jest.fn();
jest.mock("@/repositories/notifications", () => ({
  create: (...args: unknown[]) => mockNotificationsCreate(...args),
}));

import { inAppChannel } from "@/services/notifications/channels/inApp";
import { buildWorkflowFailurePayload } from "@/services/notifications/buildWorkflowFailurePayload";
import type { HumanizedError } from "@/core/errors/humanizeActionError";

beforeEach(() => {
  mockNotificationsCreate.mockReset();
  mockNotificationsCreate.mockResolvedValue({
    id: "n-1",
    userId: "u",
    type: "workflow_failed",
    severity: "error",
    title: "x",
    body: "y",
    actionUrl: null,
    metadata: {},
    readAt: null,
    createdAt: "2026-05-07T00:00:00Z",
  });
});

function payload(overrides: Partial<HumanizedError> = {}) {
  return buildWorkflowFailurePayload({
    workflowId: "wf-1",
    workflowName: "Test Workflow",
    runId: "run-1",
    errorClassification: {
      title: "Slack channel not found",
      description: "Couldn't find the channel.",
      hint: "Check channel id.",
      action: "open_node",
      severity: "error",
      ...overrides,
    },
  });
}

describe("inAppChannel — happy path", () => {
  it("returns { delivered: true } when the row insert succeeds", async () => {
    const result = await inAppChannel.send(payload(), "user-1");
    expect(result).toEqual({ delivered: true });
    expect(mockNotificationsCreate).toHaveBeenCalledTimes(1);
  });

  it("forwards humanized title + severity into the in-app row", async () => {
    await inAppChannel.send(payload(), "user-1");
    const arg = mockNotificationsCreate.mock.calls[0]![0] as {
      userId: string;
      type: string;
      title: string;
      severity: string;
    };
    expect(arg.userId).toBe("user-1");
    expect(arg.type).toBe("workflow_failed");
    expect(arg.title).toBe("Slack channel not found");
    expect(arg.severity).toBe("error");
  });

  it("inlines the hint into the body (one-blob channel rendering)", async () => {
    await inAppChannel.send(payload(), "user-1");
    const arg = mockNotificationsCreate.mock.calls[0]![0] as { body: string };
    expect(arg.body).toBe("Couldn't find the channel. Check channel id.");
  });

  it("body is just description when no hint is present", async () => {
    await inAppChannel.send(payload({ hint: undefined }), "user-1");
    const arg = mockNotificationsCreate.mock.calls[0]![0] as { body: string };
    expect(arg.body).toBe("Couldn't find the channel.");
  });

  it("uses the payload's CTA URL as action_url (centralized routing, no per-channel re-derivation)", async () => {
    await inAppChannel.send(payload({ action: "open_node" }), "user-1");
    const arg = mockNotificationsCreate.mock.calls[0]![0] as { actionUrl: string };
    expect(arg.actionUrl).toBe("/workflows/wf-1?historyRun=run-1");
  });

  it("metadata carries workflowId / workflowName / runId / action for downstream filtering", async () => {
    await inAppChannel.send(payload({ action: "reconnect" }), "user-1");
    const arg = mockNotificationsCreate.mock.calls[0]![0] as {
      metadata: Record<string, unknown>;
    };
    expect(arg.metadata).toMatchObject({
      workflowId: "wf-1",
      workflowName: "Test Workflow",
      runId: "run-1",
      action: "reconnect",
    });
  });

  it("metadata omits action when humanizer didn't produce one", async () => {
    await inAppChannel.send(payload({ action: undefined }), "user-1");
    const arg = mockNotificationsCreate.mock.calls[0]![0] as {
      metadata: Record<string, unknown>;
    };
    expect(arg.metadata).not.toHaveProperty("action");
  });

  it("severity flows through unchanged (warning vs error matters for UI styling)", async () => {
    await inAppChannel.send(payload({ severity: "warning" }), "user-1");
    const arg = mockNotificationsCreate.mock.calls[0]![0] as { severity: string };
    expect(arg.severity).toBe("warning");
  });
});

describe("inAppChannel — failure isolation", () => {
  it("returns { delivered: false, reason } when the repository throws — does NOT propagate", async () => {
    mockNotificationsCreate.mockRejectedValueOnce(new Error("DB connection lost"));
    const result = await inAppChannel.send(payload(), "user-1");
    expect(result.delivered).toBe(false);
    if (!result.delivered) {
      expect(result.reason).toBe("DB connection lost");
    }
  });

  it("handles non-Error throws with a stable 'unknown error' reason", async () => {
    mockNotificationsCreate.mockRejectedValueOnce("a string was thrown for some reason");
    const result = await inAppChannel.send(payload(), "user-1");
    expect(result).toEqual({ delivered: false, reason: "unknown error" });
  });
});

describe("inAppChannel — name", () => {
  it("identifies as 'in_app' for orchestrator logging + future channel routing", () => {
    expect(inAppChannel.name).toBe("in_app");
  });
});
