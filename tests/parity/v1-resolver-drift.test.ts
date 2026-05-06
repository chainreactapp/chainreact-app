/**
 * @jest-environment node
 *
 * PARITY TEST — V1 incident: resolver drift across runtime paths.
 *
 * What V1 did wrong:
 *   V1 had at least three resolver paths that all answered "what does
 *   `{{nodeId.field}}` resolve to?" — `lib/workflows/actions/core` action-
 *   layer resolveValue, `lib/execution/variableResolver` DataFlowManager,
 *   and integration-layer resolvers in some provider modules. They drifted
 *   on missing-variable handling: some returned `undefined`, some
 *   preserved the literal `{{...}}` token, some passed the unresolved
 *   string to handlers as-is. Real consequences:
 *     - Slack action posted "{{trigger.payload.text}}" verbatim into
 *       channels.
 *     - Stripe amount fields received "{{trigger.amount}}" → coerced to
 *       NaN cents → silent zero-dollar charges.
 *     - Webhook actions sent literal placeholder strings to external
 *       services that then 200'd without doing anything.
 *
 * The V1 fix landed as the Q2 contract in handler-contracts.md:
 *   "Runtime workflow execution uses strict pre-resolution at the engine
 *    layer. Missing {{...}} references become the standardized config-
 *    failure shape BEFORE action / integration handler dispatch — handlers
 *    never see unresolved templates at runtime."
 *
 * V2's design closes the gap structurally: there is ONE canonical
 * resolver (workflow-engine/variables/resolveValue.ts) with two modes —
 * strict (throws MissingVariableError) for runtime, soft (returns
 * undefined / preserves literal) for builder / preview / planner. The
 * engine catches the strict-mode throw and converts it to a step-level
 * MISSING_VARIABLE failure before the handler can be invoked.
 *
 * THIS TEST is the must-pass case proving V2 doesn't regress to V1's
 * behavior. If V2 ever ships a code path where an unresolved {{...}} can
 * reach a handler, this test fails — and the resolver-drift class of bug
 * is back.
 *
 * Per testing-strategy.md §"Parity tests": cite the V1 incident, exercise
 * the end-to-end contract (not just an isolated unit), and assert
 * specifically on what the V1 bug would have allowed through.
 *
 * --- Lifecycle / categorization note ---
 * This file lives under tests/parity/ because it is positioned as historical
 * V1 parity coverage — the V1 incident is what motivates the test. After V1
 * deletion / Phase 5 cutover the "parity" framing becomes historical: there
 * is no V1 to drift from, but the underlying invariant remains a V2 runtime
 * contract worth defending. At that point this test should be relocated to
 * tests/integration/ (or wherever V2's composition-level test bucket lives)
 * with a small header tweak; the assertions don't change.
 *
 * Invariant guarded by this test (V1 parity AND V2 runtime contract):
 *   Strict runtime variable resolution MUST fail before handler invocation
 *   when required variables are missing. Handlers never receive unresolved
 *   {{...}} templates at runtime — neither standalone nor embedded in
 *   mixed strings.
 */

const mockGetByIdServiceRole = jest.fn();
jest.mock("@/repositories/workflows", () => ({
  getByIdServiceRole: (...args: unknown[]) => mockGetByIdServiceRole(...args),
}));

const mockGetActionHandler = jest.fn();
jest.mock("@/services/execution/handlers/_registry", () => ({
  getActionHandler: (...args: unknown[]) => mockGetActionHandler(...args),
}));

const mockRecordRun = jest.fn();
jest.mock("@/repositories/workflowRuns", () => ({
  recordRun: (...args: unknown[]) => mockRecordRun(...args),
}));

const mockBillingGate = jest.fn();
jest.mock("@/services/billing/executionBillingGate", () => ({
  executionBillingGate: (...args: unknown[]) => mockBillingGate(...args),
}));

const mockNotifyWorkflowFailure = jest.fn();
jest.mock("@/services/notifications/notifyWorkflowFailure", () => ({
  notifyWorkflowFailure: (...args: unknown[]) => mockNotifyWorkflowFailure(...args),
}));

