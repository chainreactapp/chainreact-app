/**
 * @jest-environment node
 *
 * Route-level test for /api/cron/poll-triggers.
 *
 * Mocks the scheduler + the registry side-effect import so the route is
 * tested in isolation. Verifies:
 *   - Missing / wrong / misconfigured CRON_SECRET → correct status codes.
 *   - Authorized GET and POST both delegate to runPollingTriggers.
 *   - Scheduler throws → route returns generic 500 (no internal leakage).
 */

const mockRunPollingTriggers = jest.fn();

jest.mock("@/services/cron/runPollingTriggers", () => ({
  runPollingTriggers: (...args: unknown[]) => mockRunPollingTriggers(...args),
}));

// Side-effect registry import: replace with a no-op so the route file's
// `import "@/integrations/_registry"` doesn't pull in real provider modules.
jest.mock("@/integrations/_registry", () => ({}));

import { GET, POST } from "@/app/api/cron/poll-triggers/route";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  mockRunPollingTriggers.mockReset();
  process.env.CRON_SECRET = "test-secret";
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  }
});

function reqWithAuth(method: "GET" | "POST", header: string | null): Request {
  const headers = new Headers();
  if (header !== null) headers.set("authorization", header);
  return new Request("http://localhost/api/cron/poll-triggers", {
    method,
    headers,
  });
}

describe("/api/cron/poll-triggers — auth", () => {
  it("returns 401 when no Authorization header", async () => {
    const res = await POST(reqWithAuth("POST", null));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockRunPollingTriggers).not.toHaveBeenCalled();
  });

  it("returns 401 when bearer token is wrong", async () => {
    const res = await POST(reqWithAuth("POST", "Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(mockRunPollingTriggers).not.toHaveBeenCalled();
  });

  it("returns 500 when CRON_SECRET is not configured (deploy is broken)", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(reqWithAuth("POST", "Bearer anything"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/CRON_SECRET/);
    expect(mockRunPollingTriggers).not.toHaveBeenCalled();
  });
});

describe("/api/cron/poll-triggers — happy path", () => {
  it("authorized POST delegates to runPollingTriggers and returns its result", async () => {
    mockRunPollingTriggers.mockResolvedValueOnce({
      examined: 3,
      processed: 2,
      skipped: 1,
      errors: 0,
      startedAt: "2026-05-07T12:00:00.000Z",
    });

    const res = await POST(reqWithAuth("POST", "Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      examined: 3,
      processed: 2,
      skipped: 1,
      errors: 0,
    });
    expect(mockRunPollingTriggers).toHaveBeenCalledTimes(1);
  });

  it("authorized GET (Vercel cron shape) also delegates to runPollingTriggers", async () => {
    mockRunPollingTriggers.mockResolvedValueOnce({
      examined: 0,
      processed: 0,
      skipped: 0,
      errors: 0,
      startedAt: "2026-05-07T12:00:00.000Z",
    });

    const res = await GET(reqWithAuth("GET", "Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(mockRunPollingTriggers).toHaveBeenCalledTimes(1);
  });
});

describe("/api/cron/poll-triggers — fault tolerance", () => {
  it("returns generic 500 when scheduler throws (no internal message leakage)", async () => {
    mockRunPollingTriggers.mockRejectedValueOnce(
      new Error("internal: db connection lost"),
    );

    const res = await POST(reqWithAuth("POST", "Bearer test-secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Polling cron failed.");
    // Internal error message must NOT leak into the response.
    expect(JSON.stringify(body)).not.toContain("db connection lost");
  });
});
