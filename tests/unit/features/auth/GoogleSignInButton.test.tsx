import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockSignInWithOAuth = jest.fn();
jest.mock("@/utils/supabase/client", () => ({
  createClient: jest.fn(() => ({
    auth: { signInWithOAuth: mockSignInWithOAuth },
  })),
}));

import { GoogleSignInButton } from "@/features/auth/GoogleSignInButton";

beforeEach(() => {
  mockSignInWithOAuth.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { origin: "https://app.example.test", href: "https://app.example.test/" },
  });
});

describe("GoogleSignInButton", () => {
  it("calls signInWithOAuth with provider=google and the callback redirectTo", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({ error: null });
    const user = userEvent.setup();
    render(<GoogleSignInButton />);
    await user.click(screen.getByRole("button", { name: /sign in with google/i }));
    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: "https://app.example.test/auth/callback" },
      });
    });
  });

  it("disables the button while the request is in flight", async () => {
    let resolveCall: (v: { error: null }) => void = () => {};
    mockSignInWithOAuth.mockImplementationOnce(
      () => new Promise((resolve) => (resolveCall = resolve)),
    );
    const user = userEvent.setup();
    render(<GoogleSignInButton />);
    const btn = screen.getByRole("button", { name: /sign in with google/i });
    await user.click(btn);
    expect(btn).toBeDisabled();
    expect(btn.textContent).toMatch(/redirecting/i);
    resolveCall({ error: null });
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalled());
  });

  it("renders an error and re-enables the button when supabase returns an error", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({
      error: { message: "Provider not enabled" },
    });
    const user = userEvent.setup();
    render(<GoogleSignInButton />);
    await user.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/provider not enabled/i);
    expect(screen.getByRole("button", { name: /sign in with google/i })).not.toBeDisabled();
  });
});
