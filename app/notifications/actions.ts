"use server";

import { revalidatePath } from "next/cache";
import * as notificationsRepo from "@/repositories/notifications";

/**
 * Server actions for notification mark-read mutations.
 *
 * Located under app/notifications/ — colocated with the route, mirroring
 * app/auth/actions.ts. NOT under features/ because the client-server
 * boundary forbids features/ from importing repositories/.
 *
 * No explicit session check: the repository uses the SSR-cookie Supabase
 * client, so RLS gates the UPDATE by `auth.uid() = user_id`. Anonymous
 * callers see zero rows match (auth.uid() is NULL), the UPDATE is a
 * no-op, the action returns cleanly. Authenticated callers' UPDATE is
 * auto-scoped to their own rows. The explicit getUser() check would only
 * have produced a different error message for anonymous callers — not
 * worth the extra round-trip OR the PR-AUTH-7 lint exception.
 */

export async function markNotificationRead(notificationId: string): Promise<void> {
  await notificationsRepo.markRead(notificationId);
  revalidatePath("/notifications");
  revalidatePath("/");
}

export async function markAllNotificationsRead(): Promise<void> {
  // markAllReadForUser takes a userId for explicit filtering, but RLS
  // already scopes by auth.uid(). For the server-action path we use a
  // different repository helper that scopes purely via RLS — see
  // markAllReadForCallingUser.
  await notificationsRepo.markAllReadForCallingUser();
  revalidatePath("/notifications");
  revalidatePath("/");
}