import { WorkflowEngine } from "@/services/execution/engine";
import { resolveStrict } from "@/workflow-engine/variables/resolveValue";
import type { TriggerEvent } from "@/contracts/triggerEvent";
import type { WorkflowNode } from "@/contracts/workflow";

const triggerEvent: TriggerEvent = {
  provider: "slack",
  eventType: "message",
  eventId: "Ev1",
  occurredAt: "2026-05-07T00:00:00Z",
  accountId: "T0001",
  payload: {
    text: "hello",
    channel: "C123",
    // Note: no `unknown` field — that's the missing-variable case under test.
  },
};

const triggerNode: WorkflowNode = {
  id: "trigger-node",
  kind: "trigger",
  provider: "slack",
  type: "message",
  config: {},
  position: { x: 0, y: 0 },
};

function actionWithTemplate(textTemplate: string): WorkflowNode {
  return {
    id: "slack-send",
    kind: "action",
    provider: "slack",
    type: "send_channel_message",
    config: {
      channel: "C123",
      text: textTemplate,
    },
    position: { x: 0, y: 100 },
  };
}

function workflowWith(actionTextTemplate: string) {
  return {
    id: "wf-resolver-drift",
    userId: "user-1",
    name: "resolver drift parity",
    state: "active" as const,
    disabledReason: null,
    disabledContext: null,
    activeRevisionId: null,
    draftDefinition: {
      nodes: [triggerNode, actionWithTemplate(actionTextTemplate)],
      edges: [{ id: "e1", from: "trigger-node", to: "slack-send" }],
    },
    deletedAt: null,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
  };
}

beforeEach(() => {
  mockGetByIdServiceRole.mockReset();
  mockGetActionHandler.mockReset();
  mockRecordRun.mockReset();
  mockRecordRun.mockResolvedValue(undefined);
  mockBillingGate.mockReset();
  mockBillingGate.mockResolvedValue({ ok: true, used: 1, limit: 100 });
  mockNotifyWorkflowFailure.mockReset();
  mockNotifyWorkflowFailure.mockResolvedValue({ claimed: true, results: [] });
});

