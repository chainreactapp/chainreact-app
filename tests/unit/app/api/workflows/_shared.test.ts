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
  toWorkflowSummary,
} from "@/app/api/workflows/_shared";
import type { WorkflowRecord } from "@/repositories/workflows";

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
      draftDefinition: { nodes: [{ id: "n1" }], edges: [] },
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
