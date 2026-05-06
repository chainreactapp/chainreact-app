/**
 * @jest-environment node
 *
 * Tests for lib/api/integrations.ts. Mocks global fetch.
 */
import { startOAuth } from "@/lib/api/integrations";

beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("startOAuth", () => {
  it("POSTs to /api/integrations/oauth/<provider>/connect and returns redirectUrl", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ redirectUrl: "https://slack.com/x" }), { status: 200 }),
    );
    const result = await startOAuth("slack");
    expect(result).toEqual({ redirectUrl: "https://slack.com/x" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/integrations/oauth/slack/connect",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("URL-encodes the provider name", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ redirectUrl: "x" }), { status: 200 }),
    );
    await startOAuth("provider/with/slash");
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "/api/integrations/oauth/provider%2Fwith%2Fslash/connect",
    );
  });

  it("surfaces the server-provided error message on non-2xx", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Provider 'gmail' does not support OAuth." }), {
        status: 400,
      }),
    );
    await expect(startOAuth("gmail")).rejects.toThrow(
      /Provider 'gmail' does not support OAuth/,
    );
  });

  it("falls back to a generic message when response is not JSON", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(startOAuth("slack")).rejects.toThrow(/HTTP 500/);
  });

  it("falls back to a generic message when response JSON has no error field", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 401 }),
    );
    await expect(startOAuth("slack")).rejects.toThrow(/HTTP 401/);
  });
});
