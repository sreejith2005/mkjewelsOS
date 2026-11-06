import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Inbox, Loader2, X } from "lucide-react";
import { scoreBand, SCORE_BAND_LABEL, type ConversationStatusText } from "@jewelos/core";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/** A calm card: the one surface style used across Store Intelligence. */
export function Panel({ title, action, children, className, titleId, description }: {
  title?: string; action?: ReactNode; children: ReactNode; className?: string; titleId?: string; description?: ReactNode;
}) {
  const generated = useId(); const id = titleId ?? generated;
  return <section aria-labelledby={title ? id : undefined} className={cn("rounded-2xl border border-task-border bg-task-bg p-4 shadow-card sm:p-5", className)}>
    {title ? <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h2 className="text-base font-semibold text-task-text" id={id}>{title}</h2>{description ? <p className="mt-0.5 text-sm text-task-text-muted">{description}</p> : null}</div>
      {action}
    </div> : null}
    {children}
  </section>;
}

const PILL_TONES = {
  neutral: "border-task-border bg-task-muted text-task-text-muted",
  progress: "border-gold/30 bg-gold/10 text-task-text",
  success: "border-success/30 bg-success/10 text-success",
  attention: "border-warning/40 bg-warning/10 text-task-text",
} as const;
export function StatusPill({ status }: { status: ConversationStatusText }) {
  return <span className={cn("inline-flex min-h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold", PILL_TONES[status.tone])}>
    {status.tone === "progress" ? <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" /> : null}
    {status.tone === "attention" ? <AlertTriangle aria-hidden className="size-3" /> : null}
    {status.label}
  </span>;
}
export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof PILL_TONES }) {
  return <span className={cn("inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium", PILL_TONES[tone])}>{children}</span>;
}

/** Score with its band in words, so meaning never depends on colour. */
export function ScoreBadge({ score, size = "sm", managerScored = false }: { score: number | null; size?: "sm" | "lg"; managerScored?: boolean }) {
  if (score === null) return <span className={cn("text-task-text-muted", size === "lg" ? "text-base" : "text-xs")}>No score</span>;
  const band = scoreBand(score);
  return <span className="inline-flex items-baseline gap-1.5" title={managerScored ? "Score set by a manager" : "AI score"}>
    <span className={cn("font-semibold tabular-nums text-task-text", size === "lg" ? "text-4xl tracking-tight" : "text-base")}>{Math.round(score)}</span>
    <span className={cn("text-task-text-muted", size === "lg" ? "text-sm" : "text-xs")}>/100 · {SCORE_BAND_LABEL[band]}{managerScored ? " · manager" : ""}</span>
  </span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-task-border px-4 py-10 text-center">
    <Inbox aria-hidden className="size-8 text-task-text-muted" />
    <p className="text-base font-semibold text-task-text">{title}</p>
    {children ? <div className="max-w-md text-sm text-task-text-muted">{children}</div> : null}
    {action ? <div className="mt-2">{action}</div> : null}
  </div>;
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="flex flex-col items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4" role="alert">
    <p className="text-sm text-task-text">{message}</p>
    {onRetry ? <Button onClick={onRetry} type="button" variant="secondary">Try again</Button> : null}
  </div>;
}
/** Placeholder rows while the first load runs; never fake numbers. */
export function SkeletonRows({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return <div aria-busy="true" aria-label={label} className="space-y-3" role="status">
    {Array.from({ length: rows }, (_, index) => <div className="h-16 animate-pulse rounded-xl bg-task-muted motion-reduce:animate-none" key={index} />)}
    <span className="sr-only">{label}…</span>
  </div>;
}

/** A number people can read in one glance. Missing values say so instead of showing 0. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return <div className="min-w-0 rounded-xl border border-task-border bg-task-bg p-3 sm:p-4">
    <p className="truncate text-xs font-medium text-task-text-muted">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-task-text">{value ?? "—"}</p>
    {hint ? <p className="mt-0.5 text-xs text-task-text-muted">{hint}</p> : null}
  </div>;
}

/**
 * Tabs as links (deep-linkable) with arrow-key movement. `role="tablist"` only
 * when the tabs switch content in place; section navigation uses a nav landmark.
 */
export function TabBar<T extends string>({ items, current, onSelect, label, mode = "nav", controls }: {
  items: readonly Readonly<{ id: T; label: string; href?: string; badge?: number | null }>[]; current: T; onSelect: (id: T) => void; label: string;
  mode?: "nav" | "tabs"; controls?: string;
}) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  // Keep the current tab visible in a horizontally scrolling bar (phones).
  useEffect(() => {
    const index = items.findIndex((item) => item.id === current);
    refs.current[index]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current, items]);
  const move =(event: ReactKeyboardEvent, index: number) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : delta ? (index + delta + items.length) % items.length : -1;
    if (target < 0) return;
    event.preventDefault(); refs.current[target]?.focus();
    if (mode === "tabs") onSelect(items[target]!.id); // target is a valid index.
  };
  const itemClass = (active: boolean) => cn("relative inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
    active ? "bg-task-text text-task-bg" : "text-task-text-muted hover:bg-task-muted hover:text-task-text");
  const list = items.map((item, index) => {
    const active = item.id === current;
    const content = <>{item.label}{item.badge ? <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-task-bg/20" : "bg-gold/15 text-task-text")}>{item.badge}<span className="sr-only"> waiting</span></span> : null}</>;
    if (mode === "tabs") return <button aria-controls={controls} aria-selected={active} className={itemClass(active)} id={`tab-${item.id}`} key={item.id}
      onClick={() => onSelect(item.id)} onKeyDown={(event) => move(event, index)} ref={(element) => { refs.current[index] = element; }} role="tab" tabIndex={active ? 0 : -1} type="button">{content}</button>;
    return <a aria-current={active ? "page" : undefined} className={itemClass(active)} href={item.href} key={item.id}
      onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); onSelect(item.id); }}
      onKeyDown={(event) => move(event, index)} ref={(element) => { refs.current[index] = element; }}>{content}</a>;
  });
  return mode === "tabs"
    ? <div aria-label={label} className="scroll-x no-scrollbar -mx-1 flex gap-1 px-1 py-1" role="tablist">{list}</div>
    : <nav aria-label={label} className="scroll-x no-scrollbar -mx-1 flex gap-1 px-1 py-1">{list}</nav>;
}

