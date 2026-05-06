import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import * as notificationsRepo from "@/repositories/notifications";
import { NotificationsList } from "@/features/notifications/NotificationsList";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const notifications = await notificationsRepo.listForUser(user.id);

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Notifications</h1>
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            ← Home
          </Link>
        </div>
        <NotificationsList notifications={notifications} />
      </div>
    </main>
  );
}
