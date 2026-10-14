import { useEffect, useId, useRef, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { LogOut, X } from "lucide-react";
import { Button } from "@/components/ui";
import wordmarkUrl from "@/assets/mk-jewels-wordmark.png";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export type MobileNavigationDrawerItem = Readonly<{
  Icon: ComponentType<{ className?: string }>;
  description: string;
  id: string;
  label: string;
  path: string;
}>;

/** A count chip on a navigation item (Ask Kiara: open questions for you). */
export function NavCountBadge({ count, label }: { count: number | undefined; label: string }) {
  if (!count) return null;
  return <span aria-label={`${count} ${label}`} className="ml-auto min-w-5 rounded-full bg-task-accent px-1.5 text-center text-xs font-bold leading-5 text-white" role="status">{count > 99 ? "99+" : count}</span>;
}

export function MobileNavigationDrawer({
  badges,
  branchName,
  currentPath,
  items,
  onClose,
  onLogout,
  onNavigate,
  profileName,
  roleLabel,
}: {
  /** Counts shown next to items, by item id. */
  badges?: Readonly<Record<string, number>> | undefined;
  branchName: string;
  currentPath: string;
  items: readonly MobileNavigationDrawerItem[];
  onClose: () => void;
  onLogout: () => Promise<void>;
  onNavigate: (path: string) => void;
  profileName: string;
  roleLabel: string;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => drawerRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [onClose]);

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !drawerRef.current) return;
    const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div aria-hidden className="absolute inset-0 bg-obsidian/70 backdrop-blur-sm duration-200 animate-in fade-in" onMouseDown={onClose} />
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative flex h-full w-[min(20rem,calc(100vw_-_2.5rem))] flex-col border-r border-task-border bg-task-bg text-task-text shadow-2xl duration-300 ease-out animate-in slide-in-from-left"
        onKeyDown={trapFocus}
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="relative px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <img alt="MK Jewels" className="h-4 w-auto" src={wordmarkUrl} />
              <h2 className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-task-text-muted" id={titleId}>Navigation</h2>
            </div>
            <Button aria-label="Close navigation" className="size-11 p-0 text-task-text-muted hover:bg-task-muted hover:text-task-text" onClick={onClose} variant="ghost">
              <X />
            </Button>
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-task-border bg-task-muted/70 p-3">
            <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gold-sheen text-sm font-bold text-on-gold shadow-gold">{initials(profileName)}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-task-text">{profileName}</span>
              <span className="mt-0.5 block truncate text-xs text-task-text-muted">{roleLabel} · {branchName}</span>
            </span>
          </div>
          <span aria-hidden className="gold-rule absolute inset-x-0 bottom-0 h-px opacity-60" />
        </header>
        <nav aria-label="Application navigation" className="flex-1 overflow-y-auto overscroll-contain p-3">
          <div className="flex flex-col gap-1">
            {items.map(({ Icon, description, id, label, path }) => {
              const selected = currentPath === path;
              return (
                <button
                  aria-current={selected ? "page" : undefined}
                  className={cn("group flex min-h-14 items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors active:bg-task-muted", selected ? "bg-gold/10 text-task-text" : "text-task-text hover:bg-task-muted")}
                  key={id}
                  onClick={() => { onNavigate(path); onClose(); }}
                  type="button"
                >
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors", selected ? "bg-gold-sheen text-on-gold shadow-gold" : "bg-task-muted text-task-text-muted group-hover:text-gold-secondary")}><Icon className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{label}</span>
                    <span className="block truncate text-xs text-task-text-muted">{description}</span>
                  </span>
                  <NavCountBadge count={badges?.[id]} label="open questions for you" />
                  {selected ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-gold" /> : null}
                </button>
              );
            })}
          </div>
        </nav>
        <div className="border-t border-task-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button className="w-full border-task-border bg-task-bg text-task-overdue hover:border-task-overdue/40 hover:bg-task-overdue/5" onClick={() => void onLogout()} variant="secondary">
            <LogOut />Sign out
          </Button>
        </div>
      </section>
    </div>
  );
}
