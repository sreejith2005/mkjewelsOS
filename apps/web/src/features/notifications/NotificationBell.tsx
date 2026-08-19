import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { loadInbox, markNotification, subscribeToInbox } from "./api";
import type { InboxNotification } from "./types";
import { notificationDestination, unreadBadge } from "./viewModel";

export function NotificationBell({ profileId, onNavigate }: { profileId: string; onNavigate: (path: string) => void }) {
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async (payload?: any) => {
    try { 
      setItems((await loadInbox(profileId, 20)).slice(0, 5)); 
      setError(false); 
      if (payload && payload.title) {
        toast.info(payload.title, { description: payload.message });
      }
    }
    catch { setError(true); }
  }, [profileId]);

  useEffect(() => {
    void refresh();
    return subscribeToInbox(profileId, (payload) => { void refresh(payload); });
  }, [profileId, refresh]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const unread = items.filter((item) => !item.is_read).length;
  const openItem = async (item: InboxNotification) => {
    if (!item.is_read) { try { await markNotification(item.id, true); await refresh(); } catch { setError(true); return; } }
    const destination = notificationDestination(item.link_url);
    if (destination) onNavigate(destination);
    setOpen(false);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications, none unread"}
        className="relative flex size-10 items-center justify-center rounded-lg border border-gold/20 bg-obsidian text-gold hover:bg-gold/10"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Bell className="size-4" />
        {unread ? <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-danger px-1 text-[10px] font-bold leading-5 text-white">{unreadBadge(unread)}</span> : null}
      </button>
      {open ? (
        <section aria-label="Recent notifications" className="absolute right-0 top-12 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-gold/20 bg-charcoal p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-white">Recent notifications</h2>
            <Button className="min-h-8 px-2 py-1 text-xs" onClick={() => { onNavigate("/notifications"); setOpen(false); }} variant="ghost">View all <ExternalLink className="size-3" /></Button>
          </div>
          {error ? <p className="rounded-lg border border-danger/30 p-3 text-xs text-danger">Notifications could not be refreshed.</p>
            : items.length === 0 ? <p className="p-4 text-center text-sm text-soft-grey">You are all caught up.</p>
              : <div className="space-y-1">{items.map((item) => (
                <button className="flex w-full gap-3 rounded-lg p-3 text-left hover:bg-gold/10" key={item.id} onClick={() => void openItem(item)} type="button">
                  <span className={item.is_read ? "mt-1 size-2 rounded-full bg-soft-grey/30" : "mt-1 size-2 rounded-full bg-gold"} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-white">{typeof item.title === "string" ? item.title : "Notification"}</span><span className="mt-0.5 block line-clamp-2 text-xs text-soft-grey">{typeof item.message === "string" ? item.message : ""}</span></span>
                  {item.is_read ? <Check className="size-3 text-success" /> : null}
                </button>
              ))}</div>}
        </section>
      ) : null}
    </div>
  );
}
