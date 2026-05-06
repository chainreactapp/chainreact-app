/**
 * Tests for features/workflows/WorkflowsList.
 *
 * Server component, pure presentational. Uses displayStatus() for the label
 * (verifies the projection wiring rather than re-deriving labels in the UI).
 */
import { render, screen } from "@testing-library/react";
import { WorkflowsList } from "@/features/workflows/WorkflowsList";
import type { WorkflowSummary } from "@/contracts/workflow";

const base: Omit<WorkflowSummary, "id" | "name" | "state"> = {
  disabledReason: null,
  disabledContext: null,
  deletedAt: null,
  createdAt: "2026-05-06T00:00:00Z",
  updatedAt: "2026-05-06T01:00:00Z",
};

describe("WorkflowsList", () => {
  it("renders an empty-state message when the list is empty", () => {
    render(<WorkflowsList workflows={[]} />);
    expect(screen.getByText(/no workflows yet/i)).toBeInTheDocument();
  });

  it("renders a row per workflow with the displayStatus label", () => {
    const workflows: WorkflowSummary[] = [
      { ...base, id: "1", name: "Onboarding", state: "draft" },
      { ...base, id: "2", name: "Daily report", state: "active" },
      {
        ...base,
        id: "3",
        name: "Slack channel rotator",
        state: "disabled",
        disabledReason: "integration_revoked",
      },
      { ...base, id: "4", name: "Holiday alert", state: "eligible_to_resume" },
    ];
    render(<WorkflowsList workflows={workflows} />);

    expect(screen.getByText("Onboarding")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Daily report")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(
      screen.getByText(/disabled — integration disconnected/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ready to resume/i)).toBeInTheDocument();
  });

  it("hides workflows whose displayStatus is null (defense-in-depth for deleted)", () => {
    // The list endpoint already filters deleted; ensure UI doesn't render them
    // even if a stale row reaches it.
    const workflows: WorkflowSummary[] = [
      { ...base, id: "1", name: "Visible", state: "active" },
      { ...base, id: "2", name: "Hidden ghost", state: "deleted" },
    ];
    render(<WorkflowsList workflows={workflows} />);
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("Hidden ghost")).not.toBeInTheDocument();
  });
});
