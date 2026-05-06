/**
 * Tests for features/workflow-builder/panels/LifecycleActions.
 *
 * Verifies the per-state action set, the "save first" gating via the graph
 * slice's isDirty, and the typed-client wiring for activate / pause / resume.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockActivate = jest.fn();
const mockPause = jest.fn();
const mockResume = jest.fn();
const mockRefresh = jest.fn();

jest.mock("@/lib/api/workflows", () => {
  const actual = jest.requireActual("@/lib/api/workflows");
  return {
    ...actual,
    activateWorkflow: (...args: unknown[]) => mockActivate(...args),
    pauseWorkflow: (...args: unknown[]) => mockPause(...args),
    resumeWorkflow: (...args: unknown[]) => mockResume(...args),
  };
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { LifecycleActions } from "@/features/workflow-builder/panels/LifecycleActions";
import { useGraphSlice } from "@/features/workflow-builder/state/graphSlice";
import { WorkflowApiError } from "@/lib/api/workflows";

beforeEach(() => {
  mockActivate.mockReset();
  mockPause.mockReset();
  mockResume.mockReset();
  mockRefresh.mockReset();
  useGraphSlice.getState().reset();
  useGraphSlice.getState().hydrate("wf-1", { nodes: [], edges: [] });
});

describe("LifecycleActions — per-state action set", () => {
  it("shows Activate when state is draft", () => {
    render(<LifecycleActions workflowId="wf-1" state="draft" />);
    expect(screen.getByRole("button", { name: /activate/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pause|resume/i })).toBeNull();
  });

  it("shows Pause when state is active", () => {
    render(<LifecycleActions workflowId="wf-1" state="active" />);
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
  });

  it("shows Resume when state is paused", () => {
    render(<LifecycleActions workflowId="wf-1" state="paused" />);
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("shows Resume when state is eligible_to_resume", () => {
    render(<LifecycleActions workflowId="wf-1" state="eligible_to_resume" />);
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("renders nothing when state is disabled (system-controlled)", () => {
    const { container } = render(
      <LifecycleActions workflowId="wf-1" state="disabled" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LifecycleActions — interactions", () => {
  it("disables the action while builder has unsaved changes", async () => {
    useGraphSlice.getState().addTrigger({ provider: "slack" });
    render(<LifecycleActions workflowId="wf-1" state="draft" />);
    const btn = screen.getByRole("button", { name: /activate/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringMatching(/save your changes/i));
  });

  it("calls activateWorkflow and refreshes the route on success", async () => {
    mockActivate.mockResolvedValueOnce({ id: "wf-1", state: "active" });
    const user = userEvent.setup();
    render(<LifecycleActions workflowId="wf-1" state="draft" />);
    await user.click(screen.getByRole("button", { name: /activate/i }));
    await waitFor(() => {
      expect(mockActivate).toHaveBeenCalledWith("wf-1");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("calls pauseWorkflow when active", async () => {
    mockPause.mockResolvedValueOnce({ id: "wf-1", state: "paused" });
    const user = userEvent.setup();
    render(<LifecycleActions workflowId="wf-1" state="active" />);
    await user.click(screen.getByRole("button", { name: /pause/i }));
    await waitFor(() => {
      expect(mockPause).toHaveBeenCalledWith("wf-1");
    });
  });

  it("surfaces a WorkflowApiError message inline; does NOT refresh", async () => {
    mockActivate.mockRejectedValueOnce(
      new WorkflowApiError("Slack disconnected.", "MISSING_PRECONDITIONS", 422),
    );
    const user = userEvent.setup();
    render(<LifecycleActions workflowId="wf-1" state="draft" />);
    await user.click(screen.getByRole("button", { name: /activate/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/slack disconnected/i);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
