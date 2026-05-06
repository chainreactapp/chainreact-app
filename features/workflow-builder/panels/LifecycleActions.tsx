"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WorkflowState } from "@/contracts/workflow";
import {
  WorkflowApiError,
  activateWorkflow,
  pauseWorkflow,
  resumeWorkflow,
} from "@/lib/api/workflows";
import { useGraphSlice } from "../state/graphSlice";

interface Props {
  workflowId: string;
  state: WorkflowState;
}

type ActionKind = "activate" | "pause" | "resume";

interface Action {
  kind: ActionKind;
  label: string;
  variant: "primary" | "secondary";
}

function actionsForState(state: WorkflowState): readonly Action[] {
  switch (state) {
    case "draft":
      return [{ kind: "activate", label: "Activate", variant: "primary" }];
    case "active":
      return [{ kind: "pause", label: "Pause", variant: "secondary" }];
    case "paused":
      return [{ kind: "resume", label: "Resume", variant: "primary" }];
    case "eligible_to_resume":
      return [{ kind: "resume", label: "Resume", variant: "primary" }];
    case "disabled":
      // System-disabled workflows surface a reconnect path elsewhere
      // (Slice 1J+ wires that to the integrations page).
      return [];
    case "deleted":
      return [];
  }
}

const ACTION_HANDLERS: Readonly<Record<ActionKind, (id: string) => Promise<unknown>>> = {
  activate: activateWorkflow,
  pause: pauseWorkflow,
  resume: resumeWorkflow,
};

/**
 * Wires the lifecycle action endpoints to the detail-page header.
 *
 * Per workflow-builder-ui.md / project-structure-and-module-boundaries.md §4-5:
 *   - No fetch in components — typed client API only.
 *   - On success the page re-fetches via router.refresh() so the status
 *     badge + the available actions update.
 */
export function LifecycleActions({ workflowId, state }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<ActionKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read dirty state straight from the graph slice — the lifecycle header
  // and the builder share one Zustand store, so no prop threading is needed.
  // Initial render sees isDirty=false (slice INITIAL_STATE); edits flip it.
  const hasUnsavedChanges = useGraphSlice((s) => s.isDirty);

  const actions = actionsForState(state);
  if (actions.length === 0) return null;

  async function run(kind: ActionKind) {
    if (pending !== null) return;
    setPending(kind);
    setError(null);
    try {
      await ACTION_HANDLERS[kind](workflowId);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof WorkflowApiError
          ? err.message
          : `Failed to ${kind} workflow.`;
      setError(message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1" aria-label="Lifecycle actions">
      <div className="flex gap-2">
        {actions.map((action) => {
          const disabled = pending !== null || hasUnsavedChanges;
          const baseClasses =
            "rounded px-3 py-1.5 text-sm font-medium disabled:opacity-60";
          const variantClasses =
            action.variant === "primary"
              ? "bg-primary text-primary-foreground"
              : "border border-input";
          return (
            <button
              key={action.kind}
              type="button"
              onClick={() => run(action.kind)}
              disabled={disabled}
              title={
                hasUnsavedChanges
                  ? "Save your changes before changing lifecycle state."
                  : undefined
              }
              className={`${baseClasses} ${variantClasses}`}
            >
              {pending === action.kind ? `${action.label}…` : action.label}
            </button>
          );
        })}
      </div>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
