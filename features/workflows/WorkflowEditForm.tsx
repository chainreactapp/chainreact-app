"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { WorkflowDetail } from "@/contracts/workflow";
import { updateWorkflow, WorkflowApiError } from "@/lib/api/workflows";

interface Props {
  workflow: WorkflowDetail;
}

/**
 * Slice 1H.4 minimum: rename a workflow.
 *
 * The full builder UI is Slice 1I; this form is intentionally just enough to
 * verify the round-trip (create -> route to edit page -> rename -> persist).
 *
 * Per workflow-builder-ui.md:
 *   - No fetch / business logic in components — calls the typed client API.
 *   - On a successful save the page is refreshed so the server-rendered
 *     header reflects the new name on the next load.
 */
export function WorkflowEditForm({ workflow }: Props) {
  const router = useRouter();
  // Track the server-confirmed name locally so the dirty / "Saved." state
  // reflects the latest successful save without waiting for the parent's
  // server-component re-render to flow new props in.
  const [serverName, setServerName] = useState(workflow.name);
  const [name, setName] = useState(workflow.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const trimmed = name.trim();
  const dirty = trimmed !== serverName;
  const valid = trimmed.length > 0 && trimmed.length <= 120;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !dirty || !valid) return;
    setPending(true);
    setError(null);
    try {
      const updated = await updateWorkflow(workflow.id, { name: trimmed });
      setServerName(updated.name);
      setName(updated.name);
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      const message =
        err instanceof WorkflowApiError ? err.message : "Failed to save changes.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded border border-input p-4"
      aria-label="Workflow settings"
    >
      <label htmlFor="workflow-name" className="text-sm font-medium">
        Workflow name
      </label>
      <input
        id="workflow-name"
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (savedAt !== null) setSavedAt(null);
        }}
        maxLength={120}
        disabled={pending}
        className="rounded border border-input px-3 py-2 text-sm"
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      {savedAt !== null && !dirty && !error && (
        <span className="text-xs text-muted-foreground">Saved.</span>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !dirty || !valid}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
