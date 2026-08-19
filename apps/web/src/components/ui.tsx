import { useEffect, useId, useRef, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  const variants = {
    primary: "bg-gold text-obsidian hover:bg-gold-secondary",
    secondary: "border border-gold/30 bg-charcoal text-champagne hover:bg-gold/10",
    danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
    ghost: "text-soft-grey hover:bg-gold/10 hover:text-gold",
  } as const;
  return (
    <button
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
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
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  tone?: "dark" | "light";
  wide?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  onCloseRef.current = onClose;

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
      className="fixed inset-0 z-50 flex items-end justify-center bg-obsidian/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
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
          "max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl p-5 shadow-2xl sm:rounded-2xl",
          tone === "light" ? "border border-task-border bg-task-bg text-task-text" : "glass-card",
          wide ? "sm:max-w-4xl" : "sm:max-w-lg",
        )}
      >
        <header className="mb-5 flex items-center justify-between gap-4">
          <h2 className={cn("text-xl font-semibold", tone === "light" ? "text-task-text" : "font-display text-2xl text-gold")} id={titleId}>{title}</h2>
          <Button aria-label="Close dialog" className={cn("size-10 p-0", tone === "light" && "text-task-text-muted hover:bg-task-muted hover:text-task-text")} onClick={onClose} variant="ghost">
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
  return <div className={cn("rounded-lg border p-3 text-sm", tones[tone])}>{children}</div>;
}
