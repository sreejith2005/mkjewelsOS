import { useMemo } from "react";
import { RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui";
import type { TaskUser } from "@/features/tasks/api";
import type { ReportingOptions } from "./api";
import { applyBranch, applyPreset, RANGE_LABELS, RANGE_PRESETS, type RangePreset, type TaskControlFilters } from "./filters";

/**
 * The single filter every Task Control panel reads. Branch selection is hidden
 * from roles the server pins to their own branch, so the control never offers a
 * scope the RPC would reject.
 */
export function TaskControlFilterBar({
  filters,
  onChange,
  onReset,
  options,
  users,
  canSelectBranch,
  showSearch,
}: {
  filters: TaskControlFilters;
  onChange: (next: TaskControlFilters) => void;
  onReset: () => void;
  options: ReportingOptions;
  users: readonly TaskUser[];
  canSelectBranch: boolean;
  showSearch: boolean;
}) {
  const departments = useMemo(
    () => options.departments.filter((item) => !filters.branch_id || item.branch_id === null || item.branch_id === filters.branch_id),
    [options.departments, filters.branch_id],
  );
  const people = useMemo(
    () => users
      .filter((user) => (!filters.branch_id || user.branch_id === filters.branch_id) && (!filters.department_id || user.department_id === filters.department_id))
      .sort((left, right) => left.employee_name.localeCompare(right.employee_name)),
    [users, filters.branch_id, filters.department_id],
  );
  const set = (patch: Partial<TaskControlFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="space-y-3 rounded-2xl border border-task-border bg-charcoal p-4">
      <div className="scroll-x no-scrollbar flex gap-2 pb-1" role="group" aria-label="Date range">
        {RANGE_PRESETS.map((preset) => (
          <button
            aria-pressed={filters.preset === preset}
            className={
              filters.preset === preset
                ? "min-h-9 shrink-0 rounded-full bg-gold px-4 text-xs font-semibold text-obsidian"
                : "min-h-9 shrink-0 rounded-full bg-white/10 px-4 text-xs font-medium text-champagne hover:bg-white/15"
            }
            key={preset}
            onClick={() => onChange(applyPreset(filters, preset as RangePreset))}
            type="button"
          >
            {RANGE_LABELS[preset]}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {filters.preset === "custom" ? (
          <>
            <label className="block"><span className="mb-1 block text-xs font-medium text-task-text-muted">From</span>
              <input className="task-field" onChange={(event) => set({ from: event.target.value })} type="date" value={filters.from} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-task-text-muted">To</span>
              <input className="task-field" onChange={(event) => set({ to: event.target.value })} type="date" value={filters.to} /></label>
          </>
        ) : null}
        {canSelectBranch ? (
          <label className="block"><span className="mb-1 block text-xs font-medium text-task-text-muted">Branch</span>
            <select className="task-field" onChange={(event) => onChange(applyBranch(filters, event.target.value))} value={filters.branch_id}>
              <option value="">All authorized branches</option>
              {options.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
        ) : null}
        <label className="block"><span className="mb-1 block text-xs font-medium text-task-text-muted">Department</span>
          <select className="task-field" onChange={(event) => set({ department_id: event.target.value, user_profile_id: "" })} value={filters.department_id}>
            <option value="">All departments</option>
            {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-task-text-muted">User</span>
          <select className="task-field" onChange={(event) => set({ user_profile_id: event.target.value })} value={filters.user_profile_id}>
            <option value="">All users</option>
            {people.map((user) => <option key={user.id} value={user.id}>{user.employee_name}</option>)}
          </select></label>
        {showSearch ? (
          <label className="block"><span className="mb-1 block text-xs font-medium text-task-text-muted">Search</span>
            <span className="relative block">
              <Search className="absolute left-3 top-3 size-4 text-task-text-muted" />
              <input className="task-field pl-9" onChange={(event) => set({ search: event.target.value })} placeholder="Task, user or department" value={filters.search} />
            </span></label>
        ) : null}
        <div className="flex items-end">
          <Button className="w-full xl:w-auto" onClick={onReset} variant="secondary">
            <RotateCcw className="size-4" />
            Reset
          </Button>
        </div>
      </div>

      <p className="text-xs text-task-text-muted">
        {filters.from} → {filters.to}
        {filters.branch_id ? " · selected branch" : " · all authorized branches"}
        {filters.department_id ? " · selected department" : ""}
        {filters.user_profile_id ? " · one user" : ""}. Maximum range 366 days; manager scope stays fixed to your own branch.
      </p>
    </div>
  );
}
