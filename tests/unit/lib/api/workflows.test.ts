/**
 * @jest-environment node
 *
 * Tests for lib/api/workflows.ts. Mocks global fetch.
 *
 * Verifies:
 *   - URL + method + body for each operation
 *   - WorkflowApiError carries the LifecycleError code from the server response
 *   - id is URL-encoded
 *   - non-JSON / no-error-field server responses fall back to a generic message
 */
import {
  WorkflowApiError,
  activateWorkflow,
  createWorkflow,
  disableWorkflow,
  getWorkflow,
  listWorkflows,
  pauseWorkflow,
  resumeWorkflow,
  updateWorkflow,
} from "@/lib/api/workflows";

const SAMPLE: import("@/contracts/workflow").WorkflowSummary = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Test workflow",
  state: "draft",
  disabledReason: null,
  disabledContext: null,
  deletedAt: null,
  createdAt: "2026-05-06T12:00:00Z",
  updatedAt: "2026-05-06T12:00:00Z",
};

beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("createWorkflow", () => {
  it("POSTs to /api/workflows with JSON body and returns the parsed summary", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE), { status: 201 }),
    );
    const result = await createWorkflow({ name: "Test workflow" });
    expect(result).toEqual(SAMPLE);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/workflows",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "Test workflow" }),
      }),
    );
  });

  it("throws WorkflowApiError with code BAD_REQUEST on 400 without server code", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Workflow name is required." }), {
        status: 400,
      }),
    );
    await expect(createWorkflow({ name: "" })).rejects.toMatchObject({
      name: "WorkflowApiError",
      code: "BAD_REQUEST",
      status: 400,
      message: "Workflow name is required.",
    });
  });
});

describe("listWorkflows", () => {
  it("GETs /api/workflows and returns workflows array", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ workflows: [SAMPLE] }), { status: 200 }),
    );
    const result = await listWorkflows();
    expect(result).toEqual([SAMPLE]);
    expect(fetchSpy).toHaveBeenCalledWith("/api/workflows");
  });

  it("propagates a 401 as WorkflowApiError code UNAUTHENTICATED", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }),
    );
    await expect(listWorkflows()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("lifecycle action endpoints", () => {
  it("activateWorkflow POSTs to /api/workflows/<id>/activate with no body", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ...SAMPLE, state: "active" }), { status: 200 }),
    );
    const result = await activateWorkflow(SAMPLE.id);
    expect(result.state).toBe("active");
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/workflows/${SAMPLE.id}/activate`,
      expect.objectContaining({ method: "POST", body: null }),
    );
  });

  it("pauseWorkflow POSTs to the correct URL", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ...SAMPLE, state: "paused" }), { status: 200 }),
    );
    await pauseWorkflow(SAMPLE.id);
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/workflows/${SAMPLE.id}/pause`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resumeWorkflow POSTs to the correct URL", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ...SAMPLE, state: "active" }), { status: 200 }),
    );
    await resumeWorkflow(SAMPLE.id);
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/workflows/${SAMPLE.id}/resume`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("disableWorkflow POSTs reason + context as JSON body", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...SAMPLE,
          state: "disabled",
          disabledReason: "manual_admin",
        }),
        { status: 200 },
      ),
    );
    await disableWorkflow(SAMPLE.id, {
      reason: "manual_admin",
      context: "Quarterly audit",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/workflows/${SAMPLE.id}/disable`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "manual_admin", context: "Quarterly audit" }),
      }),
    );
  });

  it("URL-encodes the workflow id", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE), { status: 200 }),
    );
    await activateWorkflow("with/slash and space");
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "/api/workflows/with%2Fslash%20and%20space/activate",
    );
  });
});

describe("getWorkflow / updateWorkflow", () => {
  const detail = {
    ...SAMPLE,
    activeRevisionId: null,
    draftDefinition: { nodes: [], edges: [] },
  };

  it("getWorkflow GETs /api/workflows/<id> and returns the detail", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(detail), { status: 200 }),
    );
    const result = await getWorkflow(SAMPLE.id);
    expect(result).toEqual(detail);
    expect(fetchSpy).toHaveBeenCalledWith(`/api/workflows/${SAMPLE.id}`);
  });

  it("getWorkflow surfaces 404 as WORKFLOW_NOT_FOUND", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Workflow not found.", code: "WORKFLOW_NOT_FOUND" }),
        { status: 404 },
      ),
    );
    await expect(getWorkflow(SAMPLE.id)).rejects.toMatchObject({
      code: "WORKFLOW_NOT_FOUND",
      status: 404,
    });
  });

  it("updateWorkflow PATCHes the body and returns the updated detail", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ...detail, name: "Renamed" }), { status: 200 }),
    );
    const result = await updateWorkflow(SAMPLE.id, { name: "Renamed" });
    expect(result.name).toBe("Renamed");
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/workflows/${SAMPLE.id}`,
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "Renamed" }),
      }),
    );
  });

  it("updateWorkflow surfaces a 400 with the server-provided message", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Workflow name is required." }), {
        status: 400,
      }),
    );
    await expect(
      updateWorkflow(SAMPLE.id, { name: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });
});

describe("WorkflowApiError code mapping (server-supplied)", () => {
  const cases: ReadonlyArray<[number, string, WorkflowApiError["code"]]> = [
    [404, "WORKFLOW_NOT_FOUND", "WORKFLOW_NOT_FOUND"],
    [409, "INVALID_TRANSITION", "INVALID_TRANSITION"],
    [409, "LIFECYCLE_CONFLICT", "LIFECYCLE_CONFLICT"],
    [422, "MISSING_PRECONDITIONS", "MISSING_PRECONDITIONS"],
    [502, "TRIGGER_REGISTRATION_FAILED", "TRIGGER_REGISTRATION_FAILED"],
  ];
  it.each(cases)(
    "status %i + server code %s -> client code %s",
    async (status, serverCode, expectedCode) => {
      jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "x", code: serverCode }), { status }),
      );
      await expect(activateWorkflow(SAMPLE.id)).rejects.toMatchObject({
        code: expectedCode,
        status,
      });
    },
  );

  it("falls back to a generic message when response is not JSON", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(activateWorkflow(SAMPLE.id)).rejects.toMatchObject({
      code: "SERVER_ERROR",
      status: 500,
      message: expect.stringMatching(/HTTP 500/),
    });
  });

  it("unknown server code resolves to UNKNOWN", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "x", code: "WHO_KNOWS" }), { status: 418 }),
    );
    await expect(activateWorkflow(SAMPLE.id)).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });
});
