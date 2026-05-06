"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

/**
 * Initiates Google sign-in via Supabase Auth.
 *
 * Supabase handles the entire OAuth handshake (Google credentials live in the
 * Supabase dashboard, not in V2 .env). After Google authenticates the user,
 * Supabase redirects to /auth/callback with a code; our callback route
 * exchanges it for a session.
 */
export function GoogleSignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
    // On success the supabase-js client navigates the browser to Google;
    // no further work here.
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded border border-input px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
      >
        {pending ? "Redirecting…" : "Sign in with Google"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
