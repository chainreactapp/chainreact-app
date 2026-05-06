"use client";

import { useState } from "react";
import { startOAuth } from "@/lib/api/integrations";

interface Props {
  provider: string;
  label: string;
}

/**
 * Initiates the OAuth handshake for the given provider.
 *
 * Per workflow-builder-ui.md / project-structure-and-module-boundaries.md §4-5:
 *   - The component never calls fetch directly.
 *   - It calls the typed client API (`startOAuth`) which wraps fetch + error handling.
 *   - The provider's authorize URL is an external destination, so we use
 *     `window.location.assign(...)` (testable + idiomatic for full-page nav).
 */
export function ConnectButton({ provider, label }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const { redirectUrl } = await startOAuth(provider);
      window.location.assign(redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start OAuth.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Redirecting…" : label}
      </button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
