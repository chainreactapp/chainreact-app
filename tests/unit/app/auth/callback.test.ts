/**
 * @jest-environment node
 *
 * Tests for app/auth/callback/route.ts.
 *
 * Cites database-security.md / oauth-dispatcher.md: validate the callback
 * code, exchange via Supabase, redirect to a same-origin path. Open-redirect
 * via the `next` param is explicitly defended against.
 */

const mockExchangeCodeForSession = jest.fn();
jest.mock("@/utils/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { exchangeCodeForSession: mockExchangeCodeForSession },
  })),
}));

import { GET } from "@/app/auth/callback/route";

beforeEach(() => {
  mockExchangeCodeForSession.mockReset();
});

function makeRequest(search: string): Request {
  return new Request(`http://localhost:3000/auth/callback${search}`);
}

describe("GET /auth/callback", () => {
  it("exchanges the code and redirects to / on success", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const res = await GET(makeRequest("?code=valid-code"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("valid-code");
  });

  it("respects a same-origin `next` redirect target", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const res = await GET(makeRequest("?code=valid-code&next=/integrations"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/integrations");
  });

  it("rejects an open-redirect via // in `next`", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const res = await GET(makeRequest("?code=valid-code&next=//evil.com/x"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("rejects an absolute `next` URL", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const res = await GET(makeRequest("?code=valid-code&next=https://evil.com"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("redirects to /auth/sign-in with a humanized error when code is missing", async () => {
    const res = await GET(makeRequest(""));
    expect(res.headers.get("location")).toContain("/auth/sign-in");
    expect(res.headers.get("location")).toContain("error=oauth_missing_code");
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("redirects to /auth/sign-in with the supabase error when exchange fails", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      error: { message: "code expired" },
    });
    const res = await GET(makeRequest("?code=stale-code"));
    expect(res.headers.get("location")).toContain("/auth/sign-in");
    expect(res.headers.get("location")).toContain(encodeURIComponent("code expired"));
  });
});
