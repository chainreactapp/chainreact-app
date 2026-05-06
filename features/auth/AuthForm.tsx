"use client";

import { useActionState } from "react";
import type { AuthActionResult } from "@/app/auth/actions";

type Action = (prev: AuthActionResult | null, formData: FormData) => Promise<AuthActionResult>;

export function AuthForm({
  action,
  submitLabel,
}: {
  action: Action;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<AuthActionResult | null, FormData>(
    action,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4 w-full max-w-sm">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="rounded border border-input bg-background px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Password</span>
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="current-password"
          className="rounded border border-input bg-background px-3 py-2"
        />
      </label>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-primary text-primary-foreground px-4 py-2 font-medium disabled:opacity-60"
      >
        {pending ? "..." : submitLabel}
      </button>
    </form>
  );
}
