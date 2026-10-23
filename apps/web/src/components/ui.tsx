import { useEffect, useId, useRef, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  const variants = {
    // Dark ink on gold in both themes: white on gold failed contrast in the light theme.
    primary: "bg-gold-sheen text-on-gold shadow-gold hover:brightness-[1.05] hover:shadow-lift",
    secondary: "border border-gold/30 bg-charcoal text-champagne hover:border-gold/60 hover:bg-gold/10",
    danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
    ghost: "text-soft-grey hover:bg-gold/10 hover:text-gold-secondary",
  } as const;
  return (
    <button
      className={cn(
        "inline-flex min-h-10 select-none items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform,filter] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100 [&_svg]:shrink-0",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Modal({
  title,
  children,
  onClose,
  tone = "dark",
  wide = false,
  stickyHeader = true,
  mobileFullscreen = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  tone?: "dark" | "light";
  wide?: boolean;
  stickyHeader?: boolean;
  /** A keyboard-aware full-screen form on phones; desktop dialogs keep their size. */
  mobileFullscreen?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!mobileFullscreen || !window.visualViewport) return;
    const viewport = window.visualViewport;
    let focusFrame = 0;
    const fitViewport = () => {
      if (!backdropRef.current) return;
      backdropRef.current.style.height = `${viewport.height}px`;
      backdropRef.current.style.top = `${viewport.offsetTop}px`;
      // Keyboard opening can also pan the visual viewport. Keep the input in
      // the dialog's own scroll area, clear of its header and action bar.
      // Scroll after applying the new viewport height, so a field that fitted
      // before the keyboard opened is brought into the remaining space.
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused !== dialogRef.current && dialogRef.current?.contains(focused)) {
          focused.scrollIntoView?.({ block: "nearest", behavior: "instant" });
        }
      });
    };
    fitViewport();
    viewport.addEventListener("resize", fitViewport);
    viewport.addEventListener("scroll", fitViewport);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      viewport.removeEventListener("resize", fitViewport);
      viewport.removeEventListener("scroll", fitViewport);
    };
  }, [mobileFullscreen]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const preferred = dialogRef.current?.querySelector<HTMLElement>("[autofocus],[data-autofocus]");
      (preferred ?? dialogRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, []);

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
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
    <div
      ref={backdropRef}
      className={cn("fixed inset-0 z-50 flex items-end justify-center bg-obsidian/70 p-0 backdrop-blur-sm duration-200 animate-in fade-in sm:items-center sm:p-4", mobileFullscreen && "transition-none")}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className={cn(
          "max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl duration-300 ease-out animate-in slide-in-from-bottom-8 sm:max-h-[90dvh] sm:rounded-2xl sm:duration-200 sm:slide-in-from-bottom-0 sm:zoom-in-95",
          tone === "light" ? "border border-task-border bg-task-bg text-task-text" : "glass-card",
          wide ? "sm:max-w-4xl" : "sm:max-w-lg",
          // Duration utilities otherwise transition every property, including
          // height: that delay hides the focused field during keyboard resize.
          mobileFullscreen && "h-full max-h-full rounded-none pt-0 scroll-pb-24 scroll-pt-20 transition-none sm:h-auto sm:max-h-[90dvh] sm:rounded-2xl",
        )}
      >
        {/* Filling forms can let the title scroll with the questions. */}
        <header
          className={cn(
            "-mx-5 -mt-5 mb-5 flex items-center justify-between gap-3 px-5 pb-3 pt-2 sm:pt-5",
            // A sticky edge sits inside the dialog's p-5 padding; -top-5 pins the
            // header to the real top edge so scrolled content cannot show above it.
            stickyHeader && (mobileFullscreen ? "sticky top-0 z-10" : "sticky -top-5 z-10"),
            // Full-screen forms start at the scrollport edge. Avoid a negative
            // vertical margin on this sticky header, including its paint area.
            mobileFullscreen && "mt-0",
            tone === "light" ? "bg-task-bg" : "bg-charcoal",
          )}
        >
          <span aria-hidden className="absolute inset-x-0 top-2 mx-auto h-1 w-10 rounded-full bg-task-text-muted/40 sm:hidden" />
          <h2 className={cn("min-w-0 flex-1 pt-4 text-lg font-semibold sm:pt-0 sm:text-xl", tone === "light" ? "text-task-text" : "font-display text-2xl text-gold-secondary")} id={titleId}>{title}</h2>
          <Button aria-label="Close dialog" className={cn("mt-4 size-11 shrink-0 p-0 sm:mt-0", tone === "light" && "text-task-text-muted hover:bg-task-muted hover:text-task-text")} onClick={onClose} variant="ghost">
            <X />
          </Button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "danger" | "success" | "task" }) {
  const tones = {
    neutral: "border-gold/20 bg-gold/5 text-champagne",
    danger: "border-danger/40 bg-danger/10 text-danger",
    success: "border-success/40 bg-success/10 text-success",
    task: "border-task-border bg-task-bg text-task-text-muted",
  } as const;
  return <div className={cn("rounded-xl border p-3 text-sm leading-relaxed", tones[tone])}>{children}</div>;
}
