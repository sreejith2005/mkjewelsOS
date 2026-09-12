import { useEffect, useId, useRef, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { LogOut, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export type MobileNavigationDrawerItem = Readonly<{
  Icon: ComponentType<{ className?: string }>;
  description: string;
  id: string;
  label: string;
  path: string;
}>;

export function MobileNavigationDrawer({
  branchName,
  currentPath,
  items,
  onClose,
  onLogout,
  onNavigate,
  profileName,
  roleLabel,
}: {
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
      <div aria-hidden className="absolute inset-0 bg-obsidian/70 backdrop-blur-sm" onMouseDown={onClose} />
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative flex h-full w-[min(20rem,calc(100vw_-_2.5rem))] flex-col border-r border-task-border bg-task-bg text-task-text shadow-2xl"
        onKeyDown={trapFocus}
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="border-b border-task-border px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold" id={titleId}>Navigation</h2>
            <Button aria-label="Close navigation" className="size-11 p-0 text-task-text-muted hover:bg-task-muted hover:text-task-text" onClick={onClose} variant="ghost">
              <X />
            </Button>
          </div>
          <div className="mt-3 rounded-xl bg-task-muted p-3">
            <p className="truncate text-sm font-semibold text-task-text">{profileName}</p>
            <p className="mt-1 truncate text-xs text-task-text-muted">{roleLabel} · {branchName}</p>
          </div>
        </header>
        <nav aria-label="Application navigation" className="flex-1 overflow-y-auto overscroll-contain p-3">
          <div className="flex flex-col gap-1">
            {items.map(({ Icon, description, id, label, path }) => {
              const selected = currentPath === path;
              return (
                <button
                  aria-current={selected ? "page" : undefined}
                  className={cn("flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 text-left transition", selected ? "bg-task-accent-soft text-task-accent" : "text-task-text hover:bg-task-muted")}
                  key={id}
                  onClick={() => { onNavigate(path); onClose(); }}
                  type="button"
                >
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", selected ? "bg-task-accent text-task-bg" : "bg-task-muted text-task-text-muted")}><Icon className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{label}</span>
                    <span className="block truncate text-xs text-task-text-muted">{description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
        <div className="border-t border-task-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button className="w-full border-task-border bg-task-bg text-task-overdue hover:bg-task-muted" onClick={() => void onLogout()} variant="secondary">
            <LogOut />Sign out
          </Button>
        </div>
      </section>
    </div>
  );
}
