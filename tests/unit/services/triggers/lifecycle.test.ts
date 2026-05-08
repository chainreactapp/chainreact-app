/**
 * @jest-environment node
 *
 * Tests for services/triggers/lifecycle.ts.
 *
 * Mocks the trigger_resources repository so the test never touches the DB.
 * Verifies that:
 *   - registerWorkflowTriggers upserts one row per trigger node.
 *   - Manual-only workflows (zero trigger nodes) are a no-op.
 *   - unregisterWorkflowTriggers deletes by workflow id.
 *   - The accountId is intentionally null on register (resolved later).
 */

const mockUpsert = jest.fn();
const mockDeleteByWorkflow = jest.fn();
jest.mock("@/repositories/triggerResources", () => ({
  upsert: (...args: unknown[]) => mockUpsert(...args),
  deleteByWorkflow: (...args: unknown[]) => mockDeleteByWorkflow(...args),
}));

const mockGetActiveForExecution = jest.fn();
jest.mock("@/repositories/integrations", () => ({
  getActiveForExecution: (...args: unknown[]) =>
    mockGetActiveForExecution(...args),
}));

import {
  registerWorkflowTriggers,
  unregisterWorkflowTriggers,
} from "@/services/triggers/lifecycle";
import type { WorkflowRecord } from "@/repositories/workflows";
import {
  __resetActivationRegistryForTests,
  registerActivation,
} from "@/services/triggers/activationRegistry";

function makeWorkflow(
  nodes: WorkflowRecord["draftDefinition"]["nodes"],
): WorkflowRecord {
  return {
    id: "wf-1",
    userId: "user-1",
    name: "Test",
    state: "draft",
    disabledReason: null,
    disabledContext: null,
    activeRevisionId: null,
    draftDefinition: { nodes, edges: [] },
    deletedAt: null,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
  };
}

beforeEach(() => {
  mockUpsert.mockReset();
  mockDeleteByWorkflow.mockReset();
  mockGetActiveForExecution.mockReset();
  __resetActivationRegistryForTests();
});

describe("registerWorkflowTriggers", () => {
  it("upserts one row per trigger node, mirroring the node's provider/type/config", async () => {
    mockUpsert.mockResolvedValue({ id: "tr-1" });
    await registerWorkflowTriggers(
      makeWorkflow([
        {
          id: "n1",
          kind: "trigger",
          provider: "slack",
          type: "message_received",
          config: { channelId: "C123" },
          position: { x: 0, y: 0 },
        },
      ]),
    );
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith({
      workflowId: "wf-1",
      userId: "user-1",
      provider: "slack",
      eventType: "message_received",
      nodeId: "n1",
      config: { channelId: "C123" },
    });
  });

  it("ignores action nodes — only trigger nodes register", async () => {
    await registerWorkflowTriggers(
      makeWorkflow([
        {
          id: "n1",
          kind: "trigger",
          provider: "slack",
          type: "message_received",
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: "n2",
          kind: "action",
          provider: "slack",
          type: "send_channel_message",
          config: {},
          position: { x: 0, y: 100 },
        },
      ]),
    );
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0]![0]).toMatchObject({ nodeId: "n1" });
  });

  it("manual-only workflow (zero trigger nodes) is a no-op", async () => {
    await registerWorkflowTriggers(
      makeWorkflow([
        {
          id: "n1",
          kind: "action",
          provider: "slack",
          type: "send_channel_message",
          config: {},
          position: { x: 0, y: 0 },
        },
      ]),
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("propagates upsert errors so the orchestrator wraps with TRIGGER_REGISTRATION_FAILED", async () => {
    mockUpsert.mockRejectedValueOnce(new Error("permission denied"));
    await expect(
      registerWorkflowTriggers(
        makeWorkflow([
          {
            id: "n1",
            kind: "trigger",
            provider: "slack",
            type: "message_received",
            config: {},
            position: { x: 0, y: 0 },
          },
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("unregisterWorkflowTriggers", () => {
  it("deletes all trigger_resources rows for the workflow", async () => {
    await unregisterWorkflowTriggers(makeWorkflow([]));
    expect(mockDeleteByWorkflow).toHaveBeenCalledWith("wf-1");
  });
});

describe("registerWorkflowTriggers — activation hook (Slice 2e)", () => {
  it("calls a registered activation and merges its config patch into the upsert", async () => {
    const activation = jest
      .fn()
      .mockResolvedValue({ snapshot: { historyId: "12345" }, pollingEnabled: true });
    registerActivation("gmail", "new_email", activation);
    mockGetActiveForExecution.mockResolvedValue({
      id: "int-1",
      userId: "user-1",
      provider: "gmail",
      providerAccountId: "alice@example.com",
    });
    mockUpsert.mockResolvedValue({ id: "tr-1" });

    await registerWorkflowTriggers(
      makeWorkflow([
        {
          id: "n1",
          kind: "trigger",
          provider: "gmail",
          type: "new_email",
          config: { labelIds: ["INBOX"] },
          position: { x: 0, y: 0 },
        },
      ]),
    );

    expect(mockGetActiveForExecution).toHaveBeenCalledWith(
      "user-1",
      "gmail",
      null,
    );
    expect(activation).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gmail",
        eventType: "new_email",
        config: {
          labelIds: ["INBOX"],
          snapshot: { historyId: "12345" },
          pollingEnabled: true,
        },
      }),
    );
  });

  it("throws when the integration is missing — orchestrator wraps as TRIGGER_REGISTRATION_FAILED", async () => {
    registerActivation("gmail", "new_email", async () => ({}));
    mockGetActiveForExecution.mockResolvedValue(null);

    await expect(
      registerWorkflowTriggers(
        makeWorkflow([
          {
            id: "n1",
            kind: "trigger",
            provider: "gmail",
            type: "new_email",
            config: {},
            position: { x: 0, y: 0 },
          },
        ]),
      ),
    ).rejects.toThrow(/no active gmail integration/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("propagates activation throws and skips the upsert", async () => {
    registerActivation("gmail", "new_email", async () => {
      throw new Error("getProfile 503");
    });
    mockGetActiveForExecution.mockResolvedValue({ id: "int-1" });

    await expect(
      registerWorkflowTriggers(
        makeWorkflow([
          {
            id: "n1",
            kind: "trigger",
            provider: "gmail",
            type: "new_email",
            config: {},
            position: { x: 0, y: 0 },
          },
        ]),
      ),
    ).rejects.toThrow(/getProfile 503/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("triggers without a registered activation skip the integration lookup (Slack pattern)", async () => {
    mockUpsert.mockResolvedValue({ id: "tr-1" });
    await registerWorkflowTriggers(
      makeWorkflow([
        {
          id: "n1",
          kind: "trigger",
          provider: "slack",
          type: "message_received",
          config: { channelId: "C123" },
          position: { x: 0, y: 0 },
        },
      ]),
    );
    expect(mockGetActiveForExecution).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });
});
