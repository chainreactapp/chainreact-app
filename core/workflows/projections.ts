import type {
  WorkflowState,
  WorkflowDisabledReason,
} from "@/contracts/workflow";

/**
 * Pure projections over workflow state.
 *
 * Per docs/rules/workflow-lifecycle.md §"V2 intended behavior":
 *   - UI never inspects raw state columns.
 *   - Derived flags (executable, billable, displayStatus) are computed here,
 *     not stored alongside state.
 */

export interface ProjectableWorkflow {
  state: WorkflowState;
  disabledReason: WorkflowDisabledReason | null;
}

/**
 * A workflow runs only in `active`. Paused and disabled workflows complete
 * any in-flight runs (per rule §"In-flight runs during pause/disable") but
 * dispatch new runs only in active.
 */
export function isExecutable(wf: ProjectableWorkflow): boolean {
  return wf.state === "active";
}

/**
 * Billing accrues only on dispatched runs. Mirrors `isExecutable` today;
 * kept as a separate projection so a future free-tier / dry-run mode can
 * diverge without re-flowing the rule through every UI consumer.
 */
export function isBillable(wf: ProjectableWorkflow): boolean {
  return wf.state === "active";
}

export type DisplayStatusKind =
  | "draft"
  | "active"
  | "paused"
  | "disabled"
  | "eligible_to_resume";

export interface DisplayStatus {
  kind: DisplayStatusKind;
  label: string;
  /** Present only when kind === 'disabled'. */
  reason?: WorkflowDisabledReason;
}

const DISABLED_REASON_LABEL: Readonly<Record<WorkflowDisabledReason, string>> =
  {
    integration_revoked: "Integration disconnected",
    billing_exhausted: "Billing exhausted",
    repeated_failure: "Repeated failures",
    manual_admin: "Disabled by admin",
  };

/**
 * Returns the user-facing status, or null when the workflow should be hidden
 * from the UI list (deleted). Soft-deleted workflows remain in the database
 * through the 30-day undelete window but are never shown.
 */
export function displayStatus(wf: ProjectableWorkflow): DisplayStatus | null {
  switch (wf.state) {
    case "deleted":
      return null;
    case "draft":
      return { kind: "draft", label: "Draft" };
    case "active":
      return { kind: "active", label: "Active" };
    case "paused":
      return { kind: "paused", label: "Paused" };
    case "eligible_to_resume":
      return { kind: "eligible_to_resume", label: "Ready to resume" };
    case "disabled": {
      // disabledReason can be null on a `disabled` workflow only if a
      // historical row was written outside the orchestrator. The rule
      // requires a typed reason; default to manual_admin so UI never
      // shows an empty disabled label.
      const reason = wf.disabledReason ?? "manual_admin";
      return {
        kind: "disabled",
        label: `Disabled — ${DISABLED_REASON_LABEL[reason]}`,
        reason,
      };
    }
  }
}
