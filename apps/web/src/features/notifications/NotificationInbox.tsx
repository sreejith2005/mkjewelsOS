import { useMemo, useState } from "react";
import { Bell, CheckCheck, Circle, CircleCheck, Search } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { markAllNotifications, markNotification } from "./api";
import type { InboxNotification } from "./types";
import { filterInbox, notificationDestination } from "./viewModel";

export function NotificationInbox({ items, loading, error, onRefresh, onNavigate }: { items: readonly InboxNotification[]; loading: boolean; error: string | null; onRefresh: () => Promise<void>; onNavigate: (path: string) => void }) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [eventType, setEventType] = useState("");
  const [priority, setPriority] = useState("");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(25);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const eventTypes = useMemo(() => [...new Set(items.flatMap((item) => typeof item.event_type === "string" ? [item.event_type] : []))].sort(), [items]);
  const filtered = useMemo(() => filterInbox(items, { unreadOnly, eventType, priority, search }), [eventType, items, priority, search, unreadOnly]);

  const toggleRead = async (item: InboxNotification) => {
    setBusy(true);
    try { setActionError(null); await markNotification(item.id, Boolean(item.is_read) ? false : true); await onRefresh(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : "Notification status could not be updated."); }
    finally { setBusy(false); }
  };
  const markAll = async () => { setBusy(true); try { setActionError(null); await markAllNotifications(); await onRefresh(); } catch (caught) { setActionError(caught instanceof Error ? caught.message : "Notifications could not be marked as read."); } finally { setBusy(false); } };

  if (loading) return <div aria-label="Loading notifications" className="space-y-3">{[1,2,3].map((value) => <div className="h-24 animate-pulse rounded-xl bg-task-muted" key={value} />)}</div>;
  if (error) return <Notice tone="danger">{error} <button className="underline" onClick={() => void onRefresh()} type="button">Try again</button></Notice>;

  return (
    <section>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="relative lg:col-span-2"><span className="sr-only">Search notifications</span><Search className="absolute left-3 top-3 size-4 text-task-text-muted" /><input className="task-field pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search title or message" value={search} /></label>
        <select aria-label="Event category" className="task-field" onChange={(event) => setEventType(event.target.value)} value={eventType}><option value="">All events</option>{eventTypes.map((event) => <option key={event} value={event}>{event.replaceAll("_", " ")}</option>)}</select>
        <select aria-label="Priority" className="task-field" onChange={(event) => setPriority(event.target.value)} value={priority}><option value="">All priorities</option>{["high","medium","low"].map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <Button onClick={() => setUnreadOnly((value) => !value)} variant={unreadOnly ? "primary" : "secondary"}>{unreadOnly ? "Unread only" : "All messages"}</Button>
      </div>
      <div className="mb-4 flex justify-end"><Button disabled={busy || !items.some((item) => !item.is_read)} onClick={() => void markAll()} variant="secondary"><CheckCheck className="size-4" /> Mark all read</Button></div>{actionError ? <div className="mb-4"><Notice tone="danger">{actionError}</Notice></div> : null}
      {filtered.length === 0 ? <div className="rounded-xl border border-task-border bg-task-bg p-10 text-center"><Bell className="mx-auto size-10 text-task-text-muted" /><h3 className="mt-3 font-semibold text-task-text">Nothing here</h3><p className="mt-1 text-sm text-task-text-muted">No notifications match the current filters.</p></div>
        : <div className="space-y-2">{filtered.slice(0,visible).map((item) => {
          const destination = notificationDestination(item.link_url);
          return <article className={item.is_read ? "rounded-xl border border-task-border bg-task-muted/50 p-4" : "rounded-xl border border-gold/40 bg-task-bg p-4 shadow-sm"} key={item.id}>
            <div className="flex items-start gap-3">
              <span className={item.is_read ? "mt-2 size-2 rounded-full bg-task-text-muted/30" : "mt-2 size-2 rounded-full bg-gold"} />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold text-task-text">{typeof item.title === "string" ? item.title : "Notification"}</h3><time className="text-xs text-task-text-muted">{item.created_at && !Number.isNaN(Date.parse(item.created_at)) ? new Date(item.created_at).toLocaleString() : ""}</time></div><p className="mt-1 whitespace-pre-wrap text-sm text-task-text-muted">{typeof item.message === "string" ? item.message : ""}</p><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-task-muted px-2 py-1 capitalize text-task-text-muted">{typeof item.event_type === "string" ? item.event_type.replaceAll("_", " ") : "system"}</span><span className="capitalize text-task-text-muted">{typeof item.priority === "string" ? item.priority : "medium"}</span>{destination ? <button className="font-semibold text-task-accent hover:underline" onClick={() => { if (!item.is_read) void toggleRead(item); onNavigate(destination); }} type="button">Open</button> : null}</div></div>
              <button aria-label={item.is_read ? "Mark unread" : "Mark read"} className="rounded-lg p-2 text-task-text-muted hover:bg-task-muted hover:text-task-text" disabled={busy} onClick={() => void toggleRead(item)} type="button">{item.is_read ? <Circle className="size-4" /> : <CircleCheck className="size-4" />}</button>
            </div>
          </article>;
        })}</div>}
      {visible < filtered.length ? <div className="mt-4 text-center"><Button onClick={() => setVisible((value) => value + 25)} variant="secondary">Load more</Button></div> : null}
    </section>
  );
}
