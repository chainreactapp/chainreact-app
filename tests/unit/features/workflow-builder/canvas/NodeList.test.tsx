/**
 * Tests for features/workflow-builder/canvas/NodeList.
 *
 * Pure read of pendingNodes from the slice + Remove dispatches removeNode.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NodeList } from "@/features/workflow-builder/canvas/NodeList";
import { useGraphSlice } from "@/features/workflow-builder/state/graphSlice";

const PROVIDER_LABELS = { slack: "Slack", gmail: "Gmail" };

beforeEach(() => {
  useGraphSlice.getState().reset();
});

describe("NodeList", () => {
  it("renders an empty-state hint when the slice has no nodes", () => {
    useGraphSlice.getState().hydrate("wf-1", { nodes: [], edges: [] });
    render(<NodeList providerLabels={PROVIDER_LABELS} />);
    expect(screen.getByText(/empty workflow/i)).toBeInTheDocument();
  });

  it("renders one row per node with the provider label and kind", () => {
    useGraphSlice.getState().hydrate("wf-1", { nodes: [], edges: [] });
    useGraphSlice.getState().addTrigger({ provider: "slack" });
    useGraphSlice.getState().addAction({ provider: "gmail" });
    render(<NodeList providerLabels={PROVIDER_LABELS} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/trigger/i);
    expect(items[0]).toHaveTextContent("Slack");
    expect(items[1]).toHaveTextContent(/action/i);
    expect(items[1]).toHaveTextContent("Gmail");
  });

  it("falls back to the raw provider id when the label map is missing the entry", () => {
    useGraphSlice.getState().hydrate("wf-1", { nodes: [], edges: [] });
    useGraphSlice.getState().addTrigger({ provider: "unknown-provider" });
    render(<NodeList providerLabels={PROVIDER_LABELS} />);
    expect(screen.getByText("unknown-provider")).toBeInTheDocument();
  });

  it("Remove dispatches removeNode on the slice", async () => {
    useGraphSlice.getState().hydrate("wf-1", { nodes: [], edges: [] });
    const trigger = useGraphSlice.getState().addTrigger({ provider: "slack" });
    const user = userEvent.setup();
    render(<NodeList providerLabels={PROVIDER_LABELS} />);
    await user.click(screen.getByRole("button", { name: /remove trigger node/i }));
    expect(
      useGraphSlice.getState().pendingNodes.find((n) => n.id === trigger.id),
    ).toBeUndefined();
  });

  it("renders '(unconfigured)' when node type is empty (1I.2 default)", () => {
    useGraphSlice.getState().hydrate("wf-1", { nodes: [], edges: [] });
    useGraphSlice.getState().addTrigger({ provider: "slack" });
    render(<NodeList providerLabels={PROVIDER_LABELS} />);
    expect(screen.getByText("(unconfigured)")).toBeInTheDocument();
  });
});
