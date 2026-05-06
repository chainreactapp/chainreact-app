/**
 * Typed client API for integration operations.
 *
 * Per project-structure-and-module-boundaries.md §5, this is the only bridge
 * client code uses to reach the server. Components and feature hooks call
 * these functions; never `fetch()` directly, never `repositories/` or
 * `services/` directly.
 */

export interface StartOAuthResult {
  redirectUrl: string;
}

export async function startOAuth(provider: string): Promise<StartOAuthResult> {
  const res = await fetch(
    `/api/integrations/oauth/${encodeURIComponent(provider)}/connect`,
    { method: "POST" },
  );
  if (!res.ok) {
    let message = `Failed to start OAuth (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* response wasn't JSON; keep default message */
    }
    throw new Error(message);
  }
  return (await res.json()) as StartOAuthResult;
}
