"use client";

import type { WorkflowNode } from "@/contracts/workflow";
import { useGraphSlice } from "../state/graphSlice";

interface Props {
  /**
   * Map of provider id → display name. Used to render a friendlier label
   * than the raw id. Keys missing from the map fall back to the id.
   */
  providerLabels: Readonly<Record<string, string>>;
}

/**
 * Slice 1I.2 minimum: vertical list of the workflow's nodes in execution
 * order. The full ReactFlow canvas (per workflow-builder-ui.md) ships in a
 * later slice; for now a list is enough to verify the round-trip
 * (add → save → reload).
 */
export function NodeList({ providerLabels }: Props) {
  const nodes = useGraphSlice((s) => s.pendingNodes);
  const removeNode = useGraphSlice((s) => s.removeNode);

  if (nodes.length === 0) {
    return (
      <div className="rounded border border-dashed border-input p-8 text-center text-sm text-muted-foreground">
        Empty workflow. Add a trigger to get started.
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-2" aria-label="Workflow nodes">
      {nodes.map((node) => (
        <li key={node.id}>
          <NodeRow
            node={node}
            providerLabel={providerLabels[node.provider] ?? node.provider}
            onRemove={() => removeNode(node.id)}
          />
        </li>
      ))}
    </ol>
  );
}

interface NodeRowProps {
  node: WorkflowNode;
  providerLabel: string;
  onRemove: () => void;
}

function NodeRow({ node, providerLabel, onRemove }: NodeRowProps) {
  return (
    <div className="flex items-center justify-between rounded border border-input p-3">
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {node.kind}
        </span>
        <span className="font-medium">{providerLabel}</span>
        <span className="text-xs text-muted-foreground">
          {node.type ? node.type : "(unconfigured)"}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${node.kind} node`}
        className="rounded border border-input px-2 py-1 text-xs"
      >
        Remove
      </button>
    </div>
  );
}
