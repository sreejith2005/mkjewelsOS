import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export type ActionMenuItem = Readonly<{
  label: string;
  onSelect: () => void;
  icon?: ComponentType<{ className?: string }>;
  danger?: boolean;
  disabled?: boolean;
}>;

/**
 * The "⋯" menu for a row's less frequent actions. Opens on click or Enter,
 * moves with the arrow keys, closes on Escape, a click outside, or a choice,
 * and returns focus to its button. Hidden when there is nothing to offer.
 */
export function ActionMenu({ label, items, className }: { label: string; items: readonly ActionMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const first = rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
    const onDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!items.length) return null;
  const close = () => { setOpen(false); buttonRef.current?.focus(); };
  const onMenuKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const entries = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); entries[(at + 1) % entries.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); entries[(at - 1 + entries.length) % entries.length]?.focus(); }
    else if (event.key === "Tab") setOpen(false);
  };
  return <div className={cn("relative", className)} ref={rootRef}>
    <button aria-controls={open ? menuId : undefined} aria-expanded={open} aria-haspopup="menu" aria-label={label} className="flex size-10 items-center justify-center rounded-lg text-task-text-muted transition-colors hover:bg-task-muted hover:text-task-text" onClick={() => setOpen((value) => !value)} ref={buttonRef} title={label} type="button"><MoreHorizontal aria-hidden className="size-5" /></button>
    {open ? <div aria-label={label} className="absolute right-0 top-full z-30 mt-1 min-w-48 rounded-xl border border-task-border bg-task-bg p-1 shadow-lift" id={menuId} onKeyDown={onMenuKey} role="menu">
      {items.map(({ label: itemLabel, onSelect, icon: Icon, danger, disabled }) => <button className={cn("flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50", danger ? "text-danger hover:bg-danger/10" : "text-task-text hover:bg-task-muted")} disabled={disabled} key={itemLabel} onClick={() => { setOpen(false); onSelect(); }} role="menuitem" type="button">{Icon ? <Icon className="size-4 shrink-0" /> : null}{itemLabel}</button>)}
    </div> : null}
  </div>;
}
