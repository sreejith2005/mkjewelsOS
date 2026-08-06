import type { ButtonHTMLAttributes, ReactNode } from "react";
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
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-obsidian/80 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section
        aria-modal="true"
        role="dialog"
        className={cn(
          "glass-card max-h-[94vh] w-full overflow-y-auto rounded-t-2xl p-5 sm:rounded-2xl",
          wide ? "sm:max-w-4xl" : "sm:max-w-lg",
        )}
      >
        <header className="mb-5 flex items-center justify-between gap-4">
          <h2 className="font-display text-2xl font-semibold text-gold">{title}</h2>
          <Button aria-label="Close dialog" className="h-9 w-9 p-0" onClick={onClose} variant="ghost">
            <X className="h-4 w-4" />
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

export function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "danger" | "success" }) {
  const tones = {
    neutral: "border-gold/20 bg-gold/5 text-champagne",
    danger: "border-danger/40 bg-danger/10 text-danger",
    success: "border-success/40 bg-success/10 text-success",
  } as const;
  return <div className={cn("rounded-lg border p-3 text-sm", tones[tone])}>{children}</div>;
}

