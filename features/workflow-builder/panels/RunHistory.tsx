import type { WorkflowRunSummary } from "@/contracts/workflow";

interface Props {
  runs: readonly WorkflowRunSummary[];
}

/**
 * Pure presentational. Server component renders the run history list with
 * status badges + humanized error_classification surfaces. The page
 * fetches the runs server-side and passes them in; refresh on
 * router.refresh() / browser refresh.
 *
 * The action CTAs (`reconnect`, `open_node`, `upgrade_plan`) ride into
 * the hint text for now — full button wiring lands when we route them
 * to the integrations page / focused builder node / billing page.
 */
export function RunHistory({ runs }: Props) {
  if (runs.length === 0) {
    return (
      <section className="flex flex-col gap-2" aria-label="Run history">
        <h2 className="text-sm font-medium text-muted-foreground">
          Recent runs
        </h2>
        <p className="text-xs text-muted-foreground">
          No runs yet. The first webhook event will record one here.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Run history">
      <h2 className="text-sm font-medium text-muted-foreground">
        Recent runs ({runs.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {runs.map((run) => (
          <li key={run.id}>
            <RunRow run={run} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RunRow({ run }: { run: WorkflowRunSummary }) {
  const succeeded = run.status === "succeeded";
  return (
    <article
      className="flex flex-col gap-2 rounded border border-input p-3"
      data-status={run.status}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(run.startedAt)}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {durationLabel(run.startedAt, run.finishedAt)}
        </span>
      </div>
      {!succeeded && run.errorClassification && (
        <ErrorBlock classification={run.errorClassification} />
      )}
    </article>
  );
}

function StatusBadge({ status }: { status: WorkflowRunSummary["status"] }) {
  const label = status === "succeeded" ? "Succeeded" : "Failed";
  const classes =
    status === "succeeded"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-300"
      : "bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-300";
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${classes}`}
      data-status-kind={status}
    >
      {label}
    </span>
  );
}

function ErrorBlock({
  classification,
}: {
  classification: NonNullable<WorkflowRunSummary["errorClassification"]>;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded bg-muted p-2 text-xs"
      data-severity={classification.severity}
      role={classification.severity === "error" ? "alert" : "status"}
    >
      <span className="font-medium">{classification.title}</span>
      <span className="text-muted-foreground">{classification.description}</span>
      {classification.hint && (
        <span className="text-muted-foreground">
          <span className="font-medium">Hint: </span>
          {classification.hint}
        </span>
      )}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  // Same convention as features/workflows/WorkflowsList — render ISO
  // directly to avoid hydration mismatches; locale-aware formatting
  // lands when the design system does.
  return iso.replace("T", " ").replace(/\..*$/, " UTC");
}

function durationLabel(startedAtIso: string, finishedAtIso: string): string {
  const startMs = Date.parse(startedAtIso);
  const endMs = Date.parse(finishedAtIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "";
  const ms = Math.max(0, endMs - startMs);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
