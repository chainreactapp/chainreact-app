"use client";

import { useEffect, useState } from "react";
import type { WorkflowDetail } from "@/contracts/workflow";
import { NodeList } from "./canvas/NodeList";
import { AddNodeMenu, type ProviderOption } from "./panels/AddNodeMenu";
import { useGraphSlice } from "./state/graphSlice";

interface Props {
  workflow: WorkflowDetail;
  triggerProviders: readonly ProviderOption[];
  actionProviders: readonly ProviderOption[];
}

/**
 * Shell that hosts the Slice 1I.2 minimum builder: a vertical node list,
 * the add-trigger / add-action picker, and a Save button.
 *
 * Hydration: on mount (and whenever the workflowId prop changes — e.g. user
 * navigates from one workflow to another via the in-app router), the slice
 * is hydrated from the server-fetched WorkflowDetail. On unmount the slice
 * resets so a stale graph never leaks into the next workflow open.
 *
 * Per workflow-state-store.md: the slice is the single source of truth.
 * Components read via selectors and dispatch via slice actions. No fetch
 * here; save() lives in the slice.
 */
export function WorkflowBuilder({
  workflow,
  triggerProviders,
  actionProviders,
}: Props) {
  const hydrate = useGraphSlice((s) => s.hydrate);
  const reset = useGraphSlice((s) => s.reset);
  const isDirty = useGraphSlice((s) => s.isDirty);
  const isSaving = useGraphSlice((s) => s.isSaving);
  const saveError = useGraphSlice((s) => s.saveError);
  const save = useGraphSlice((s) => s.save);

  // Re-hydrate on workflow change (or initial mount).
  useEffect(() => {
    hydrate(workflow.id, workflow.draftDefinition);
    return () => {
      reset();
    };
  }, [workflow.id, workflow.draftDefinition, hydrate, reset]);

  const providerLabels = buildProviderLabelMap(triggerProviders, actionProviders);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function handleSave() {
    try {
      await save();
      setSavedAt(Date.now());
    } catch {
      // Error already captured into slice.saveError; no extra UI work here.
    }
  }

  return (
    <div className="flex flex-col gap-4" aria-label="Workflow builder">
      <AddNodeMenu
        triggerProviders={triggerProviders}
        actionProviders={actionProviders}
      />
      <NodeList providerLabels={providerLabels} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
        {!isDirty && savedAt !== null && !saveError && (
          <span className="text-xs text-muted-foreground">Saved.</span>
        )}
        {isDirty && (
          <span className="text-xs text-muted-foreground">Unsaved changes.</span>
        )}
        {saveError && (
          <span role="alert" className="text-xs text-destructive">
            {saveError}
          </span>
        )}
      </div>
    </div>
  );
}

function buildProviderLabelMap(
  triggers: readonly ProviderOption[],
  actions: readonly ProviderOption[],
): Readonly<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const p of triggers) map[p.id] = p.displayName;
  for (const p of actions) map[p.id] = p.displayName;
  return map;
}
