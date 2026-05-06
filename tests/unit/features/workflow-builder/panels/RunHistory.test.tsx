/**
 * Tests for features/workflow-builder/panels/RunHistory.
 *
 * Pure presentational component. Verifies empty-state, success row,
 * failed row + humanized error block, severity → role mapping, and
 * duration formatting edge cases.
 */
import { render, screen, within } from "@testing-library/react";
import { RunHistory } from "@/features/workflow-builder/panels/RunHistory";
import type { WorkflowRunSummary } from "@/contracts/workflow";

function run(overrides: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    workflowId: "22222222-2222-2222-2222-222222222222",
    status: "succeeded",
    triggerNodeId: "t1",
    startedAt: "2026-05-07T00:00:00Z",
    finishedAt: "2026-05-07T00:00:01Z",
    errorClassification: null,
    ...overrides,
  };
}

describe("RunHistory — empty state", () => {
  it("renders an empty-state hint when no runs exist", () => {
    render(<RunHistory runs={[]} />);
    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument();
  });
});

describe("RunHistory — success rows", () => {
  it("renders a row per succeeded run with a green-toned status badge", () => {
    render(<RunHistory runs={[run(), run({ id: "33333333-3333-3333-3333-333333333333" })]} />);
    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      expect(row).toHaveAttribute("data-status", "succeeded");
      expect(within(row).getByText(/succeeded/i)).toBeInTheDocument();
    });
  });

  it("does not render an error block on succeeded runs", () => {
    render(<RunHistory runs={[run()]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("RunHistory — failed rows + humanized error", () => {
  const failed = run({
    id: "44444444-4444-4444-4444-444444444444",
    status: "failed",
    errorClassification: {
      title: "Slack channel not found",
      description: "Slack couldn't find the channel id.",
      hint: "Double-check the channel id.",
      action: "open_node",
      severity: "error",
    },
  });

  it("shows the humanized title + description + hint", () => {
    render(<RunHistory runs={[failed]} />);
    expect(screen.getByText("Slack channel not found")).toBeInTheDocument();
    expect(screen.getByText(/couldn't find the channel id/i)).toBeInTheDocument();
    expect(screen.getByText(/double-check the channel id/i)).toBeInTheDocument();
  });

  it("error severity → role='alert' (assistive-tech surfaces the failure)", () => {
    render(<RunHistory runs={[failed]} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("warning severity → role='status' (less urgent)", () => {
    const warning = run({
      ...failed,
      errorClassification: {
        ...failed.errorClassification!,
        severity: "warning",
      },
    });
    render(<RunHistory runs={[warning]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("does not render the hint when none is provided", () => {
    const noHint = run({
      ...failed,
      errorClassification: {
        ...failed.errorClassification!,
        hint: undefined,
      },
    });
    render(<RunHistory runs={[noHint]} />);
    expect(screen.queryByText(/hint:/i)).not.toBeInTheDocument();
  });

  it("does not render the error block when classification is null even on a failed run", () => {
    // Defense in depth — should be rare since the engine always classifies failures.
    const failedNoClassification = run({
      ...failed,
      errorClassification: null,
    });
    render(<RunHistory runs={[failedNoClassification]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Still shows the failed badge though.
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });
});

describe("RunHistory — duration label", () => {
  it("formats sub-second durations in ms", () => {
    render(
      <RunHistory
        runs={[
          run({
            startedAt: "2026-05-07T00:00:00.000Z",
            finishedAt: "2026-05-07T00:00:00.250Z",
          }),
        ]}
      />,
    );
    expect(screen.getByText(/250ms/)).toBeInTheDocument();
  });

  it("formats sub-minute durations in seconds", () => {
    render(
      <RunHistory
        runs={[
          run({
            startedAt: "2026-05-07T00:00:00Z",
            finishedAt: "2026-05-07T00:00:03Z",
          }),
        ]}
      />,
    );
    expect(screen.getByText(/3\.0s/)).toBeInTheDocument();
  });

  it("formats minute+ durations as Nm Ss", () => {
    render(
      <RunHistory
        runs={[
          run({
            startedAt: "2026-05-07T00:00:00Z",
            finishedAt: "2026-05-07T00:02:15Z",
          }),
        ]}
      />,
    );
    expect(screen.getByText(/2m 15s/)).toBeInTheDocument();
  });
});
