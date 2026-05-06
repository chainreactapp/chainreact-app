"use client";

import { useState } from "react";
import { useGraphSlice } from "../state/graphSlice";

export interface ProviderOption {
  id: string;
  displayName: string;
}

interface Props {
  triggerProviders: readonly ProviderOption[];
  actionProviders: readonly ProviderOption[];
}

type OpenMenu = "trigger" | "action" | null;

/**
 * Picker for adding a trigger or action node to the workflow.
 *
 * 1I.2 minimum: pick a provider; the node is created with `type=""` and an
 * empty config. Per-provider action catalogs (e.g. Slack's "send_channel_message"
 * vs "create_channel") arrive with each provider's slice (1L+).
 */
export function AddNodeMenu({ triggerProviders, actionProviders }: Props) {
  const pendingNodes = useGraphSlice((s) => s.pendingNodes);
  const addTrigger = useGraphSlice((s) => s.addTrigger);
  const addAction = useGraphSlice((s) => s.addAction);
  const [open, setOpen] = useState<OpenMenu>(null);

  const hasTrigger = pendingNodes.some((n) => n.kind === "trigger");

  function handleAddTrigger(provider: ProviderOption) {
    addTrigger({ provider: provider.id });
    setOpen(null);
  }

  function handleAddAction(provider: ProviderOption) {
    addAction({ provider: provider.id });
    setOpen(null);
  }

  return (
    <div className="flex flex-col gap-2" aria-label="Add node">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(open === "trigger" ? null : "trigger")}
          disabled={hasTrigger}
          title={
            hasTrigger
              ? "Workflow already has a trigger. Remove it first."
              : undefined
          }
          className="rounded border border-input px-3 py-1.5 text-sm disabled:opacity-60"
        >
          + Add trigger
        </button>
        <button
          type="button"
          onClick={() => setOpen(open === "action" ? null : "action")}
          disabled={!hasTrigger}
          title={!hasTrigger ? "Add a trigger before adding actions." : undefined}
          className="rounded border border-input px-3 py-1.5 text-sm disabled:opacity-60"
        >
          + Add action
        </button>
      </div>
      {open === "trigger" && (
        <ProviderList
          aria-label="Trigger providers"
          providers={triggerProviders}
          onPick={handleAddTrigger}
          emptyMessage="No trigger providers available."
        />
      )}
      {open === "action" && (
        <ProviderList
          aria-label="Action providers"
          providers={actionProviders}
          onPick={handleAddAction}
          emptyMessage="No action providers available."
        />
      )}
    </div>
  );
}

interface ProviderListProps {
  providers: readonly ProviderOption[];
  onPick: (provider: ProviderOption) => void;
  emptyMessage: string;
  "aria-label": string;
}

function ProviderList({
  providers,
  onPick,
  emptyMessage,
  ...rest
}: ProviderListProps) {
  if (providers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{emptyMessage}</p>
    );
  }
  return (
    <ul aria-label={rest["aria-label"]} className="flex flex-wrap gap-2">
      {providers.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onPick(p)}
            className="rounded bg-muted px-3 py-1 text-sm"
          >
            {p.displayName}
          </button>
        </li>
      ))}
    </ul>
  );
}
