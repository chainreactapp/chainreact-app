/**
 * Tests for features/integrations/ConnectButton.
 *
 * Verifies the data-access pattern: the component calls the typed client API
 * (`startOAuth`), never raw fetch. On success it navigates the browser via
 * `window.location.assign`. On failure it renders an inline error.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockStartOAuth = jest.fn();
jest.mock("@/lib/api/integrations", () => ({
  startOAuth: (...args: unknown[]) => mockStartOAuth(...args),
}));

import { ConnectButton } from "@/features/integrations/ConnectButton";

let assignSpy: jest.Mock;

beforeEach(() => {
  mockStartOAuth.mockReset();
  assignSpy = jest.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: assignSpy, href: "http://localhost/" },
  });
});

describe("ConnectButton", () => {
  it("calls startOAuth with the provider id and navigates to redirectUrl", async () => {
    mockStartOAuth.mockResolvedValueOnce({ redirectUrl: "https://slack.com/oauth/v2/authorize?x=1" });
    const user = userEvent.setup();
    render(<ConnectButton provider="slack" label="Connect Slack" />);
    await user.click(screen.getByRole("button", { name: /connect slack/i }));
    await waitFor(() => {
      expect(mockStartOAuth).toHaveBeenCalledWith("slack");
      expect(assignSpy).toHaveBeenCalledWith("https://slack.com/oauth/v2/authorize?x=1");
    });
  });

  it("disables the button while the request is in flight", async () => {
    let resolveCall: (v: { redirectUrl: string }) => void = () => {};
    mockStartOAuth.mockImplementationOnce(
      () => new Promise((resolve) => (resolveCall = resolve)),
    );
    const user = userEvent.setup();
    render(<ConnectButton provider="slack" label="Connect Slack" />);
    const btn = screen.getByRole("button", { name: /connect slack/i });
    await user.click(btn);
    expect(btn).toBeDisabled();
    expect(btn.textContent).toMatch(/redirecting/i);
    resolveCall({ redirectUrl: "https://x" });
    await waitFor(() => expect(assignSpy).toHaveBeenCalled());
  });

  it("renders a user-facing error and re-enables the button on failure", async () => {
    mockStartOAuth.mockRejectedValueOnce(new Error("Provider 'slack' is disabled."));
    const user = userEvent.setup();
    render(<ConnectButton provider="slack" label="Connect Slack" />);
    await user.click(screen.getByRole("button", { name: /connect slack/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/disabled/i);
    expect(screen.getByRole("button", { name: /connect slack/i })).not.toBeDisabled();
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
