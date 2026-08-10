import { EVENT_VARIABLES, isSafeInternalLink, validateRule, validateTemplateText, type NotificationEventType } from "@jewelos/core";
import type { InboxNotification, RuleDraft } from "./types";

export type InboxFilters = Readonly<{ unreadOnly: boolean; eventType: string; priority: string; search: string }>;

export function filterInbox(items: readonly InboxNotification[], filters: InboxFilters): InboxNotification[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return items.filter((item) =>
    (!filters.unreadOnly || !item.is_read)
    && (!filters.eventType || item.event_type === filters.eventType)
    && (!filters.priority || item.priority === filters.priority)
    && (!query || `${item.title} ${item.message}`.toLocaleLowerCase().includes(query)),
  );
}

export function unreadBadge(count: number): string { return count > 99 ? "99+" : String(count); }

export function recentNotifications(items: readonly InboxNotification[], limit = 5): InboxNotification[] {
  return [...items].sort((a,b) => Date.parse(b.created_at ?? "")-Date.parse(a.created_at ?? "")).slice(0,limit);
}

export function withNotificationRead(items: readonly InboxNotification[], id: string, isRead: boolean): InboxNotification[] {
  return items.map((item) => item.id === id ? { ...item, is_read: isRead, read_at: isRead ? new Date(0).toISOString() : null } : item);
}

export function withAllNotificationsRead(items: readonly InboxNotification[]): InboxNotification[] {
  return items.map((item) => item.is_read ? item : { ...item, is_read: true, read_at: new Date(0).toISOString() });
}

export function notificationTabs(role: string): readonly string[] {
  return role === "super_admin" || role === "admin" ? ["inbox","templates","rules","logs"] : ["inbox"];
}

export function isChannelSelectable(channel: string, availability: Readonly<Record<string, boolean>>): boolean {
  return availability[channel] === true;
}

export function inboxDisplayState(loading: boolean, error: string | null, count: number): "loading"|"error"|"empty"|"ready" {
  if (loading) return "loading";
  if (error) return "error";
  return count === 0 ? "empty" : "ready";
}

export function notificationDestination(link: string | null): string | null {
  return isSafeInternalLink(link) ? link : null;
}

export function validateTemplateDraft(eventType: NotificationEventType, title: string, body: string, link: string | null): readonly string[] {
  const validation = validateTemplateText(eventType, title, body);
  return [...validation.errors, ...(isSafeInternalLink(link) ? [] : ["Link must be a safe internal path"] )];
}

export function validateRuleDraft(draft: RuleDraft): readonly string[] {
  return validateRule({
    eventType: draft.eventType,
    conditions: draft.conditions.map((condition) => ({ ...condition, operator: condition.operator as never })),
    channels: Object.keys(draft.channelTemplates) as never,
    recipients: draft.recipients,
    delayMinutes: draft.delayMinutes,
    cooldownMinutes: draft.cooldownMinutes,
    maxAttempts: draft.maxAttempts,
    backoffMinutes: draft.backoffMinutes,
  });
}

export function variablesForEvent(eventType: NotificationEventType): readonly string[] { return EVENT_VARIABLES[eventType]; }

export function deliveryCanRetry(state: string): boolean { return state === "failed_terminal" || state === "blocked_configuration"; }

export function createSubscriptionLifecycle(subscribe: (refresh: () => void) => () => void, refresh: () => void): () => void {
  return subscribe(refresh);
}
