/**
 * Tests for features/workflow-builder/panels/AddNodeMenu.
 *
 * The picker reads the slice for hasTrigger and dispatches addTrigger /
 * addAction. Tests use the real slice (no mock) so the component's
 * interaction with state is exercised end-to-end.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AddNodeMenu } from "@/features/workflow-builder/panels/AddNodeMenu";
import { useGraphSlice } from "@/features/workflow-builder/state/graphSlice";

const triggerProviders = [{ id: "slack", displayName: "Slack" }];
const actionProviders = [
  { id: "slack", displayName: "Slack" },
  { id: "gmail", displayName: "Gmail" },
];

beforeEach(() => {
  useGraphSlice.getState().reset();
  useGraphSlice.getState().hydrate("wf-1", { nodes: [], edges: [] });
});

describe("AddNodeMenu", () => {
  it("disables 'Add action' until a trigger exists", () => {
    render(
      <AddNodeMenu
        triggerProviders={triggerProviders}
        actionProviders={actionProviders}
      />,
    );
    expect(screen.getByRole("button", { name: /add action/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /add trigger/i })).toBeEnabled();
  });

  it("opens the trigger provider list and dispatches addTrigger on pick", async () => {
    const user = userEvent.setup();
    render(
      <AddNodeMenu
        triggerProviders={triggerProviders}
        actionProviders={actionProviders}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add trigger/i }));
    const triggerList = screen.getByRole("list", { name: /trigger providers/i });
    await user.click(
      screen.getByRole("button", { name: /^Slack$/ }),
    );
    expect(triggerList).not.toBeInTheDocument();
    const nodes = useGraphSlice.getState().pendingNodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "trigger", provider: "slack" });
  });

  it("after a trigger is added, 'Add trigger' is disabled and 'Add action' is enabled", async () => {
    useGraphSlice.getState().addTrigger({ provider: "slack" });
    render(
      <AddNodeMenu
        triggerProviders={triggerProviders}
        actionProviders={actionProviders}
      />,
    );
    expect(screen.getByRole("button", { name: /add trigger/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /add action/i })).toBeEnabled();
  });

  it("dispatches addAction with the picked provider", async () => {
    useGraphSlice.getState().addTrigger({ provider: "slack" });
    const user = userEvent.setup();
    render(
      <AddNodeMenu
        triggerProviders={triggerProviders}
        actionProviders={actionProviders}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add action/i }));
    await user.click(screen.getByRole("button", { name: /^Gmail$/ }));
    const nodes = useGraphSlice.getState().pendingNodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[1]).toMatchObject({ kind: "action", provider: "gmail" });
  });

  it("renders an empty-state message when no providers are available", async () => {
    const user = userEvent.setup();
    render(<AddNodeMenu triggerProviders={[]} actionProviders={actionProviders} />);
    await user.click(screen.getByRole("button", { name: /add trigger/i }));
    expect(screen.getByText(/no trigger providers/i)).toBeInTheDocument();
  });
});
