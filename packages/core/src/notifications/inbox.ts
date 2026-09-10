import { isSafeInternalLink } from "./delivery";

export type NotificationInboxItem = Readonly<{
  event_type: string;
  is_read: boolean | null;
  message: string;
  priority: string;
  title: string;
}>;

export type NotificationInboxFilters = Readonly<{
  unreadOnly: boolean;
  eventType: string;
  priority: string;
  search: string;
}>;

export function filterNotificationInbox<T extends NotificationInboxItem>(
  items: readonly T[],
  filters: NotificationInboxFilters,
): T[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return items.filter((item) =>
    (!filters.unreadOnly || !item.is_read)
    && (!filters.eventType || item.event_type === filters.eventType)
    && (!filters.priority || item.priority === filters.priority)
    && (!query || `${item.title} ${item.message}`.toLocaleLowerCase().includes(query)),
  );
}

export function notificationDestination(link: string | null): string | null {
  return isSafeInternalLink(link) ? link : null;
}
