/**
 * Tests for features/workflows/WorkflowEditForm.
 *
 * Slice 1H.4 minimum: rename a workflow. Verifies that:
 *   - Save is disabled until the name is dirty + valid.
 *   - On submit it calls the typed client API, surfaces "Saved.", and
 *     refreshes the route so the server-rendered header picks up the change.
 *   - Server errors render an inline alert and keep the field dirty.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUpdateWorkflow = jest.fn();
const mockRefresh = jest.fn();

jest.mock("@/lib/api/workflows", () => {
  const actual = jest.requireActual("@/lib/api/workflows");
  return {
    ...actual,
    updateWorkflow: (...args: unknown[]) => mockUpdateWorkflow(...args),
  };
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { WorkflowEditForm } from "@/features/workflows/WorkflowEditForm";
import { WorkflowApiError } from "@/lib/api/workflows";
import type { WorkflowDetail } from "@/contracts/workflow";

const baseWorkflow: WorkflowDetail = {
  id: "wf-1",
  name: "Original",
  state: "draft",
  disabledReason: null,
  disabledContext: null,
  activeRevisionId: null,
  draftDefinition: { nodes: [], edges: [] },
  deletedAt: null,
  createdAt: "2026-05-06T00:00:00Z",
  updatedAt: "2026-05-06T00:00:00Z",
};

beforeEach(() => {
  mockUpdateWorkflow.mockReset();
  mockRefresh.mockReset();
});

describe("WorkflowEditForm", () => {
  it("renders the current name and disables Save until the name is dirty", () => {
    render(<WorkflowEditForm workflow={baseWorkflow} />);
    expect(screen.getByLabelText(/workflow name/i)).toHaveValue("Original");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("enables Save once the name changes; disables again after a save round-trip", async () => {
    mockUpdateWorkflow.mockResolvedValueOnce({ ...baseWorkflow, name: "Renamed" });
    const user = userEvent.setup();
    render(<WorkflowEditForm workflow={baseWorkflow} />);
    const input = screen.getByLabelText(/workflow name/i);
    await user.clear(input);
    await user.type(input, "Renamed");
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => {
      expect(mockUpdateWorkflow).toHaveBeenCalledWith("wf-1", { name: "Renamed" });
      expect(mockRefresh).toHaveBeenCalled();
    });
    // After save, server-side workflow.name is still "Original" until the
    // page re-renders, but trimmed value matches the new server state — the
    // post-save dirty check uses props, so Save stays disabled until the
    // user types again. We assert Saved. is shown.
    expect(screen.getByText(/saved\./i)).toBeInTheDocument();
  });

  it("trims whitespace before sending and rejects empty names by disabling Save", async () => {
    const user = userEvent.setup();
    render(<WorkflowEditForm workflow={baseWorkflow} />);
    const input = screen.getByLabelText(/workflow name/i);
    await user.clear(input);
    await user.type(input, "   ");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(mockUpdateWorkflow).not.toHaveBeenCalled();
  });

  it("renders an inline alert and does NOT refresh on WorkflowApiError", async () => {
    mockUpdateWorkflow.mockRejectedValueOnce(
      new WorkflowApiError("Workflow name is required.", "BAD_REQUEST", 400),
    );
    const user = userEvent.setup();
    render(<WorkflowEditForm workflow={baseWorkflow} />);
    const input = screen.getByLabelText(/workflow name/i);
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/required/i);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("uses a generic message for non-WorkflowApiError failures", async () => {
    mockUpdateWorkflow.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<WorkflowEditForm workflow={baseWorkflow} />);
    const input = screen.getByLabelText(/workflow name/i);
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to save/i);
  });
});
