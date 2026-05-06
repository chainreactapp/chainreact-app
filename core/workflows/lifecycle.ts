import type {
  WorkflowState,
  WorkflowDisabledReason,
} from "@/contracts/workflow";

/**
 * Pure workflow lifecycle state machine.
 *
 * Per docs/rules/workflow-lifecycle.md (Resolved Decisions):
 *   - Six states: draft, active, paused, disabled, eligible_to_resume, deleted.
 *   - Single state machine; transitions go through one orchestrator
 *     (services/workflows/lifecycleOrchestrator.ts).
 *   - draft -> disabled is explicitly disallowed (drafts have no trigger
 *     registration; nothing to disable).
 *   - disabled -> active directly is disallowed; must transit
 *     eligible_to_resume so the user explicitly resumes.
 *   - deleted is terminal from the product UI.
 *
 * This module is deliberately I/O-free. The cascade predicates
 * (selectWorkflowsToDisable, selectWorkflowsEligibleToResume) consume a
 * pre-computed dependency view supplied by the service layer; integration
 * dependency lookup itself lives in services/workflows/ once the workflow
 * definition is formalized (Slice 1I+).
 */

export type LifecycleTransition =
  | "activate"
  | "pause"
  | "resume"
  | "disable"
  | "markEligibleToResume"
  | "delete";

export type LifecycleErrorCode =
  | "INVALID_TRANSITION"
  | "MISSING_PRECONDITIONS"
  | "TRIGGER_REGISTRATION_FAILED"
  | "LIFECYCLE_CONFLICT"
  | "WORKFLOW_NOT_FOUND";

export class LifecycleError extends Error {
  readonly code: LifecycleErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(
    code: LifecycleErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
    this.details = details;
  }
}

// Source of truth for the transition table. Each tuple = (from, transition, to).
// Listed in the order documented in the rule doc's transition diagram so the
// shape can be diff-reviewed against the rule.
const TRANSITIONS: ReadonlyArray<
  readonly [WorkflowState, LifecycleTransition, WorkflowState]
> = [
  ["draft", "activate", "active"],
  ["draft", "delete", "deleted"],
  ["active", "pause", "paused"],
  ["active", "disable", "disabled"],
  ["active", "delete", "deleted"],
  ["paused", "resume", "active"],
  ["paused", "disable", "disabled"],
  ["paused", "delete", "deleted"],
  ["disabled", "markEligibleToResume", "eligible_to_resume"],
  ["disabled", "delete", "deleted"],
  ["eligible_to_resume", "resume", "active"],
  ["eligible_to_resume", "disable", "disabled"],
  ["eligible_to_resume", "delete", "deleted"],
];

const TRANSITION_MAP: ReadonlyMap<string, WorkflowState> = (() => {
  const m = new Map<string, WorkflowState>();
  for (const [from, t, to] of TRANSITIONS) m.set(`${from}:${t}`, to);
  return m;
})();

export function getNextState(
  from: WorkflowState,
  transition: LifecycleTransition,
): WorkflowState | null {
  return TRANSITION_MAP.get(`${from}:${transition}`) ?? null;
}

/**
 * Throws LifecycleError('INVALID_TRANSITION') when the transition is not
 * allowed from the given state. Returns the resulting state otherwise.
 */
export function assertAllowedTransition(
  from: WorkflowState,
  transition: LifecycleTransition,
): WorkflowState {
  const next = getNextState(from, transition);
  if (next === null) {
    throw new LifecycleError(
      "INVALID_TRANSITION",
      `Workflow in state '${from}' cannot '${transition}'.`,
      { from, transition },
    );
  }
  return next;
}

// ── Multi-integration cascade predicates ─────────────────────────────────────

/**
 * Minimal view of a workflow needed by the cascade predicates. Pure data;
 * the service layer assembles this from the workflow definition + integrations
 * repository.
 */
export interface WorkflowDependencyView {
  workflowId: string;
  state: WorkflowState;
  /**
   * Identifiers of integrations the workflow's nodes require. The shape is
   * opaque to lifecycle.ts (commonly `<provider>:<accountId>` or the
   * integrations.id uuid). Comparison is set membership only.
   */
  requiredIntegrationIds: ReadonlySet<string>;
}

/**
 * Per rule §"Multi-integration disable cascade":
 *   - Disable only workflows that depend on the affected integration.
 *   - Active and paused workflows are subject to disable (paused retains
 *     trigger registration but a future un-pause must respect dep health).
 *   - draft workflows have no trigger; disabled / eligible_to_resume are
 *     already not running. Re-disabling them with a new reason belongs to
 *     a separate orchestrator call (eligible_to_resume -> disabled is
 *     allowed by the transition table).
 */
export function selectWorkflowsToDisable(
  workflows: ReadonlyArray<WorkflowDependencyView>,
  unhealthyIntegrationIds: ReadonlySet<string>,
): readonly string[] {
  if (unhealthyIntegrationIds.size === 0) return [];
  const result: string[] = [];
  for (const wf of workflows) {
    if (wf.state !== "active" && wf.state !== "paused") continue;
    for (const reqId of wf.requiredIntegrationIds) {
      if (unhealthyIntegrationIds.has(reqId)) {
        result.push(wf.workflowId);
        break;
      }
    }
  }
  return result;
}

/**
 * Per rule §"Multi-integration disable cascade":
 *   - Only `disabled` workflows are candidates.
 *   - A workflow becomes eligible only when ALL required integrations are
 *     currently healthy.
 *   - Never auto-resumes; the orchestrator transitions to
 *     `eligible_to_resume` and the user must explicitly resume.
 */
export function selectWorkflowsEligibleToResume(
  workflows: ReadonlyArray<WorkflowDependencyView>,
  healthyIntegrationIds: ReadonlySet<string>,
): readonly string[] {
  const result: string[] = [];
  for (const wf of workflows) {
    if (wf.state !== "disabled") continue;
    let allHealthy = true;
    for (const reqId of wf.requiredIntegrationIds) {
      if (!healthyIntegrationIds.has(reqId)) {
        allHealthy = false;
        break;
      }
    }
    if (allHealthy) result.push(wf.workflowId);
  }
  return result;
}

// Re-export the persisted enums so consumers of lifecycle.ts don't need to
// import from two places.
export type { WorkflowState, WorkflowDisabledReason };
