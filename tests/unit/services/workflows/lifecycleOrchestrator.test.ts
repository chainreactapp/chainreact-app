/**
 * @jest-environment node
 *
 * Unit tests for services/workflows/lifecycleOrchestrator.ts.
 *
 * Mocks the workflows repository so we can drive the orchestrator's logic in
 * isolation:
 *   - state-machine validation
 *   - precondition gate
 *   - trigger registration ordering (before-persist for activate, after-persist
 *     for disable / delete) per rule §"V2 intended behavior"
 *   - rollback on persist failure during activate
 *   - best-effort semantics on unregisterTrigger and notify
 *   - LIFECYCLE_CONFLICT mapping when applyTransition returns null
 */
import {
  LifecycleOrchestrator,
  type LifecycleSideEffects,
} from "@/services/workflows/lifecycleOrchestrator";
import { LifecycleError } from "@/core/workflows/lifecycle";
import type { WorkflowRecord } from "@/repositories/workflows";

const mockGetById = jest.fn();
const mockApplyTransition = jest.fn();

jest.mock("@/repositories/workflows", () => ({
  getById: (...args: unknown[]) => mockGetById(...args),
  applyTransition: (...args: unknown[]) => mockApplyTransition(...args),
}));

function makeWorkflow(
  state: WorkflowRecord["state"],
  overrides: Partial<WorkflowRecord> = {},
): WorkflowRecord {
  return {
    id: "wf-1",
    userId: "user-1",
    name: "Test workflow",
    state,
    disabledReason: null,
    disabledContext: null,
    activeRevisionId: null,
    draftDefinition: { nodes: [], edges: [] },
    deletedAt: null,
    createdAt: "2026-05-06T00:00:00Z",
    updatedAt: "2026-05-06T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockGetById.mockReset();
  mockApplyTransition.mockReset();
});

describe("LifecycleOrchestrator.activate", () => {
  it("registers the trigger BEFORE persisting state and notifies after (rule §V2 intended behavior)", async () => {
    const wf = makeWorkflow("draft");
    const next = makeWorkflow("active");
    const order: string[] = [];
    mockGetById.mockResolvedValueOnce(wf);
    mockApplyTransition.mockImplementationOnce(async () => {
      order.push("apply");
      return next;
    });
    const hooks: LifecycleSideEffects = {
      registerTrigger: jest.fn(async () => {
        order.push("register");
      }),
      notify: jest.fn(async () => {
        order.push("notify");
      }),
    };

    const orch = new LifecycleOrchestrator(hooks);
    const result = await orch.activate("wf-1");

    expect(order).toEqual(["register", "apply", "notify"]);
    expect(mockApplyTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-1",
        expectedFromState: "draft",
        toState: "active",
        disabledReason: null,
        disabledContext: null,
      }),
    );
    expect(result).toBe(next);
  });

  it("throws MISSING_PRECONDITIONS when checkPreconditions returns ok:false; no register, no persist", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("draft"));
    const registerTrigger = jest.fn();
    const orch = new LifecycleOrchestrator({
      registerTrigger,
      checkPreconditions: async () => ({
        ok: false,
        failures: [{ code: "INTEGRATION_UNHEALTHY", message: "Slack disconnected" }],
      }),
    });

    await expect(orch.activate("wf-1")).rejects.toMatchObject({
      name: "LifecycleError",
      code: "MISSING_PRECONDITIONS",
    });
    expect(registerTrigger).not.toHaveBeenCalled();
    expect(mockApplyTransition).not.toHaveBeenCalled();
  });

  it("throws TRIGGER_REGISTRATION_FAILED when registerTrigger rejects; never persists", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("draft"));
    const orch = new LifecycleOrchestrator({
      registerTrigger: async () => {
        throw new Error("Slack API 500");
      },
    });

    await expect(orch.activate("wf-1")).rejects.toMatchObject({
      name: "LifecycleError",
      code: "TRIGGER_REGISTRATION_FAILED",
    });
    expect(mockApplyTransition).not.toHaveBeenCalled();
  });

  it("rolls back trigger registration when applyTransition throws (rule §Edge cases: activation rolls back)", async () => {
    const wf = makeWorkflow("draft");
    mockGetById.mockResolvedValueOnce(wf);
    mockApplyTransition.mockRejectedValueOnce(new Error("db error"));
    const unregisterTrigger = jest.fn(async () => {});
    const orch = new LifecycleOrchestrator({
      registerTrigger: async () => {},
      unregisterTrigger,
    });

    await expect(orch.activate("wf-1")).rejects.toThrow("db error");
    expect(unregisterTrigger).toHaveBeenCalledWith(wf);
  });

  it("maps applyTransition returning null (concurrent transition) to LIFECYCLE_CONFLICT and rolls back trigger", async () => {
    const wf = makeWorkflow("draft");
    mockGetById.mockResolvedValueOnce(wf);
    mockApplyTransition.mockResolvedValueOnce(null);
    const unregisterTrigger = jest.fn(async () => {});
    const orch = new LifecycleOrchestrator({
      registerTrigger: async () => {},
      unregisterTrigger,
    });

    await expect(orch.activate("wf-1")).rejects.toMatchObject({
      name: "LifecycleError",
      code: "LIFECYCLE_CONFLICT",
    });
    expect(unregisterTrigger).toHaveBeenCalled();
  });

  it("rejects when current state is not 'draft' (rule §Allowed transitions: only draft -> active)", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("paused"));
    const orch = new LifecycleOrchestrator();
    await expect(orch.activate("wf-1")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    expect(mockApplyTransition).not.toHaveBeenCalled();
  });
});