describe("PARITY: V1 resolver drift — handlers never see unresolved {{...}}", () => {
  it("standalone {{trigger.payload.unknown}} → handler NOT invoked + MISSING_VARIABLE step", async () => {
    // The action's `text` is exactly `{{trigger.payload.unknown}}` — under
    // V1's drifted paths, some resolvers returned `undefined` (handler
    // would post the empty string), some returned the literal token (Slack
    // would post the placeholder verbatim). V2's strict mode throws before
    // dispatch.
    mockGetByIdServiceRole.mockResolvedValueOnce(
      workflowWith("{{trigger.payload.unknown}}"),
    );
    const slackHandler = jest.fn();
    mockGetActionHandler.mockReturnValueOnce(slackHandler);

    const engine = new WorkflowEngine({ resolveStrict });
    const result = await engine.runWorkflow({
      workflowId: "wf-resolver-drift",
      triggerNodeId: "trigger-node",
      triggerEvent,
    });

    // The contract: handler MUST NOT have run.
    expect(slackHandler).not.toHaveBeenCalled();

    // The contract: failure surfaces as MISSING_VARIABLE on the action step.
    expect(result.status).toBe("failed");
    const failedStep = result.steps.find((s) => s.nodeId === "slack-send");
    expect(failedStep).toMatchObject({
      status: "failed",
      error: {
        code: "MISSING_VARIABLE",
        details: { path: "trigger.payload.unknown", reason: "missing_field" },
      },
    });
  });

  it("mixed-string `Hello {{trigger.payload.unknown}}!` → handler NOT invoked (V1 would have sent the literal)", async () => {
    // V1 mixed-string drift: some paths preserved the literal "{{...}}" inside
    // the surrounding text and sent the whole "Hello {{...}}!" string to the
    // provider. V2 strict mode throws on missing references regardless of
    // whether the template is standalone or embedded in a larger string.
    mockGetByIdServiceRole.mockResolvedValueOnce(
      workflowWith("Hello {{trigger.payload.unknown}}!"),
    );
    const slackHandler = jest.fn();
    mockGetActionHandler.mockReturnValueOnce(slackHandler);

    const result = await new WorkflowEngine({ resolveStrict }).runWorkflow({
      workflowId: "wf-resolver-drift",
      triggerNodeId: "trigger-node",
      triggerEvent,
    });

    expect(slackHandler).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    const failedStep = result.steps.find((s) => s.nodeId === "slack-send");
    expect(failedStep?.error?.code).toBe("MISSING_VARIABLE");
  });

  it("missing referenced step (not the trigger) → handler NOT invoked + missing_node reason surfaces", async () => {
    // V1 drift: a downstream action referencing an upstream step that
    // didn't run (or whose id was renamed) sometimes received the literal
    // string `{{step1.output}}`. V2 distinguishes "missing_node" from
    // "missing_field" in the reason field for better humanized errors —
    // and either way, the handler doesn't see the literal.
    mockGetByIdServiceRole.mockResolvedValueOnce(
      workflowWith("Result was: {{step-that-doesnt-exist.foo}}"),
    );
    const slackHandler = jest.fn();
    mockGetActionHandler.mockReturnValueOnce(slackHandler);

    const result = await new WorkflowEngine({ resolveStrict }).runWorkflow({
      workflowId: "wf-resolver-drift",
      triggerNodeId: "trigger-node",
      triggerEvent,
    });

    expect(slackHandler).not.toHaveBeenCalled();
    const failedStep = result.steps.find((s) => s.nodeId === "slack-send");
    expect(failedStep?.error).toMatchObject({
      code: "MISSING_VARIABLE",
      details: { reason: "missing_node" },
    });
  });

  it("when the variable IS resolvable, the handler receives the RESOLVED value (no literal token leak)", async () => {
    // Positive case: prove V2 actually substitutes when it should. If a bug
    // ever broke string substitution, this test catches it before the
    // missing-variable test gives a false sense of "resolver works."
    mockGetByIdServiceRole.mockResolvedValueOnce(
      workflowWith("Channel was: {{trigger.payload.channel}}"),
    );
    const slackHandler = jest.fn(async () => ({ output: { ok: true } }));
    mockGetActionHandler.mockReturnValueOnce(slackHandler);

    const result = await new WorkflowEngine({ resolveStrict }).runWorkflow({
      workflowId: "wf-resolver-drift",
      triggerNodeId: "trigger-node",
      triggerEvent,
    });

    expect(result.status).toBe("succeeded");
    expect(slackHandler).toHaveBeenCalledTimes(1);
    const handlerArgs = slackHandler.mock.calls[0] as unknown as readonly unknown[];
    const callArg = handlerArgs[0] as {
      config: { text: string; channel: string };
    };
    // The handler MUST receive the substituted value, not the literal.
    expect(callArg.config.text).toBe("Channel was: C123");
    expect(callArg.config.text).not.toContain("{{");
    expect(callArg.config.channel).toBe("C123");
  });

  it("the failure produces a humanized error_classification suitable for the user-facing surfaces", async () => {
    // V1's drift made debugging painful because the user just saw "Slack
    // posted '{{trigger.text}}'" with no idea what went wrong. V2's
    // engine + humanizer + notification chain gives the user a
    // plain-English explanation. End-to-end check that the chain works.
    mockGetByIdServiceRole.mockResolvedValueOnce(
      workflowWith("{{trigger.payload.unknown}}"),
    );
    mockGetActionHandler.mockReturnValueOnce(jest.fn());

    await new WorkflowEngine({ resolveStrict }).runWorkflow({
      workflowId: "wf-resolver-drift",
      triggerNodeId: "trigger-node",
      triggerEvent,
    });

    // recordRun gets the humanized classification (workflow_runs.error_classification column).
    const recordCall = mockRecordRun.mock.calls[0]![0] as {
      errorClassification: { title: string; description: string; action?: string };
    };
    expect(recordCall.errorClassification.title).toMatch(/variable/i);
    expect(recordCall.errorClassification.description).toContain(
      "trigger.payload.unknown",
    );
    expect(recordCall.errorClassification.action).toBe("open_node");

    // notifyWorkflowFailure fires (in-app notification surface from Slice 1 close).
    expect(mockNotifyWorkflowFailure).toHaveBeenCalledTimes(1);
  });
});
