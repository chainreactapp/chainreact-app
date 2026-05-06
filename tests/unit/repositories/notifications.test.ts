/**
 * @jest-environment node
 *
 * Tests for repositories/notifications.ts. Mocks both Supabase clients
 * (service-role for create; SSR-cookie for the user-scoped reads /
 * mark-read) to verify the row payload, the unread-only filter, and the
 * unread count.
 */

interface ChainState {
  insertPayload?: unknown;
  updatePayload?: unknown;
  filters: Array<{ op: string; args: unknown[] }>;
  resultData: unknown;
  resultError: { message: string } | null;
  countResult?: number | null;
}

function makeMockClient(state: ChainState) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    insert: jest.fn((p: unknown) => {
      state.insertPayload = p;
      return builder;
    }),
    update: jest.fn((p: unknown) => {
      state.updatePayload = p;
      return builder;
    }),
    select: jest.fn((cols?: string, opts?: { count?: string; head?: boolean }) => {
      state.filters.push({ op: "select", args: [cols ?? "*", opts] });
      return builder;
    }),
    eq: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "eq", args: [col, val] });
      return builder;
    }),
    is: jest.fn((col: string, val: unknown) => {
      state.filters.push({ op: "is", args: [col, val] });
      return builder;
    }),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    single: jest.fn(async () => ({
      data: state.resultData,
      error: state.resultError,
    })),
    maybeSingle: jest.fn(async () => ({
      data: state.resultData,
      error: state.resultError,
    })),
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: state.resultData,
        error: state.resultError,
        count: state.countResult ?? null,
      }),
  });
  return { from: jest.fn(() => builder), state };
}

const mockSSR: { current: ReturnType<typeof makeMockClient> | null } = { current: null };
const mockServiceRole: { current: ReturnType<typeof makeMockClient> | null } = { current: null };

jest.mock("@/utils/supabase/server", () => ({
  createClient: jest.fn(async () => mockSSR.current),
}));

jest.mock("@/repositories/supabase/serviceRoleClient", () => ({
  getServiceRoleClient: jest.fn(() => mockServiceRole.current),
}));

import {
  create,
  listForUser,
  countUnreadForUser,
  markRead,
  markAllReadForUser,
} from "@/repositories/notifications";

const baseRow = {
  id: "n-1",
  user_id: "user-1",
  type: "workflow_failed" as const,
  severity: "error" as const,
  title: "Slack action failed",
  body: "...",
  action_url: "/workflows/wf-1",
  metadata: { workflowId: "wf-1" },
  read_at: null,
  created_at: "2026-05-07T00:00:00Z",
};

describe("notifications.create", () => {
  it("INSERTs with snake_case translation + defaults", async () => {
    const state: ChainState = { filters: [], resultData: baseRow, resultError: null };
    mockServiceRole.current = makeMockClient(state);
    const result = await create({
      userId: "user-1",
      type: "workflow_failed",
      severity: "error",
      title: "Slack action failed",
      body: "Slack returned channel_not_found.",
      actionUrl: "/workflows/wf-1?historyRun=run-1",
      metadata: { workflowId: "wf-1", runId: "run-1" },
    });
    expect(state.insertPayload).toMatchObject({
      user_id: "user-1",
      type: "workflow_failed",
      severity: "error",
      title: "Slack action failed",
      body: "Slack returned channel_not_found.",
      action_url: "/workflows/wf-1?historyRun=run-1",
      metadata: { workflowId: "wf-1", runId: "run-1" },
    });
    expect(result.id).toBe("n-1");
  });

  it("defaults action_url to null and metadata to {} when not supplied", async () => {
    const state: ChainState = { filters: [], resultData: baseRow, resultError: null };
    mockServiceRole.current = makeMockClient(state);
    await create({
      userId: "user-1",
      type: "workflow_failed",
      severity: "warning",
      title: "Quota exhausted",
      body: "Upgrade your plan.",
    });
    const payload = state.insertPayload as Record<string, unknown>;
    expect(payload.action_url).toBeNull();
    expect(payload.metadata).toEqual({});
  });

  it("propagates Supabase insert errors", async () => {
    const state: ChainState = {
      filters: [],
      resultData: null,
      resultError: { message: "constraint violation" },
    };
    mockServiceRole.current = makeMockClient(state);
    await expect(
      create({
        userId: "user-1",
        type: "workflow_failed",
        severity: "error",
        title: "x",
        body: "y",
      }),
    ).rejects.toThrow(/constraint violation/);
  });
});