describe("LifecycleOrchestrator.pause", () => {
  it("transitions active -> paused without touching the trigger registration (rule §pause retains registration)", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("active"));
    mockApplyTransition.mockResolvedValueOnce(makeWorkflow("paused"));
    const registerTrigger = jest.fn();
    const unregisterTrigger = jest.fn();
    const orch = new LifecycleOrchestrator({ registerTrigger, unregisterTrigger });

    await orch.pause("wf-1");

    expect(registerTrigger).not.toHaveBeenCalled();
    expect(unregisterTrigger).not.toHaveBeenCalled();
    expect(mockApplyTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFromState: "active",
        toState: "paused",
      }),
    );
  });
});

describe("LifecycleOrchestrator.resume", () => {
  it("from paused: does NOT call registerTrigger (registration was retained)", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("paused"));
    mockApplyTransition.mockResolvedValueOnce(makeWorkflow("active"));
    const registerTrigger = jest.fn();
    const orch = new LifecycleOrchestrator({ registerTrigger });

    await orch.resume("wf-1");

    expect(registerTrigger).not.toHaveBeenCalled();
  });

  it("from eligible_to_resume: re-registers trigger before persisting (rule §eligible_to_resume -> active re-registers)", async () => {
    const wf = makeWorkflow("eligible_to_resume", {
      disabledReason: "integration_revoked",
    });
    const order: string[] = [];
    mockGetById.mockResolvedValueOnce(wf);
    mockApplyTransition.mockImplementationOnce(async () => {
      order.push("apply");
      return makeWorkflow("active");
    });
    const registerTrigger = jest.fn(async () => {
      order.push("register");
    });

    const orch = new LifecycleOrchestrator({ registerTrigger });
    await orch.resume("wf-1");

    expect(order).toEqual(["register", "apply"]);
    expect(mockApplyTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFromState: "eligible_to_resume",
        toState: "active",
        // Resume clears the disable context.
        disabledReason: null,
        disabledContext: null,
      }),
    );
  });

  it("preconditions block resume from eligible_to_resume; no registerTrigger called", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("eligible_to_resume"));
    const registerTrigger = jest.fn();
    const orch = new LifecycleOrchestrator({
      registerTrigger,
      checkPreconditions: async () => ({
        ok: false,
        failures: [{ code: "INTEGRATION_UNHEALTHY", message: "Slack still revoked" }],
      }),
    });

    await expect(orch.resume("wf-1")).rejects.toMatchObject({
      code: "MISSING_PRECONDITIONS",
    });
    expect(registerTrigger).not.toHaveBeenCalled();
    expect(mockApplyTransition).not.toHaveBeenCalled();
  });

  it("rejects from disabled (rule §Disallowed: disabled -> active without eligible_to_resume)", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("disabled"));
    const orch = new LifecycleOrchestrator();
    await expect(orch.resume("wf-1")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

describe("LifecycleOrchestrator.disable", () => {
  it("persists FIRST then unregisters trigger best-effort (rule §V2 intended behavior)", async () => {
    const next = makeWorkflow("disabled", {
      disabledReason: "integration_revoked",
    });
    mockGetById.mockResolvedValueOnce(makeWorkflow("active"));
    const order: string[] = [];
    mockApplyTransition.mockImplementationOnce(async () => {
      order.push("apply");
      return next;
    });
    const unregisterTrigger = jest.fn(async () => {
      order.push("unregister");
    });

    const orch = new LifecycleOrchestrator({ unregisterTrigger });
    await orch.disable({ workflowId: "wf-1", reason: "integration_revoked" });

    expect(order).toEqual(["apply", "unregister"]);
    expect(mockApplyTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFromState: "active",
        toState: "disabled",
        disabledReason: "integration_revoked",
        disabledContext: null,
      }),
    );
    expect(unregisterTrigger).toHaveBeenCalledWith(next);
  });

  it("swallows unregisterTrigger errors (best-effort — webhook dispatcher guards)", async () => {
    const next = makeWorkflow("disabled", { disabledReason: "billing_exhausted" });
    mockGetById.mockResolvedValueOnce(makeWorkflow("active"));
    mockApplyTransition.mockResolvedValueOnce(next);
    const orch = new LifecycleOrchestrator({
      unregisterTrigger: async () => {
        throw new Error("Slack API 503");
      },
    });

    await expect(
      orch.disable({ workflowId: "wf-1", reason: "billing_exhausted" }),
    ).resolves.toBe(next);
  });

  it("rejects disable from draft (rule §Disallowed: draft -> disabled)", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("draft"));
    const orch = new LifecycleOrchestrator();
    await expect(
      orch.disable({ workflowId: "wf-1", reason: "manual_admin" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(mockApplyTransition).not.toHaveBeenCalled();
  });

  it("forwards optional context to the persisted row", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("active"));
    mockApplyTransition.mockResolvedValueOnce(
      makeWorkflow("disabled", {
        disabledReason: "manual_admin",
        disabledContext: "Quarterly audit",
      }),
    );
    const orch = new LifecycleOrchestrator();
    await orch.disable({
      workflowId: "wf-1",
      reason: "manual_admin",
      context: "Quarterly audit",
    });

    expect(mockApplyTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        disabledContext: "Quarterly audit",
      }),
    );
  });
});

