import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { signOut } from "@/app/auth/actions";
import * as notificationsRepo from "@/repositories/notifications";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unread-notification count surfaces here until V2 has a shared
  // authenticated header layout (Slice 2+). Cheap server-side count via
  // the partial index on (user_id) WHERE read_at IS NULL.
  const unreadCount = user ? await notificationsRepo.countUnreadForUser(user.id) : 0;

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
              <Link
                href="/notifications"
                className="relative rounded border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Notifications
                {unreadCount > 0 && (
                  <span
                    aria-label={`${unreadCount} unread`}
                    className="absolute -top-2 -right-2 rounded-full bg-red-500 dark:bg-red-400 px-2 py-0.5 text-xs font-semibold text-white"
                  >
                    {unreadCount}
                  </span>
                )}
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
