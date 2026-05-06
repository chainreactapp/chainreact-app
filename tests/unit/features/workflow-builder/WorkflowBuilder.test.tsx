/**
 * Tests for features/workflow-builder/WorkflowBuilder.
 *
 * Integration-flavored: render the shell with the real graph slice and the
 * mocked typed client. Verify hydration, the add → save round-trip, and the
 * dirty / saved indicator.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUpdateWorkflow = jest.fn();
jest.mock("@/lib/api/workflows", () => {
  const actual = jest.requireActual("@/lib/api/workflows");
  return {
    ...actual,
    updateWorkflow: (...args: unknown[]) => mockUpdateWorkflow(...args),
  };
});

import { WorkflowBuilder } from "@/features/workflow-builder/WorkflowBuilder";
import { useGraphSlice } from "@/features/workflow-builder/state/graphSlice";
import type { WorkflowDetail } from "@/contracts/workflow";

const baseWorkflow: WorkflowDetail = {
  id: "wf-1",
  name: "Test",
  state: "draft",
  disabledReason: null,
  disabledContext: null,
  activeRevisionId: null,
  draftDefinition: { nodes: [], edges: [] },
  deletedAt: null,
  createdAt: "2026-05-06T00:00:00Z",
  updatedAt: "2026-05-06T00:00:00Z",
};

const triggerProviders = [{ id: "slack", displayName: "Slack" }];
const actionProviders = [{ id: "slack", displayName: "Slack" }];

beforeEach(() => {
  mockUpdateWorkflow.mockReset();
  useGraphSlice.getState().reset();
});

describe("WorkflowBuilder", () => {
  it("hydrates the slice on mount and shows the empty-state when no nodes", () => {
    render(
      <WorkflowBuilder
        workflow={baseWorkflow}
        triggerProviders={triggerProviders}
        actionProviders={actionProviders}
      />,
    );
    expect(useGraphSlice.getState().workflowId).toBe("wf-1");
    expect(useGraphSlice.getState().isHydrated).toBe(true);
    expect(screen.getByText(/empty workflow/i)).toBeInTheDocument();
  });

  it("Save is disabled when the slice is clean; enables once the user edits", async () => {
    const user = userEvent.setup();
    render(
      <WorkflowBuilder
        workflow={baseWorkflow}
        triggerProviders={triggerProviders}
        actionProviders={actionProviders}
      />,
    );
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /add trigger/i }));
    await user.click(screen.getByRole("button", { name: /^Slack$/ }));
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it("Save dispatches updateWorkflow with the pending definition and shows 'Saved.'", async () => {
    mockUpdateWorkflow.mockImplementation(async (_id, body) => ({
      ...baseWorkflow,
      draftDefinition: body.draftDefinition,
    }));
    const user = userEvent.setup();
    render(
      <WorkflowBuilder
        workflow={baseWorkflow}
        triggerProviders={triggerProviders}
        actionProviders={actionProviders}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add trigger/i }));
    await user.click(screen.getByRole("button", { name: /^Slack$/ }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdateWorkflow).toHaveBeenCalledWith(
        "wf-1",
        expect.objectContaining({
          draftDefinition: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({ kind: "trigger", provider: "slack" }),
            ]),
          }),
        }),
      );
    });
    expect(await screen.findByText(/saved\./i)).toBeInTheDocument();
    expect(useGraphSlice.getState().isDirty).toBe(false);
  });

  it("surfaces a save error inline and keeps pending edits", async () => {
    mockUpdateWorkflow.mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();
    render(
      <WorkflowBuilder
        workflow={baseWorkflow}
        triggerProviders={triggerProviders}
        actionProviders={actionProviders}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add trigger/i }));
    await user.click(screen.getByRole("button", { name: /^Slack$/ }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to save/i);
    expect(useGraphSlice.getState().isDirty).toBe(true);
    expect(useGraphSlice.getState().pendingNodes).toHaveLength(1);
  });

  it("resets the slice on unmount so a stale graph never leaks into the next workflow", () => {
    const { unmount } = render(
      <WorkflowBuilder
        workflow={baseWorkflow}
        triggerProviders={triggerProviders}
        actionProviders={actionProviders}
      />,
    );
    useGraphSlice.getState().addTrigger({ provider: "slack" });
    unmount();
    const s = useGraphSlice.getState();
    expect(s.workflowId).toBeNull();
    expect(s.pendingNodes).toEqual([]);
    expect(s.isHydrated).toBe(false);
  });
});
