/**
 * @jest-environment node
 *
 * Tests for app/auth/actions.ts.
 *
 * Covers input-validation and supabase-error paths. The redirect-on-success
 * path uses next/navigation's `redirect()` which throws an internal symbol
 * caught by the framework — not directly testable here. End-to-end sign-up /
 * sign-in is covered by Playwright e2e in a later slice once the schema +
 * feature flow is final.
 */

const mockSignUp = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockSignOut = jest.fn();

jest.mock("@/utils/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: {
      signUp: mockSignUp,
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
    },
  })),
}));

jest.mock("next/navigation", () => ({
  redirect: jest.fn((path: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${path}` });
  }),
}));

import { signIn, signUp } from "@/app/auth/actions";

beforeEach(() => {
  mockSignUp.mockReset();
  mockSignInWithPassword.mockReset();
  mockSignOut.mockReset();
});

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

describe("auth actions — input validation", () => {
  it("signUp returns error when email is missing", async () => {
    const result = await signUp(null, fd({ password: "password123" }));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/required/i) });
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("signUp returns error when password is empty", async () => {
    const result = await signUp(null, fd({ email: "user@example.test", password: "" }));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/required/i) });
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("signIn returns error when email is whitespace", async () => {
    const result = await signIn(null, fd({ email: "   ", password: "password123" }));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/required/i) });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });
});

describe("auth actions — supabase error surfacing", () => {
  it("signUp surfaces the supabase error message verbatim", async () => {
    mockSignUp.mockResolvedValueOnce({ error: { message: "User already registered" } });
    const result = await signUp(null, fd({ email: "user@example.test", password: "password123" }));
    expect(result).toEqual({ ok: false, error: "User already registered" });
  });

  it("signIn surfaces the supabase error message verbatim", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    const result = await signIn(null, fd({ email: "user@example.test", password: "wrong-password" }));
    expect(result).toEqual({ ok: false, error: "Invalid login credentials" });
  });

  it("signUp passes trimmed email to supabase", async () => {
    mockSignUp.mockResolvedValueOnce({ error: { message: "any" } });
    await signUp(null, fd({ email: "  user@example.test  ", password: "password123" }));
    expect(mockSignUp).toHaveBeenCalledWith({
      email: "user@example.test",
      password: "password123",
    });
  });
});
