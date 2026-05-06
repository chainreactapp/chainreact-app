/**
 * @jest-environment node
 *
 * Unit tests for core/workflows/projections.ts.
 *
 * UI consumes only these projections — never raw columns. Per
 * docs/rules/workflow-lifecycle.md §"V2 intended behavior".
 */
import {
  displayStatus,
  isBillable,
  isExecutable,
  type ProjectableWorkflow,
} from "@/core/workflows/projections";
import type { WorkflowState } from "@/contracts/workflow";

function wf(
  state: WorkflowState,
  disabledReason: ProjectableWorkflow["disabledReason"] = null,
): ProjectableWorkflow {
  return { state, disabledReason };
}

describe("isExecutable", () => {
  it("only active workflows are executable (rule §Allowed states table)", () => {
    expect(isExecutable(wf("active"))).toBe(true);
    expect(isExecutable(wf("draft"))).toBe(false);
    expect(isExecutable(wf("paused"))).toBe(false);
    expect(isExecutable(wf("disabled", "integration_revoked"))).toBe(false);
    expect(isExecutable(wf("eligible_to_resume"))).toBe(false);
    expect(isExecutable(wf("deleted"))).toBe(false);
  });
});

describe("isBillable", () => {
  it("only active workflows are billable (rule §Allowed states 'Billable on each run')", () => {
    expect(isBillable(wf("active"))).toBe(true);
    expect(isBillable(wf("paused"))).toBe(false);
    expect(isBillable(wf("disabled", "billing_exhausted"))).toBe(false);
  });
});

describe("displayStatus", () => {
  it("draft -> Draft", () => {
    expect(displayStatus(wf("draft"))).toEqual({ kind: "draft", label: "Draft" });
  });

  it("active -> Active", () => {
    expect(displayStatus(wf("active"))).toEqual({ kind: "active", label: "Active" });
  });

  it("paused -> Paused", () => {
    expect(displayStatus(wf("paused"))).toEqual({ kind: "paused", label: "Paused" });
  });

  it("eligible_to_resume -> Ready to resume (rule §Allowed states UI label)", () => {
    expect(displayStatus(wf("eligible_to_resume"))).toEqual({
      kind: "eligible_to_resume",
      label: "Ready to resume",
    });
  });

  it("disabled with reason renders the typed-reason label", () => {
    const result = displayStatus(wf("disabled", "integration_revoked"));
    expect(result).toEqual({
      kind: "disabled",
      label: "Disabled — Integration disconnected",
      reason: "integration_revoked",
    });
  });

  it.each([
    ["billing_exhausted", "Disabled — Billing exhausted"],
    ["repeated_failure", "Disabled — Repeated failures"],
    ["manual_admin", "Disabled — Disabled by admin"],
  ] as const)("disabled reason '%s' -> '%s'", (reason, expectedLabel) => {
    const result = displayStatus(wf("disabled", reason));
    expect(result?.label).toBe(expectedLabel);
    expect(result?.reason).toBe(reason);
  });

  it("deleted -> null (hidden from UI list, rule §Allowed states)", () => {
    expect(displayStatus(wf("deleted"))).toBeNull();
  });
});
