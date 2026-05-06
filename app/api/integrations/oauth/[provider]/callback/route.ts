import { NextResponse } from "next/server";
import { handleCallback } from "@/services/oauth/dispatcher";

/**
 * OAuth callback handler. The provider redirects the user here after they
 * authorize. We exchange the code for tokens via the dispatcher (which
 * delegates to the per-provider OAuth module), then redirect to the home
 * page with a status param the UI can render.
 *
 * Redirect base comes from NEXT_PUBLIC_APP_URL, not request.url: behind a
 * tunnel (ngrok dev) or proxy, the upstream Host header may be rewritten,
 * which would point the redirect Location back at the wrong origin (e.g.
 * http://localhost:3000 even though the browser is on the public URL). The
 * env value is the canonical public URL of this deployment.
 *
 * Thin route per project-structure-and-module-boundaries.md §5.
 */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const base = appUrl();

  if (providerError) {
    return NextResponse.redirect(
      new URL(
        `/?integration_error=${encodeURIComponent(providerError)}`,
        base,
      ),
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/?integration_error=missing_code_or_state", base),
    );
  }

  try {
    const { integration } = await handleCallback({ provider, code, state });
    return NextResponse.redirect(
      new URL(
        `/?integration=connected&provider=${encodeURIComponent(integration.provider)}`,
        base,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "callback_failed";
    return NextResponse.redirect(
      new URL(`/?integration_error=${encodeURIComponent(message)}`, base),
    );
  }
}
