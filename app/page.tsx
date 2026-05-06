import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { signOut } from "@/app/auth/actions";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="text-center flex flex-col gap-6 items-center">
        <h1 className="text-4xl font-bold">ChainReact V2</h1>
        <p className="text-muted-foreground">Architecture reset. Slice 1 in progress.</p>

        {user ? (
          <div className="flex flex-col gap-3 items-center">
            <p className="text-sm">
              Signed in as <span className="font-medium">{user.email}</span>
            </p>
            <div className="flex gap-3">
              <Link
                href="/integrations"
                className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
              >
                Manage integrations
              </Link>
              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded border border-input px-4 py-2 text-sm hover:bg-accent"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <Link
              href="/auth/sign-in"
              className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
            >
              Sign in
            </Link>
            <Link
              href="/auth/sign-up"
              className="rounded border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Sign up
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