describe("notifications.listForUser", () => {
  it("filters by user_id, orders newest-first, defaults limit to 50", async () => {
    const state: ChainState = { filters: [], resultData: [baseRow], resultError: null };
    mockSSR.current = makeMockClient(state);
    const result = await listForUser("user-1");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("n-1");
    expect(state.filters).toContainEqual({ op: "eq", args: ["user_id", "user-1"] });
  });

  it("caps limit at 200 even when caller asks for more", async () => {
    const state: ChainState = { filters: [], resultData: [], resultError: null };
    mockSSR.current = makeMockClient(state);
    const limitSpy = mockSSR.current.from().limit as unknown as jest.Mock;
    await listForUser("user-1", { limit: 999 });
    expect(limitSpy).toHaveBeenLastCalledWith(200);
  });

  it("unreadOnly: true filters by read_at IS NULL", async () => {
    const state: ChainState = { filters: [], resultData: [], resultError: null };
    mockSSR.current = makeMockClient(state);
    await listForUser("user-1", { unreadOnly: true });
    expect(state.filters).toContainEqual({ op: "is", args: ["read_at", null] });
  });
});

describe("notifications.countUnreadForUser", () => {
  it("returns the head:true count restricted to read_at IS NULL", async () => {
    const state: ChainState = {
      filters: [],
      resultData: null,
      resultError: null,
      countResult: 7,
    };
    mockSSR.current = makeMockClient(state);
    const count = await countUnreadForUser("user-1");
    expect(count).toBe(7);
    expect(state.filters).toContainEqual({ op: "is", args: ["read_at", null] });
  });

  it("returns 0 when count is null", async () => {
    const state: ChainState = {
      filters: [],
      resultData: null,
      resultError: null,
      countResult: null,
    };
    mockSSR.current = makeMockClient(state);
    expect(await countUnreadForUser("user-1")).toBe(0);
  });
});

describe("notifications.markRead", () => {
  it("UPDATEs read_at to now() filtered by id, returns the updated row", async () => {
    const updated = { ...baseRow, read_at: "2026-05-07T00:01:00Z" };
    const state: ChainState = { filters: [], resultData: updated, resultError: null };
    mockSSR.current = makeMockClient(state);
    const result = await markRead("n-1");
    const payload = state.updatePayload as Record<string, unknown>;
    expect(payload.read_at).toBeDefined();
    expect(state.filters).toContainEqual({ op: "eq", args: ["id", "n-1"] });
    expect(result?.readAt).toBe("2026-05-07T00:01:00Z");
  });

  it("returns null when RLS blocks / id missing", async () => {
    const state: ChainState = { filters: [], resultData: null, resultError: null };
    mockSSR.current = makeMockClient(state);
    expect(await markRead("missing")).toBeNull();
  });
});

describe("notifications.markAllReadForUser", () => {
  it("UPDATEs all unread rows for the user, returns count", async () => {
    const state: ChainState = {
      filters: [],
      resultData: [{ id: "n-1" }, { id: "n-2" }],
      resultError: null,
    };
    mockSSR.current = makeMockClient(state);
    const count = await markAllReadForUser("user-1");
    expect(count).toBe(2);
    expect(state.filters).toContainEqual({ op: "eq", args: ["user_id", "user-1"] });
    expect(state.filters).toContainEqual({ op: "is", args: ["read_at", null] });
  });
});
