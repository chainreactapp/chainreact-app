"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

/**
 * Auth server actions for Slice 1E.
 *
 * Email + password is the Slice 1 floor. SSO providers (Google, GitHub, etc.)
 * are a later slice. Each action returns a typed result so the form can render
 * the user-facing error per testing-strategy.md §6 ("user-facing message"
 * matters, not just thrown exceptions).
 */

export type AuthActionResult = { ok: true } | { ok: false; error: string };

function readCredentials(formData: FormData): { email: string; password: string } | { error: string } {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "Email and password are required." };
  }
  if (email.trim().length === 0 || password.length === 0) {
    return { error: "Email and password are required." };
  }
  return { email: email.trim(), password };
}

export async function signUp(_prev: AuthActionResult | null, formData: FormData): Promise<AuthActionResult> {
  const creds = readCredentials(formData);
  if ("error" in creds) return { ok: false, error: creds.error };
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp(creds);
  if (error) return { ok: false, error: error.message };
  // Note: Supabase may require email confirmation; the user lands on /auth/sign-up
  // and sees a "check your email" message before redirect to /. For dev,
  // disable "Confirm email" in the Supabase Auth settings.
  redirect("/");
}

export async function signIn(_prev: AuthActionResult | null, formData: FormData): Promise<AuthActionResult> {
  const creds = readCredentials(formData);
  if ("error" in creds) return { ok: false, error: creds.error };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(creds);
  if (error) return { ok: false, error: error.message };
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
