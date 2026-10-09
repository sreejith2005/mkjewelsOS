import {
  type ExecutorContext,
  type SelectFilter,
  type ToolArgs,
  type ToolOutcome,
  argBool,
  argInt,
  isOutcome,
  localTime,
  outcomeForError,
  selectRows,
  text,
  untrusted,
} from "./shared.ts";

/**
 * `get_my_notifications` mirrors the Notifications inbox: `notifications`
 * filtered to the caller (`packages/data/src/notifications/api.ts`), under the
 * inbox RLS and its restrictive section policy. It only reads: it never calls
 * `mark_notification_read`, so nothing changes because Kiara looked.
 */
export async function getMyNotifications(context: ExecutorContext, args: ToolArgs): Promise<ToolOutcome> {
  const { actor, profileId, timeZone } = context;
  const limit = argInt(args, "limit", 10);
  const unreadOnly = argBool(args, "unread_only");
  const filters: SelectFilter[] = [{ op: "eq", column: "user_profile_id", value: profileId }];
  const [list, unread] = await Promise.all([
    selectRows(actor, "notifications", {
      columns: "event_type,title,message,is_read,priority,created_at",
      filters: unreadOnly ? [...filters, { op: "eq", column: "is_read", value: false }] : filters,
      order: [{ column: "created_at", ascending: false }],
      limit: limit + 1,
    }),
    actor.select("notifications", { columns: "id", filters: [...filters, { op: "eq", column: "is_read", value: false }], limit: 1, count: true }),
  ]);
  if (isOutcome(list)) return list;
  if (unread.error) return outcomeForError(unread.error);

  return {
    result: {
      unread_count: typeof unread.count === "number" ? unread.count : null,
      notifications: list.slice(0, limit).map((row) => ({
        title: untrusted(row.title, 160),
        message: untrusted(row.message, 300),
        kind: text(row.event_type),
        read: row.is_read === true,
        priority: text(row.priority),
        at: localTime(row.created_at, timeZone),
      })),
      ...(list.length > limit ? { truncated: true } : {}),
    },
    isError: false,
  };
}
