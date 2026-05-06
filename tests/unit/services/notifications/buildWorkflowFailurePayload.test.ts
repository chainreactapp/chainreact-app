/**
 * Tests for services/notifications/buildWorkflowFailurePayload.ts.
 *
 * Pure function — no mocks needed. Covers the CTA URL routing per
 * humanizer action and the payload field passthrough that all channels
 * downstream rely on.
 */
import {
  buildWorkflowFailurePayload,
  buildPlainTextBody,
} from "@/services/notifications/buildWorkflowFailurePayload";
import type { HumanizedError } from "@/core/errors/humanizeActionError";

const baseInput = {
  workflowId: "wf-1",
  workflowName: "Daily Standup Reminder",
  runId: "run-1",
};

function makeErr(overrides: Partial<HumanizedError> = {}): HumanizedError {
  return {
    title: "Workflow step failed",
    description: "Something went wrong.",
    severity: "error",
    ...overrides,
  };
}

describe("buildWorkflowFailurePayload — passthrough", () => {
  it("passes workflow + run identifiers + classification through unchanged", () => {
    const errorClassification = makeErr();
    const payload = buildWorkflowFailurePayload({
      ...baseInput,
      errorClassification,
    });
    expect(payload.workflowId).toBe("wf-1");
    expect(payload.workflowName).toBe("Daily Standup Reminder");
    expect(payload.runId).toBe("run-1");
    expect(payload.errorClassification).toBe(errorClassification);
  });

  it("is deterministic for the same input (pure function contract)", () => {
    const errorClassification = makeErr();
    const a = buildWorkflowFailurePayload({ ...baseInput, errorClassification });
    const b = buildWorkflowFailurePayload({ ...baseInput, errorClassification });
    expect(a).toEqual(b);
  });
});

describe("buildWorkflowFailurePayload — CTA URL routing per humanizer action", () => {
  it("action='reconnect' → /integrations + 'Reconnect' label", () => {
    const payload = buildWorkflowFailurePayload({
      ...baseInput,
      errorClassification: makeErr({ action: "reconnect" }),
    });
    expect(payload.ctaUrl).toBe("/integrations");
    expect(payload.ctaLabel).toBe("Reconnect");
  });

  it("action='upgrade_plan' → /subscription + 'Upgrade plan' label", () => {
    const payload = buildWorkflowFailurePayload({
      ...baseInput,
      errorClassification: makeErr({ action: "upgrade_plan" }),
    });
    expect(payload.ctaUrl).toBe("/subscription");
    expect(payload.ctaLabel).toBe("Upgrade plan");
  });

  it("action='open_node' → workflow detail with run highlighted + 'View workflow' label", () => {
    const payload = buildWorkflowFailurePayload({
      ...baseInput,
      errorClassification: makeErr({ action: "open_node" }),
    });
    expect(payload.ctaUrl).toBe("/workflows/wf-1?historyRun=run-1");
    expect(payload.ctaLabel).toBe("View workflow");
  });

  it("action=undefined → run-history fallback (matches V1's null-action behavior)", () => {
    const payload = buildWorkflowFailurePayload({
      ...baseInput,
      errorClassification: makeErr({ action: undefined }),
    });
    expect(payload.ctaUrl).toBe("/workflows/wf-1?historyRun=run-1");
    expect(payload.ctaLabel).toBe("View run");
  });

  it("CTA URL embeds the actual workflow + run ids (not hardcoded)", () => {
    const payload = buildWorkflowFailurePayload({
      workflowId: "wf-abc-123",
      workflowName: "x",
      runId: "run-xyz-789",
      errorClassification: makeErr({ action: "open_node" }),
    });
    expect(payload.ctaUrl).toBe("/workflows/wf-abc-123?historyRun=run-xyz-789");
  });
});

describe("buildPlainTextBody", () => {
  it("inlines hint after description when hint is present", () => {
    const body = buildPlainTextBody({
      title: "x",
      description: "Slack rejected the bot token.",
      hint: "Reconnect Slack on the integrations page.",
      severity: "error",
      action: "reconnect",
    });
    expect(body).toBe(
      "Slack rejected the bot token. Reconnect Slack on the integrations page.",
    );
  });

  it("returns just the description when no hint is present", () => {
    const body = buildPlainTextBody({
      title: "x",
      description: "The workflow was deleted while a webhook event was waiting.",
      severity: "warning",
    });
    expect(body).toBe(
      "The workflow was deleted while a webhook event was waiting.",
    );
  });
});
