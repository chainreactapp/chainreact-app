/**
 * @jest-environment node
 *
 * Unit tests for core/workflows/lifecycle.ts.
 *
 * The transition table here mirrors the table in
 * docs/rules/workflow-lifecycle.md §"Allowed transitions". Tests cite the
 * rule by name. If the rule changes, BOTH the table below and the rule doc
 * must change in the same PR.
 */
import {
  LifecycleError,
  assertAllowedTransition,
  getNextState,
  selectWorkflowsEligibleToResume,
  selectWorkflowsToDisable,
  type LifecycleTransition,
  type WorkflowDependencyView,
} from "@/core/workflows/lifecycle";
import type { WorkflowState } from "@/contracts/workflow";

// Source-of-truth transition matrix. Each row is (from, transition, expected).
// `null` means "must reject as INVALID_TRANSITION."
type Row = readonly [WorkflowState, LifecycleTransition, WorkflowState | null];

const ALLOWED: ReadonlyArray<Row> = [
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

// Disallowed combinations the rule explicitly calls out, plus all
// other (from, transition) pairs not in ALLOWED.
const ALL_TRANSITIONS: ReadonlyArray<LifecycleTransition> = [
  "activate",
  "pause",
  "resume",
  "disable",
  "markEligibleToResume",
  "delete",
];
const ALL_STATES: ReadonlyArray<WorkflowState> = [
  "draft",
  "active",
  "paused",
  "disabled",
  "eligible_to_resume",
  "deleted",
];

describe("getNextState (rule §Allowed transitions table)", () => {
  it.each(ALLOWED)(
    "%s -> %s -> %s",
    (from, transition, expected) => {
      expect(getNextState(from, transition)).toBe(expected);
    },
  );

  it("rule §Disallowed: draft -> disable returns null", () => {
    expect(getNextState("draft", "disable")).toBeNull();
  });

  it("rule §Disallowed: disabled -> activate (must go via eligible_to_resume) returns null", () => {
    expect(getNextState("disabled", "activate")).toBeNull();
  });

  it("rule §Allowed: deleted is terminal — every transition returns null", () => {
    for (const t of ALL_TRANSITIONS) {
      expect(getNextState("deleted", t)).toBeNull();
    }
  });

  it("every (state, transition) NOT in the allow list returns null", () => {
    const allowedKey = new Set(ALLOWED.map(([f, t]) => `${f}:${t}`));
    for (const from of ALL_STATES) {
      for (const t of ALL_TRANSITIONS) {
        if (allowedKey.has(`${from}:${t}`)) continue;
        expect(getNextState(from, t)).toBeNull();
      }
    }
  });
});

describe("assertAllowedTransition", () => {
  it("returns the next state for an allowed transition", () => {
    expect(assertAllowedTransition("draft", "activate")).toBe("active");
  });

  it("throws LifecycleError('INVALID_TRANSITION') for a disallowed transition", () => {
    expect(() => assertAllowedTransition("disabled", "activate"))
      .toThrow(LifecycleError);
    try {
      assertAllowedTransition("disabled", "activate");
    } catch (e) {
      expect((e as LifecycleError).code).toBe("INVALID_TRANSITION");
      expect((e as LifecycleError).details).toMatchObject({
        from: "disabled",
        transition: "activate",
      });
    }
  });
});

describe("selectWorkflowsToDisable (rule §Multi-integration disable cascade)", () => {
  function wf(
    workflowId: string,
    state: WorkflowState,
    deps: readonly string[],
  ): WorkflowDependencyView {
    return {
      workflowId,
      state,
      requiredIntegrationIds: new Set(deps),
    };
  }

  it("disables only workflows that depend on a broken integration", () => {
    const workflows = [
      wf("a", "active", ["slack-1", "gmail-1"]),
      wf("b", "active", ["notion-1"]),
      wf("c", "paused", ["gmail-1"]),
    ];
    expect(
      selectWorkflowsToDisable(workflows, new Set(["gmail-1"])),
    ).toEqual(["a", "c"]);
  });

  it("never disables draft / disabled / eligible_to_resume / deleted (only active+paused)", () => {
    const workflows = [
      wf("draft", "draft", ["x"]),
      wf("dis", "disabled", ["x"]),
      wf("elig", "eligible_to_resume", ["x"]),
      wf("del", "deleted", ["x"]),
      wf("act", "active", ["x"]),
    ];
    expect(selectWorkflowsToDisable(workflows, new Set(["x"]))).toEqual(["act"]);
  });

  it("returns empty when no integrations are unhealthy", () => {
    const workflows = [wf("a", "active", ["slack-1"])];
    expect(selectWorkflowsToDisable(workflows, new Set())).toEqual([]);
  });

  it("rule example: Slack trigger + Gmail action; unrelated Notion disconnects -> active stays active", () => {
    const workflows = [wf("a", "active", ["slack-1", "gmail-1"])];
    expect(
      selectWorkflowsToDisable(workflows, new Set(["notion-1"])),
    ).toEqual([]);
  });
});

describe("selectWorkflowsEligibleToResume (rule §Multi-integration disable cascade)", () => {
  function wf(
    workflowId: string,
    state: WorkflowState,
    deps: readonly string[],
  ): WorkflowDependencyView {
    return {
      workflowId,
      state,
      requiredIntegrationIds: new Set(deps),
    };
  }

  it("elevates disabled workflows whose ALL deps are now healthy", () => {
    const workflows = [
      wf("a", "disabled", ["slack-1", "gmail-1"]),
      wf("b", "disabled", ["gmail-1"]),
    ];
    expect(
      selectWorkflowsEligibleToResume(
        workflows,
        new Set(["slack-1", "gmail-1"]),
      ),
    ).toEqual(["a", "b"]);
  });

  it("rule example case 'd': Gmail reconnects but Slack is now disconnected — workflow stays disabled", () => {
    const workflows = [wf("a", "disabled", ["slack-1", "gmail-1"])];
    expect(
      selectWorkflowsEligibleToResume(workflows, new Set(["gmail-1"])),
    ).toEqual([]);
  });

  it("ignores active / paused / draft / eligible_to_resume / deleted", () => {
    const workflows = [
      wf("act", "active", ["x"]),
      wf("paus", "paused", ["x"]),
      wf("draft", "draft", ["x"]),
      wf("elig", "eligible_to_resume", ["x"]),
      wf("del", "deleted", ["x"]),
      wf("dis", "disabled", ["x"]),
    ];
    expect(
      selectWorkflowsEligibleToResume(workflows, new Set(["x"])),
    ).toEqual(["dis"]);
  });

  it("a disabled workflow with no required integrations is eligible (vacuously all healthy)", () => {
    const workflows = [wf("a", "disabled", [])];
    expect(selectWorkflowsEligibleToResume(workflows, new Set())).toEqual(["a"]);
  });
});
