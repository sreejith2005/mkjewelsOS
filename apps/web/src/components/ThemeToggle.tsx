import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type Theme = "light" | "dark";

export function ThemeToggle({ theme, onChange, className }: { theme: Theme; onChange: (theme: Theme) => void; className?: string }) {
  const isDark = theme === "dark";
  return <button aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={isDark} className={cn("inline-flex size-10 items-center justify-center rounded-lg border border-gold/25 bg-charcoal text-gold transition hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold", className)} onClick={() => onChange(isDark ? "light" : "dark")} type="button">{isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}<span className="sr-only">{isDark ? "Light mode" : "Dark mode"}</span></button>;
}