describe("LifecycleOrchestrator.markEligibleToResume", () => {
  it("transitions disabled -> eligible_to_resume; preserves disabled_reason for UI history", async () => {
    mockGetById.mockResolvedValueOnce(
      makeWorkflow("disabled", { disabledReason: "integration_revoked" }),
    );
    mockApplyTransition.mockResolvedValueOnce(
      makeWorkflow("eligible_to_resume", { disabledReason: "integration_revoked" }),
    );

    const orch = new LifecycleOrchestrator();
    await orch.markEligibleToResume("wf-1");

    expect(mockApplyTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFromState: "disabled",
        toState: "eligible_to_resume",
      }),
    );
    // The orchestrator did not pass disabledReason — repo leaves the column untouched.
    const callArg = mockApplyTransition.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("disabledReason");
  });

  it("rejects from active (rule §Allowed transitions: only disabled can mark eligible)", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("active"));
    const orch = new LifecycleOrchestrator();
    await expect(orch.markEligibleToResume("wf-1")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

describe("LifecycleOrchestrator.delete", () => {
  it("soft-deletes from active; persists with setDeletedAt then best-effort unregister", async () => {
    const next = makeWorkflow("deleted", { deletedAt: "2026-05-06T01:00:00Z" });
    mockGetById.mockResolvedValueOnce(makeWorkflow("active"));
    mockApplyTransition.mockResolvedValueOnce(next);
    const unregisterTrigger = jest.fn(async () => {});
    const orch = new LifecycleOrchestrator({ unregisterTrigger });

    await orch.delete("wf-1");

    expect(mockApplyTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFromState: "active",
        toState: "deleted",
        setDeletedAt: true,
      }),
    );
    expect(unregisterTrigger).toHaveBeenCalledWith(next);
  });

  it("delete is allowed from draft (no trigger registration to remove)", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("draft"));
    mockApplyTransition.mockResolvedValueOnce(
      makeWorkflow("deleted", { deletedAt: "2026-05-06T01:00:00Z" }),
    );
    const orch = new LifecycleOrchestrator();
    const result = await orch.delete("wf-1");
    expect(result.state).toBe("deleted");
  });

  it("rejects delete on already-deleted workflow (rule §Allowed transitions: deleted is terminal)", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("deleted"));
    const orch = new LifecycleOrchestrator();
    await expect(orch.delete("wf-1")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

describe("LifecycleOrchestrator (cross-cutting)", () => {
  it("throws WORKFLOW_NOT_FOUND when getById returns null", async () => {
    mockGetById.mockResolvedValueOnce(null);
    const orch = new LifecycleOrchestrator();
    await expect(orch.pause("nope")).rejects.toMatchObject({
      code: "WORKFLOW_NOT_FOUND",
    });
  });

  it("swallows notify errors so transitions never fail on observability concerns", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("active"));
    const next = makeWorkflow("paused");
    mockApplyTransition.mockResolvedValueOnce(next);

    const orch = new LifecycleOrchestrator({
      notify: async () => {
        throw new Error("Email service down");
      },
    });

    await expect(orch.pause("wf-1")).resolves.toBe(next);
  });

  it("LIFECYCLE_CONFLICT on pause (no rollback work since no trigger side-effect)", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("active"));
    mockApplyTransition.mockResolvedValueOnce(null);
    const orch = new LifecycleOrchestrator();
    await expect(orch.pause("wf-1")).rejects.toMatchObject({
      code: "LIFECYCLE_CONFLICT",
    });
  });

  it("LifecycleError instances expose code + details for callers / API mapping", async () => {
    mockGetById.mockResolvedValueOnce(makeWorkflow("draft"));
    const orch = new LifecycleOrchestrator();
    try {
      await orch.disable({ workflowId: "wf-1", reason: "manual_admin" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(LifecycleError);
      expect((e as LifecycleError).code).toBe("INVALID_TRANSITION");
      expect((e as LifecycleError).details).toMatchObject({
        from: "draft",
        transition: "disable",
      });
    }
  });
});
