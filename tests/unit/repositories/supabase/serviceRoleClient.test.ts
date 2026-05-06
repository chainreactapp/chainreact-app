/**
 * @jest-environment node
 *
 * Tests for repositories/supabase/serviceRoleClient.ts.
 *
 * Runs in node env (not jsdom) because the runtime check refuses to
 * construct when `typeof window !== "undefined"`, which is true in jsdom.
 * Service-role is server-only — the production environment is node.
 *
 * Cites database-security.md: service-role construction lives in exactly one
 * place; reason is required for audit; the client is cached; browser
 * construction is refused as defense-in-depth against bundle leaks.
 */
import {
  getServiceRoleClient,
  __resetServiceRoleClientForTesting,
} from "@/repositories/supabase/serviceRoleClient";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  __resetServiceRoleClientForTesting();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  __resetServiceRoleClientForTesting();
});

describe("getServiceRoleClient", () => {
  it("returns a SupabaseClient when env is present and reason is given", () => {
    const client = getServiceRoleClient("unit-test");
    expect(client).toBeDefined();
    expect(typeof client.from).toBe("function");
  });

  it("caches the client across calls (same instance)", () => {
    const a = getServiceRoleClient("first-call");
    const b = getServiceRoleClient("second-call");
    expect(a).toBe(b);
  });

  it("throws when reason is empty or missing", () => {
    expect(() => getServiceRoleClient("")).toThrow(/reason/);
    expect(() => getServiceRoleClient("   ")).toThrow(/reason/);
    // @ts-expect-error — runtime check
    expect(() => getServiceRoleClient(undefined)).toThrow();
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    __resetServiceRoleClientForTesting();
    expect(() => getServiceRoleClient("test")).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    __resetServiceRoleClientForTesting();
    expect(() => getServiceRoleClient("test")).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("refuses to construct in a browser-like environment", () => {
    // Simulate window. jsdom test environment provides one already.
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {} as unknown;
    try {
      expect(() => getServiceRoleClient("browser-test")).toThrow(/browser/);
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("logs the reason at info level for audit", () => {
    const spy = jest.spyOn(console, "info").mockImplementation(() => {});
    try {
      getServiceRoleClient("renew-microsoft-graph-subscription");
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("renew-microsoft-graph-subscription"),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
