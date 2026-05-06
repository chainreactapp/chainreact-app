/**
 * @jest-environment node
 *
 * Tests for app/api/workflows/[id]/route.ts.
 *
 * Verifies the non-trivial route logic: 404 mapping for missing-or-deleted
 * rows, the no-op when PATCH name is unchanged, and the success path.
 *
 * Mocks supabase + repository so the test never touches the network or DB.
 */

const mockGetUser = jest.fn();
jest.mock("@/utils/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: () => mockGetUser() },
  })),
}));

const mockGetById = jest.fn();
const mockUpdateName = jest.fn();
jest.mock("@/repositories/workflows", () => ({
  getById: (...args: unknown[]) => mockGetById(...args),
  updateName: (...args: unknown[]) => mockUpdateName(...args),
}));

import { GET, PATCH } from "@/app/api/workflows/[id]/route";

const baseRecord = {
  id: "wf-1",
  userId: "user-1",
  name: "Original",
  state: "draft" as const,
  disabledReason: null,
  disabledContext: null,
  activeRevisionId: null,
  draftDefinition: { nodes: [], edges: [] },
  deletedAt: null,
  createdAt: "2026-05-06T00:00:00Z",
  updatedAt: "2026-05-06T00:00:00Z",
};

beforeEach(() => {
  mockGetUser.mockReset();
  mockGetById.mockReset();
  mockUpdateName.mockReset();
});

function authedUser(): void {
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
}

describe("GET /api/workflows/[id]", () => {
  it("returns the WorkflowDetail when the row exists and is not deleted", async () => {
    authedUser();
    mockGetById.mockResolvedValueOnce(baseRecord);
    const res = await GET(new Request("http://x/wf-1"), {
      params: Promise.resolve({ id: "wf-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "wf-1",
      name: "Original",
      state: "draft",
      activeRevisionId: null,
      draftDefinition: { nodes: [], edges: [] },
    });
    expect(body).not.toHaveProperty("userId");
  });

  it("returns 404 (WORKFLOW_NOT_FOUND) when getById returns null", async () => {
    authedUser();
    mockGetById.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x/wf-1"), {
      params: Promise.resolve({ id: "wf-1" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("WORKFLOW_NOT_FOUND");
  });

  it("returns 404 even when the row exists but state === 'deleted' (soft-delete is hidden)", async () => {
    authedUser();
    mockGetById.mockResolvedValueOnce({
      ...baseRecord,
      state: "deleted",
      deletedAt: "2026-05-06T01:00:00Z",
    });
    const res = await GET(new Request("http://x/wf-1"), {
      params: Promise.resolve({ id: "wf-1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 401 when no user is signed in", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const res = await GET(new Request("http://x/wf-1"), {
      params: Promise.resolve({ id: "wf-1" }),
    });
    expect(res.status).toBe(401);
    expect(mockGetById).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/workflows/[id]", () => {
  function patchRequest(body: unknown): Request {
    return new Request("http://x/wf-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("updates the name and returns the updated detail", async () => {
    authedUser();
    mockGetById.mockResolvedValueOnce(baseRecord);
    mockUpdateName.mockResolvedValueOnce({ ...baseRecord, name: "Renamed" });
    const res = await PATCH(patchRequest({ name: "Renamed" }), {
      params: Promise.resolve({ id: "wf-1" }),
    });
    expect(res.status).toBe(200);
    expect(mockUpdateName).toHaveBeenCalledWith("wf-1", "Renamed");
    const body = await res.json();
    expect(body.name).toBe("Renamed");
  });

  it("skips updateName when the name is unchanged (no-op write)", async () => {
    authedUser();
    mockGetById.mockResolvedValueOnce(baseRecord);
    const res = await PATCH(patchRequest({ name: "Original" }), {
      params: Promise.resolve({ id: "wf-1" }),
    });
    expect(res.status).toBe(200);
    expect(mockUpdateName).not.toHaveBeenCalled();
  });

  it("returns 404 when the workflow is deleted (PATCH must mirror GET's 404)", async () => {
    authedUser();
    mockGetById.mockResolvedValueOnce({ ...baseRecord, state: "deleted" });
    const res = await PATCH(patchRequest({ name: "Renamed" }), {
      params: Promise.resolve({ id: "wf-1" }),
    });
    expect(res.status).toBe(404);
    expect(mockUpdateName).not.toHaveBeenCalled();
  });

  it("returns 400 with the schema error when name is empty", async () => {
    authedUser();
    const res = await PATCH(patchRequest({ name: "" }), {
      params: Promise.resolve({ id: "wf-1" }),
    });
    expect(res.status).toBe(400);
    expect(mockGetById).not.toHaveBeenCalled();
  });

  it("returns 400 when the body has no editable fields", async () => {
    authedUser();
    const res = await PATCH(patchRequest({}), {
      params: Promise.resolve({ id: "wf-1" }),
    });
    expect(res.status).toBe(400);
  });
});
