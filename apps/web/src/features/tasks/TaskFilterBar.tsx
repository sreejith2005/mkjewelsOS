import type { TaskFeedStatusFilter } from "@jewelos/core";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<TaskFeedStatusFilter, string> = {
  all: "bg-task-text-muted",
  overdue: "bg-task-overdue",
  pending: "border-2 border-task-overdue bg-task-bg",
};

export function TaskFilterBar({ counts, onStatusChange, status }: {
  counts: Record<TaskFeedStatusFilter, number>;
  onStatusChange: (value: TaskFeedStatusFilter) => void;
  status: TaskFeedStatusFilter;
}) {
  const filters: TaskFeedStatusFilter[] = ["pending", "overdue", "all"];
  return (
    <section aria-label="Task filters" className="border-b border-task-border bg-task-bg">
      <div className="grid grid-cols-3 bg-task-accent-soft px-1 pt-1">
        {filters.map((filter) => (
          <button
            aria-pressed={status === filter}
            className={cn("relative flex min-h-14 min-w-0 items-center justify-center gap-1 px-1 pb-1 text-[11px] font-medium text-task-text-muted sm:text-sm", status === filter && "text-task-text after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-task-accent")}
            key={filter}
            onClick={() => onStatusChange(filter)}
            type="button"
          >
            <span className={cn("size-3 shrink-0 rounded-full", STATUS_DOT[filter])} />
            <span>{filter[0]!.toUpperCase() + filter.slice(1)}</span>
            <span aria-label={`${counts[filter]} tasks`} className="tabular-nums">- {counts[filter]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
