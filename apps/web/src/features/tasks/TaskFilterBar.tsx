import { CalendarDays, Search } from "lucide-react";
import type { TaskFeedStatusFilter } from "@jewelos/core";
import { cn } from "@/lib/utils";

export type DateRangePreset = "today" | "week" | "month" | "custom";

const STATUS_DOT: Record<TaskFeedStatusFilter, string> = {
  all: "bg-task-text-muted",
  overdue: "bg-task-overdue",
  pending: "border-2 border-task-overdue bg-task-bg",
  in_progress: "bg-task-warning",
};

export function TaskFilterBar({ counts, endDate, onEndDateChange, onPresetChange, onSearchChange, onStartDateChange, onStatusChange, preset, search, startDate, status }: {
  counts: Record<TaskFeedStatusFilter, number>;
  endDate: string;
  onEndDateChange: (value: string) => void;
  onPresetChange: (value: DateRangePreset) => void;
  onSearchChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  onStatusChange: (value: TaskFeedStatusFilter) => void;
  preset: DateRangePreset;
  search: string;
  startDate: string;
  status: TaskFeedStatusFilter;
}) {
  const filters: TaskFeedStatusFilter[] = ["all", "overdue", "pending", "in_progress"];
  return (
    <section aria-label="Task filters" className="border-b border-task-border bg-task-bg">
      <div className="grid gap-3 p-3 sm:grid-cols-[180px_1fr] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-task-text-muted">Date Range</span>
          <span className="relative block">
            <CalendarDays className="pointer-events-none absolute left-3 top-3 size-4 text-task-text-muted" />
            <select className="task-field pl-9" onChange={(event) => onPresetChange(event.target.value as DateRangePreset)} value={preset}>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="custom">Custom Range</option>
            </select>
          </span>
        </label>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-task-text-muted" />
          <input className="task-field pl-9" onChange={(event) => onSearchChange(event.target.value)} placeholder="Search" value={search} />
        </label>
        {preset === "custom" ? <div className="grid grid-cols-2 gap-2 sm:col-span-2">
          <label><span className="sr-only">Start date</span><input className="task-field" onChange={(event) => onStartDateChange(event.target.value)} type="date" value={startDate} /></label>
          <label><span className="sr-only">End date</span><input className="task-field" min={startDate} onChange={(event) => onEndDateChange(event.target.value)} type="date" value={endDate} /></label>
        </div> : null}
      </div>
      <div className="grid grid-cols-4 bg-task-accent-soft px-1 pt-1">
        {filters.map((filter) => (
          <button
            aria-pressed={status === filter}
            className={cn("relative flex min-h-14 min-w-0 items-center justify-center gap-1 px-1 pb-1 text-[11px] font-medium text-task-text-muted sm:text-sm", status === filter && "text-task-text after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-task-accent")}
            key={filter}
            onClick={() => onStatusChange(filter)}
            type="button"
          >
            <span className={cn("size-3 shrink-0 rounded-full", STATUS_DOT[filter])} />
            <span>{filter === "in_progress" ? "In Progress" : filter[0]!.toUpperCase() + filter.slice(1)}</span>
            <span aria-label={`${counts[filter]} tasks`} className="tabular-nums">- {counts[filter]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
