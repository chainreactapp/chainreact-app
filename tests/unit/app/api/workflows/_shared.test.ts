/**
 * @jest-environment node
 *
 * Tests for app/api/workflows/_shared.ts. The shared route helpers translate
 * orchestrator outcomes into HTTP responses; the typed client at
 * lib/api/workflows.ts and the routes both depend on this contract.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { LifecycleError } from "@/core/workflows/lifecycle";

// Mock supabase BEFORE importing _shared so requireUser sees the mock.
const mockGetUser = jest.fn();
jest.mock("@/utils/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: () => mockGetUser() },
  })),
}));

import {
  lifecycleErrorResponse,
  parseJsonBody,
  requireUser,
  runLifecycle,
  toWorkflowDetail,
  toWorkflowRunSummary,
  toWorkflowSummary,
} from "@/app/api/workflows/_shared";
import type { WorkflowRecord } from "@/repositories/workflows";
import type { WorkflowRunRecord } from "@/repositories/workflowRuns";
import type { TriggerEvent } from "@/contracts/triggerEvent";

beforeEach(() => {
  mockGetUser.mockReset();
});

describe("requireUser", () => {
  it("returns ok with the user id when supabase has a session", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    const result = await requireUser();
    expect(result).toEqual({ ok: true, userId: "user-1" });
  });

  it("returns a 401 response when supabase has no user", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body).toEqual({ error: "unauthenticated" });
    }
  });

  it("returns a 401 response when supabase reports an auth error", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error("token expired"),
    });
    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});

describe("lifecycleErrorResponse", () => {
  const cases: ReadonlyArray<[LifecycleError["code"], number]> = [
    ["WORKFLOW_NOT_FOUND", 404],
    ["INVALID_TRANSITION", 409],
    ["LIFECYCLE_CONFLICT", 409],
    ["MISSING_PRECONDITIONS", 422],
    ["TRIGGER_REGISTRATION_FAILED", 502],
  ];
  it.each(cases)("%s -> HTTP %i", async (code, expectedStatus) => {
    const err = new LifecycleError(code, "msg", { hint: "x" });
    const res = lifecycleErrorResponse(err);
    expect(res.status).toBe(expectedStatus);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "msg",
      code,
      details: { hint: "x" },
    });
  });
});

describe("runLifecycle", () => {
  it("calls toResponse on success", async () => {
    const res = await runLifecycle(
      async () => "result",
      (val) => NextResponse.json({ val }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ val: "result" });
  });

  it("converts LifecycleError to its HTTP shape", async () => {
    const res = await runLifecycle(
      async () => {
        throw new LifecycleError("INVALID_TRANSITION", "no", { from: "draft" });
      },
      () => NextResponse.json({}),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("falls back to 500 for unexpected errors", async () => {
    const res = await runLifecycle(
      async () => {
        throw new Error("boom");
      },
      () => NextResponse.json({}),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "boom" });
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns parsed data when body matches the schema", async () => {
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ name: "ok" }),
    });
    const result = await parseJsonBody(req, schema);
    expect(result).toEqual({ ok: true, data: { name: "ok" } });
  });

  it("returns 400 with the first issue message on schema failure", async () => {
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });
    const result = await parseJsonBody(req, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.error).toMatch(/at least|String must|too_small/i);
    }
  });

  it("returns 400 when the body is not JSON", async () => {
    const req = new Request("http://x", {
      method: "POST",
      body: "not-json",
    });
    const result = await parseJsonBody(req, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.error).toMatch(/JSON/);
    }
  });
});

describe("toWorkflowSummary", () => {
  it("strips userId / activeRevisionId / draftDefinition from the wire shape", () => {
    const record: WorkflowRecord = {
      id: "wf-1",
      userId: "user-1",
      name: "Test",
      state: "active",
      disabledReason: null,
      disabledContext: null,
      activeRevisionId: "rev-1",
      draftDefinition: {
        nodes: [
          {
            id: "n1",
            kind: "trigger" as const,
            provider: "slack",
            type: "message_received",
            config: {},
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
      deletedAt: null,
      createdAt: "2026-05-06T00:00:00Z",
      updatedAt: "2026-05-06T01:00:00Z",
    };
    const summary = toWorkflowSummary(record);
    expect(summary).toEqual({
      id: "wf-1",
      name: "Test",
      state: "active",
      disabledReason: null,
      disabledContext: null,
      deletedAt: null,
      createdAt: "2026-05-06T00:00:00Z",
      updatedAt: "2026-05-06T01:00:00Z",
    });
    expect(summary).not.toHaveProperty("userId");
    expect(summary).not.toHaveProperty("activeRevisionId");
    expect(summary).not.toHaveProperty("draftDefinition");
  });
});

describe("toWorkflowDetail", () => {
  it("includes activeRevisionId + draftDefinition; still strips userId", () => {
    const record: WorkflowRecord = {
      id: "wf-1",
      userId: "user-1",
      name: "Test",
      state: "active",
      disabledReason: null,
      disabledContext: null,
      activeRevisionId: "rev-1",
      draftDefinition: {
        nodes: [
          {
            id: "n1",
            kind: "trigger" as const,
            provider: "slack",
            type: "message_received",
            config: {},
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
      deletedAt: null,
      createdAt: "2026-05-06T00:00:00Z",
      updatedAt: "2026-05-06T01:00:00Z",
    };
    const detail = toWorkflowDetail(record);
    expect(detail.activeRevisionId).toBe("rev-1");
    expect(detail.draftDefinition.nodes[0]?.id).toBe("n1");
    expect(detail.draftDefinition.edges).toEqual([]);
    expect(detail).not.toHaveProperty("userId");
  });
});

describe("toWorkflowRunSummary", () => {
  const triggerEvent: TriggerEvent = {
    provider: "slack",
    eventType: "message",
    eventId: "Ev1",
    occurredAt: "2026-05-07T00:00:00Z",
    accountId: "T0001",
    payload: { text: "secret" },
  };

  const baseRecord: WorkflowRunRecord = {
    id: "11111111-1111-1111-1111-111111111111",
    workflowId: "22222222-2222-2222-2222-222222222222",
    userId: "user-1",
    status: "succeeded",
    triggerNodeId: "t1",
    triggerEvent,
    steps: [
      { nodeId: "t1", status: "succeeded", output: { event: triggerEvent } },
    ],
    fatalError: null,
    errorClassification: null,
    startedAt: "2026-05-07T00:00:00Z",
    finishedAt: "2026-05-07T00:00:01Z",
    createdAt: "2026-05-07T00:00:00Z",
  };

  it("strips userId / steps / triggerEvent / fatalError from the wire shape", () => {
    const summary = toWorkflowRunSummary(baseRecord);
    expect(summary).not.toHaveProperty("userId");
    expect(summary).not.toHaveProperty("steps");
    expect(summary).not.toHaveProperty("triggerEvent");
    expect(summary).not.toHaveProperty("fatalError");
  });

  it("forwards the humanized errorClassification verbatim", () => {
    const summary = toWorkflowRunSummary({
      ...baseRecord,
      status: "failed",
      errorClassification: {
        title: "Slack channel not found",
        description: "...",
        action: "open_node",
        severity: "error",
      },
    });
    expect(summary.errorClassification).toMatchObject({
      title: "Slack channel not found",
      action: "open_node",
      severity: "error",
    });
  });
});
