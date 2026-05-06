/**
 * @jest-environment node
 *
 * Tests for services/notifications/notifyOnFailedRun.ts.
 *
 * Verifies the wire from a HumanizedError + run identifiers to the
 * notification row payload — the engine relies on this exact mapping for
 * the user-facing surface to make sense.
 */

const mockCreate = jest.fn();
jest.mock("@/repositories/notifications", () => ({
  create: (...args: unknown[]) => mockCreate(...args),
}));

import { notifyOnFailedRun } from "@/services/notifications/notifyOnFailedRun";
import type { HumanizedError } from "@/core/errors/humanizeActionError";

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
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

describe("notifyOnFailedRun", () => {
  it("creates a workflow_failed notification mirroring the humanized title + severity", async () => {
    const errorClassification: HumanizedError = {
      title: "Slack channel not found",
      description: "Slack couldn't find the channel id this step is trying to post to.",
      hint: "Double-check the channel id and that the bot is a member.",
      action: "open_node",
      severity: "error",
    };
    await notifyOnFailedRun({
      userId: "user-1",
      workflowId: "wf-1",
      runId: "run-1",
      errorClassification,
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "workflow_failed",
        severity: "error",
        title: "Slack channel not found",
      }),
    );
  });

  it("inlines hint into body when present (one-row UX, hint is load-bearing for action recommendation)", async () => {
    const errorClassification: HumanizedError = {
      title: "Slack needs to be reconnected",
      description: "Slack rejected the bot token.",
      hint: "Reconnect Slack on the integrations page.",
      action: "reconnect",
      severity: "error",
    };
    await notifyOnFailedRun({
      userId: "u",
      workflowId: "wf",
      runId: "run",
      errorClassification,
    });
    const arg = mockCreate.mock.calls[0]![0] as { body: string };
    expect(arg.body).toContain("Slack rejected the bot token.");
    expect(arg.body).toContain("Reconnect Slack on the integrations page.");
  });

  it("body is just description when no hint is provided", async () => {
    const errorClassification: HumanizedError = {
      title: "Workflow not found",
      description: "The workflow was deleted while a webhook event was waiting.",
      severity: "warning",
    };
    await notifyOnFailedRun({
      userId: "u",
      workflowId: "wf",
      runId: "run",
      errorClassification,
    });
    const arg = mockCreate.mock.calls[0]![0] as { body: string };
    expect(arg.body).toBe("The workflow was deleted while a webhook event was waiting.");
  });

  it("action_url deep-links to the workflow with the failed run highlighted", async () => {
    const errorClassification: HumanizedError = {
      title: "Task quota exhausted",
      description: "You've reached your task quota.",
      severity: "warning",
      action: "upgrade_plan",
    };
    await notifyOnFailedRun({
      userId: "u",
      workflowId: "wf-42",
      runId: "run-9",
      errorClassification,
    });
    const arg = mockCreate.mock.calls[0]![0] as { actionUrl: string; metadata: Record<string, unknown> };
    expect(arg.actionUrl).toBe("/workflows/wf-42?historyRun=run-9");
    expect(arg.metadata).toMatchObject({
      workflowId: "wf-42",
      runId: "run-9",
      action: "upgrade_plan",
    });
  });

  it("metadata omits action when humanizer didn't produce one", async () => {
    const errorClassification: HumanizedError = {
      title: "Workflow step failed",
      description: "boom",
      severity: "error",
    };
    await notifyOnFailedRun({
      userId: "u",
      workflowId: "wf",
      runId: "run",
      errorClassification,
    });
    const arg = mockCreate.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(arg.metadata).not.toHaveProperty("action");
  });
});
