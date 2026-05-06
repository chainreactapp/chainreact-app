"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createWorkflow, WorkflowApiError } from "@/lib/api/workflows";

/**
 * Creates a new draft workflow.
 *
 * Per workflow-builder-ui.md / project-structure-and-module-boundaries.md §4-5:
 *   - Component never calls fetch directly; uses the typed client API.
 *   - On success it triggers `router.refresh()` so the server-rendered list
 *     re-queries with the new entry. The Slice 1H.4 edit page will replace
 *     the refresh with router.push(`/workflows/${id}`).
 */
export function CreateWorkflowButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await createWorkflow({ name: name.trim() });
      setName("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof WorkflowApiError
          ? err.message
          : "Failed to create workflow.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Create workflow
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded border border-input p-4"
      aria-label="Create workflow"
    >
      <label htmlFor="new-workflow-name" className="text-sm font-medium">
        Workflow name
      </label>
      <input
        id="new-workflow-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. New customer welcome"
        required
        maxLength={120}
        autoFocus
        disabled={pending}
        className="rounded border border-input px-3 py-2 text-sm"
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || name.trim().length === 0}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setName("");
          }}
          disabled={pending}
          className="rounded border border-input px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
