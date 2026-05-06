import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/**
 * Supabase Auth OAuth callback. Reached after Google (or any other Supabase
 * Auth provider) redirects back to V2. Exchanges the one-time code for a
 * session cookie via supabase.auth.exchangeCodeForSession, then redirects to
 * the `next` URL (default: home).
 *
 * Thin route per project-structure-and-module-boundaries.md §5: validates,
 * delegates to the Supabase client, redirects.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(
      new URL("/auth/sign-in?error=oauth_missing_code", request.url),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(
        `/auth/sign-in?error=${encodeURIComponent(error.message)}`,
        request.url,
      ),
    );
  }

  // Only allow same-origin `next` paths to prevent open-redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(new URL(safeNext, request.url));
}
