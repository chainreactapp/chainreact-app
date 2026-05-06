import Link from "next/link";
import type { NotificationRecord } from "@/repositories/notifications";
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/app/notifications/actions";

/**
 * Server component — renders the user's notifications. Mark-read calls go
 * through server actions (../actions.ts) which revalidate this page + the
 * home page's unread badge after the UPDATE lands.
 *
 * Layout choice: one row per notification, severity color on the left
 * border, action CTA on the right. Failed runs include a Run-history link
 * derived from action_url. Light/dark friendly through Tailwind tokens.
 */

interface Props {
  notifications: readonly NotificationRecord[];
}

export function NotificationsList({ notifications }: Props) {
  const unread = notifications.filter((n) => n.readAt === null);
  if (notifications.length === 0) {
    return (
      <div className="rounded border border-input bg-card p-6 text-sm text-muted-foreground">
        No notifications yet. Failed workflow runs will show up here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {unread.length > 0 && (
        <form action={markAllNotificationsRead}>
          <button
            type="submit"
            className="rounded border border-input px-3 py-1.5 text-sm hover:bg-accent"
          >
            Mark all read ({unread.length})
          </button>
        </form>
      )}
      <ul className="flex flex-col gap-2">
        {notifications.map((n) => (
          <NotificationRow key={n.id} notification={n} />
        ))}
      </ul>
    </div>
  );
}

function NotificationRow({ notification: n }: { notification: NotificationRecord }) {
  const isUnread = n.readAt === null;
  const severityBorder =
    n.severity === "error"
      ? "border-l-red-500 dark:border-l-red-400"
      : "border-l-amber-500 dark:border-l-amber-400";
  const unreadBg = isUnread ? "bg-accent/40" : "bg-card";

  const markReadAction = markNotificationRead.bind(null, n.id);

  return (
    <li
      className={`flex items-start gap-3 rounded border border-input border-l-4 ${severityBorder} ${unreadBg} p-4`}
      role={n.severity === "error" ? "alert" : "status"}
    >
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{n.title}</span>
          {isUnread && (
            <span className="text-xs rounded-full bg-primary px-2 py-0.5 text-primary-foreground">
              new
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{n.body}</p>
        <p className="text-xs text-muted-foreground">
          {new Date(n.createdAt).toISOString()}
        </p>
      </div>
      <div className="flex flex-col gap-2 items-end">
        {n.actionUrl && (
          <Link
            href={n.actionUrl}
            className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium"
          >
            View
          </Link>
        )}
        {isUnread && (
          <form action={markReadAction}>
            <button
              type="submit"
              className="rounded border border-input px-3 py-1.5 text-xs hover:bg-accent"
            >
              Mark read
            </button>
          </form>
        )}
      </div>
    </li>
  );
}
