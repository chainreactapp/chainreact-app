import type { WorkflowSummary } from "@/contracts/workflow";
import { displayStatus } from "@/core/workflows/projections";

interface Props {
  workflows: readonly WorkflowSummary[];
}

/**
 * Pure presentational. Server component receives the list from a server-side
 * query and renders a row per workflow with its display status.
 *
 * Per workflow-state-store.md / workflow-lifecycle.md §"V2 intended behavior":
 * the UI consumes only the projection helpers — never the raw `state` /
 * `disabledReason` columns directly.
 */
export function WorkflowsList({ workflows }: Props) {
  if (workflows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No workflows yet. Create your first one above.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="Workflows">
      {workflows.map((wf) => {
        const status = displayStatus(wf);
        // displayStatus returns null for soft-deleted; the API already
        // filters those out, so this branch is a defense-in-depth.
        if (!status) return null;
        return (
          <li
            key={wf.id}
            className="flex items-center justify-between rounded border border-input p-4"
          >
            <div className="flex flex-col">
              <span className="font-medium">{wf.name}</span>
              <span className="text-xs text-muted-foreground">
                Updated {formatTimestamp(wf.updatedAt)}
              </span>
            </div>
            <span
              data-status-kind={status.kind}
              className="rounded bg-muted px-2 py-1 text-xs font-medium"
            >
              {status.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function formatTimestamp(iso: string): string {
  // Render ISO directly. A locale-aware formatter ships when the design
  // system lands; for now this avoids hydration mismatches between server
  // and client without bringing in a date library.
  return iso.replace("T", " ").replace(/\..*$/, " UTC");
}
