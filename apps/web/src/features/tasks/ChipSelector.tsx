import type { ComponentType, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function ChipSelector({ active, children, Icon, label, onClick, summary }: {
  active: boolean;
  children?: ReactNode;
  Icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  summary?: string | undefined;
}) {
  return (
    <button
      aria-expanded={active}
      className={cn(
        "inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
        active ? "border-task-accent bg-task-accent-soft text-task-text" : "border-task-border bg-task-bg text-task-text-muted",
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{summary || label}</span>
      {children}
      <ChevronDown className={cn("size-3 shrink-0 transition-transform", active && "rotate-180")} />
    </button>
  );
}