/**
 * Side drawer on wide screens, bottom sheet on phones. Focus moves in, is trapped,
 * Escape closes, and focus returns to the opener.
 */
export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId(); const panel = useRef<HTMLElement>(null); const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => (panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current)?.focus());
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closeRef.current(); } };
    document.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; opener?.focus(); };
  }, []);
  const trap = (event: ReactKeyboardEvent) => {
    if (event.key !== "Tab" || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')];
    const first = focusable[0]; const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-end bg-obsidian/60 backdrop-blur-sm duration-200 animate-in fade-in motion-reduce:animate-none sm:items-stretch" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section aria-labelledby={titleId} aria-modal="true" className="flex max-h-[88dvh] w-full flex-col rounded-t-3xl border border-task-border bg-task-bg text-task-text shadow-lift duration-300 animate-in slide-in-from-bottom-8 motion-reduce:animate-none sm:max-h-none sm:w-[26rem] sm:rounded-none sm:rounded-l-2xl sm:slide-in-from-bottom-0 sm:slide-in-from-right-8"
      onKeyDown={trap} ref={panel} role="dialog" tabIndex={-1}>
      <header className="flex items-center justify-between gap-3 border-b border-task-border px-4 py-3">
        <h2 className="text-lg font-semibold" id={titleId}>{title}</h2>
        <Button aria-label="Close" className="size-11 p-0 text-task-text-muted hover:bg-task-muted hover:text-task-text" onClick={onClose} type="button" variant="ghost"><X /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      {footer ? <footer className="flex gap-2 border-t border-task-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</footer> : null}
    </section>
  </div>;
}

/** Progressive disclosure that works with Expand all / Collapse all. */
export function Disclosure({ summary, children, open, onToggle, meta }: { summary: ReactNode; children: ReactNode; open: boolean; onToggle: (open: boolean) => void; meta?: ReactNode }) {
  const id = useId();
  return <div className="rounded-xl border border-task-border">
    <h3><button aria-controls={id} aria-expanded={open} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold" onClick={() => onToggle(!open)} type="button">
      <span className="min-w-0 flex-1 text-sm font-semibold text-task-text">{summary}</span>
      {meta}
      <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-task-text-muted transition-transform motion-reduce:transition-none", open && "rotate-180")} />
    </button></h3>
    <div className="border-t border-task-border px-3 py-3" hidden={!open} id={id}>{children}</div>
  </div>;
}

/** A labelled 0–10 (or 0–100) bar; the number is always printed beside it. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return <div aria-label={label} aria-valuemax={max} aria-valuemin={0} aria-valuenow={value} className="h-1.5 w-full overflow-hidden rounded-full bg-task-muted" role="meter">
    <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
  </div>;
}

/** Shows a "Saved" style confirmation only after the server answered. */
export function useFlash(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(timer); }, [message]);
  return [message, setMessage];
}
