/**
 * @jest-environment node
 *
 * Tests for services/cron/auth.ts — the Slice 2e cron auth helper.
 */

import { requireCronAuth } from "@/services/cron/auth";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  }
});

function reqWithAuth(header: string | null): Request {
  const headers = new Headers();
  if (header !== null) headers.set("authorization", header);
  return new Request("http://localhost/cron/poll-triggers", {
    method: "POST",
    headers,
  });
}

describe("requireCronAuth", () => {
  it("returns ok when bearer token matches CRON_SECRET", () => {
    process.env.CRON_SECRET = "super-secret-value";
    const result = requireCronAuth(reqWithAuth("Bearer super-secret-value"));
    expect(result).toEqual({ authorized: true });
  });

  it("accepts case-insensitive 'bearer' prefix", () => {
    process.env.CRON_SECRET = "x";
    expect(requireCronAuth(reqWithAuth("bearer x"))).toEqual({
      authorized: true,
    });
    expect(requireCronAuth(reqWithAuth("BEARER x"))).toEqual({
      authorized: true,
    });
  });

  it("returns 500 when CRON_SECRET is not configured (deploy is broken)", () => {
    delete process.env.CRON_SECRET;
    const result = requireCronAuth(reqWithAuth("Bearer anything"));
    expect(result).toEqual({
      authorized: false,
      status: 500,
      message: expect.stringContaining("CRON_SECRET"),
    });
  });

  it("returns 401 when Authorization header is missing", () => {
    process.env.CRON_SECRET = "x";
    const result = requireCronAuth(reqWithAuth(null));
    expect(result).toEqual({
      authorized: false,
      status: 401,
      message: "Unauthorized",
    });
  });

  it("returns 401 when Authorization header is not Bearer-shaped", () => {
    process.env.CRON_SECRET = "x";
    expect(
      requireCronAuth(reqWithAuth("Basic dXNlcjpwYXNz")),
    ).toMatchObject({ authorized: false, status: 401 });
    expect(requireCronAuth(reqWithAuth("x"))).toMatchObject({
      authorized: false,
      status: 401,
    });
  });

  it("returns 401 when bearer token does not match", () => {
    process.env.CRON_SECRET = "expected";
    const result = requireCronAuth(reqWithAuth("Bearer wrong"));
    expect(result).toEqual({
      authorized: false,
      status: 401,
      message: "Unauthorized",
    });
  });

  it("returns 401 when provided value is a prefix of expected (length-mismatch must fail)", () => {
    process.env.CRON_SECRET = "expected-long-value";
    const result = requireCronAuth(reqWithAuth("Bearer expected"));
    expect(result.authorized).toBe(false);
  });

  it("returns 401 when expected is a prefix of provided (length-mismatch must fail)", () => {
    process.env.CRON_SECRET = "exp";
    const result = requireCronAuth(reqWithAuth("Bearer expectations-shifted"));
    expect(result.authorized).toBe(false);
  });
});
