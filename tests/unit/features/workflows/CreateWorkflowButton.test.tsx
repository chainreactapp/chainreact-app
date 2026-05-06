/**
 * Tests for features/workflows/CreateWorkflowButton.
 *
 * Verifies the button-opens-form-then-submits flow: name input, calls the
 * typed client API, refreshes the route on success, surfaces an inline error
 * with the WorkflowApiError message on failure.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockCreateWorkflow = jest.fn();
const mockRefresh = jest.fn();

jest.mock("@/lib/api/workflows", () => {
  // Re-export the real WorkflowApiError so the component's `instanceof` check works.
  const actual = jest.requireActual("@/lib/api/workflows");
  return {
    ...actual,
    createWorkflow: (...args: unknown[]) => mockCreateWorkflow(...args),
  };
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { CreateWorkflowButton } from "@/features/workflows/CreateWorkflowButton";
import { WorkflowApiError } from "@/lib/api/workflows";

beforeEach(() => {
  mockCreateWorkflow.mockReset();
  mockRefresh.mockReset();
});

describe("CreateWorkflowButton", () => {
  it("starts collapsed and reveals the form when clicked", async () => {
    const user = userEvent.setup();
    render(<CreateWorkflowButton />);
    await user.click(screen.getByRole("button", { name: /create workflow/i }));
    expect(screen.getByLabelText(/workflow name/i)).toBeInTheDocument();
  });

  it("submits the trimmed name, refreshes the router on success, and re-collapses", async () => {
    mockCreateWorkflow.mockResolvedValueOnce({
      id: "wf-1",
      name: "Onboarding",
      state: "draft",
      disabledReason: null,
      disabledContext: null,
      deletedAt: null,
      createdAt: "2026-05-06T00:00:00Z",
      updatedAt: "2026-05-06T00:00:00Z",
    });
    const user = userEvent.setup();
    render(<CreateWorkflowButton />);
    await user.click(screen.getByRole("button", { name: /create workflow/i }));
    await user.type(screen.getByLabelText(/workflow name/i), "  Onboarding  ");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockCreateWorkflow).toHaveBeenCalledWith({ name: "Onboarding" });
      expect(mockRefresh).toHaveBeenCalled();
    });
    // Form re-collapses; the entry button is back.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /create workflow/i }),
      ).toBeInTheDocument(),
    );
  });

  it("renders a user-facing error from WorkflowApiError and does NOT refresh", async () => {
    mockCreateWorkflow.mockRejectedValueOnce(
      new WorkflowApiError("Workflow name is required.", "BAD_REQUEST", 400),
    );
    const user = userEvent.setup();
    render(<CreateWorkflowButton />);
    await user.click(screen.getByRole("button", { name: /create workflow/i }));
    await user.type(screen.getByLabelText(/workflow name/i), "x");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/required/i);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("uses a generic message for non-WorkflowApiError failures", async () => {
    mockCreateWorkflow.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<CreateWorkflowButton />);
    await user.click(screen.getByRole("button", { name: /create workflow/i }));
    await user.type(screen.getByLabelText(/workflow name/i), "x");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /failed to create/i,
    );
  });

  it("Cancel button collapses the form without calling the API", async () => {
    const user = userEvent.setup();
    render(<CreateWorkflowButton />);
    await user.click(screen.getByRole("button", { name: /create workflow/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mockCreateWorkflow).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /create workflow/i }),
    ).toBeInTheDocument();
  });
});
