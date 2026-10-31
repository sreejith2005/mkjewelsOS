import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Bell, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { loadInbox, markNotification, subscribeToInbox } from "./api";
import type { InboxNotification } from "./types";
import { notificationDestination } from "./viewModel";

export function NotificationBell({ profileId, onNavigate, unreadCount }: { profileId: string; onNavigate: (path: string) => void; unreadCount: number | undefined }) {
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [open, setOpen] = useState(false);
  // Phone panel offset: the header's real bottom edge (it grows when Developer Mode adds a row).
  const [panelTop, setPanelTop] = useState<number | null>(null);
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

  const unread = unreadCount;
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
        aria-label={unread === undefined ? "Notifications" : unread ? `Notifications, ${unread} unread` : "Notifications, none unread"}
        className="relative flex size-10 items-center justify-center rounded-lg border border-gold/25 bg-charcoal text-gold-secondary transition hover:bg-gold/10"
        onClick={() => { setPanelTop(rootRef.current?.closest("header")?.getBoundingClientRect().bottom ?? null); setOpen((value) => !value); }}
        type="button"
      >
        <Bell className="size-4" />
        {unread ? <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-danger px-1 text-[10px] font-bold leading-5 text-white">{unread}</span> : null}
      </button>
      {open ? (
        // Phones: pinned to both screen edges under the header, so it never depends on where the
        // bell sits among the other header controls. Wider screens: anchored under the bell.
        <section aria-label="Recent notifications" style={panelTop === null ? undefined : { "--panel-top": `${Math.round(panelTop + 8)}px` } as CSSProperties} className="fixed inset-x-3 top-[var(--panel-top,calc(3.5rem_+_env(safe-area-inset-top)_+_0.5rem))] z-50 max-h-[min(70dvh,32rem)] overflow-y-auto overscroll-contain rounded-2xl border border-task-border bg-charcoal p-3 shadow-lift duration-200 animate-in fade-in slide-in-from-top-2 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96">
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
