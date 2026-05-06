import { NextResponse } from "next/server";
import { handleCallback } from "@/services/oauth/dispatcher";

/**
 * OAuth callback handler. The provider redirects the user here after they
 * authorize. We exchange the code for tokens via the dispatcher (which
 * delegates to the per-provider OAuth module), then redirect to the home
 * page with a status param the UI can render.
 *
 * Thin route per project-structure-and-module-boundaries.md §5.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  if (providerError) {
    return NextResponse.redirect(
      new URL(
        `/?integration_error=${encodeURIComponent(providerError)}`,
        request.url,
      ),
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/?integration_error=missing_code_or_state", request.url),
    );
  }

  try {
    const { integration } = await handleCallback({ provider, code, state });
    return NextResponse.redirect(
      new URL(
        `/?integration=connected&provider=${encodeURIComponent(integration.provider)}`,
        request.url,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "callback_failed";
    return NextResponse.redirect(
      new URL(`/?integration_error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
