import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import {
  formatTaskPerformanceScore,
  performanceAttentionOrder,
  performanceScores,
  TASK_DELAYED_SCORE_LABEL,
  TASK_PENDING_SCORE_LABEL,
  type PerformanceEmployee,
  type PerformanceRecordSelector,
} from "@jewelos/core";

type SortKey = "attention" | "employee_name" | "branch_name" | "department_name" | "assigned" | "completed" | "inProgress" | "pending" | "overdue" | "remaining" | "pendingScore" | "onTime" | "late" | "delayedScore";

type Column = { key: SortKey; label: string; selector?: PerformanceRecordSelector; numeric?: boolean; tone?: "bad" | "good" | "warn" };

const COLUMNS: Column[] = [
  { key: "employee_name", label: "Employee" },
  { key: "branch_name", label: "Branch" },
  { key: "department_name", label: "Department" },
  { key: "assigned", label: "Total task", selector: "assigned", numeric: true },
  { key: "completed", label: "Done", selector: "completed", numeric: true, tone: "good" },
  { key: "inProgress", label: "In progress", selector: "in_progress", numeric: true },
  { key: "pending", label: "Pending", selector: "pending", numeric: true },
  { key: "overdue", label: "Overdue", selector: "overdue", numeric: true, tone: "bad" },
  { key: "remaining", label: "Not done", selector: "remaining", numeric: true },
  { key: "pendingScore", label: TASK_PENDING_SCORE_LABEL, numeric: true },
  { key: "onTime", label: "On time", selector: "on_time", numeric: true, tone: "good" },
  { key: "late", label: "Delayed", selector: "late", numeric: true, tone: "warn" },
  { key: "delayedScore", label: TASK_DELAYED_SCORE_LABEL, numeric: true },
];

const PREVIEW = 10;

export function EmployeeTable({
  employees,
  onOpenEmployee,
  onOpenCell,
}: {
  employees: PerformanceEmployee[];
  onOpenEmployee: (row: PerformanceEmployee) => void;
  onOpenCell: (row: PerformanceEmployee, selector: PerformanceRecordSelector, count: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "attention", desc: true });
  const [showAll, setShowAll] = useState(false);
  const [hideIdle, setHideIdle] = useState(false);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = employees.filter((row) =>
      (!hideIdle || row.assigned > 0) &&
      (!term || `${row.employee_name} ${row.branch_name ?? ""} ${row.department_name ?? ""}`.toLowerCase().includes(term)));
    if (sort.key === "attention") return performanceAttentionOrder(filtered).map((row) => ({ row, derived: performanceScores(row) }));
    const withScores = filtered.map((row) => ({ row, derived: performanceScores(row) }));
    const value = (item: (typeof withScores)[number]): string | number | null => {
      const key = sort.key;
      if (key === "employee_name" || key === "branch_name" || key === "department_name") return item.row[key] ?? "";
      if (key === "attention") return null;
      return item.derived[key];
    };
    return withScores.sort((left, right) => {
      const a = value(left);
      const b = value(right);
      // "No data" scores always sink to the bottom whatever the direction.
      if (a === null || b === null) return a === null && b === null ? 0 : a === null ? 1 : -1;
      const order = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
      return (sort.desc ? -order : order) || left.row.employee_name.localeCompare(right.row.employee_name);
    });
  }, [employees, query, sort, hideIdle]);

  const visible = showAll ? rows : rows.slice(0, PREVIEW);
  const toggle = (key: SortKey) =>
    setSort((old) => (old.key === key ? { key, desc: !old.desc } : { key, desc: !["employee_name", "branch_name", "department_name", "pendingScore", "delayedScore"].includes(key) }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Search employees</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-task-text-muted" />
          <input className="task-field min-h-10 w-full pl-9" onChange={(e) => setQuery(e.target.value)} placeholder="Search employee, branch, department" type="search" value={query} />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-xs text-task-text-muted">
          <input checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} type="checkbox" />
          Hide people with no work due
        </label>
        {sort.key !== "attention" ? (
          <button className="min-h-10 rounded-lg px-2 text-xs font-medium text-task-accent" onClick={() => setSort({ key: "attention", desc: true })} type="button">Sort by attention</button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-xl border border-task-border">
        <table className="w-full min-w-[64rem] text-left text-xs">
          <thead className="bg-task-muted text-[0.6875rem] uppercase tracking-wider text-task-text-muted">
            <tr>
              {COLUMNS.map((column) => (
                <th aria-sort={sort.key === column.key ? (sort.desc ? "descending" : "ascending") : "none"} className={`whitespace-nowrap px-2.5 py-2 font-semibold ${column.numeric ? "text-right" : ""} ${column.key === "employee_name" ? "sticky left-0 z-10 bg-task-muted" : ""}`} key={column.key} scope="col">
                  <button className={`inline-flex items-center gap-1 ${column.numeric ? "flex-row-reverse" : ""}`} onClick={() => toggle(column.key)} type="button">
                    {column.label}
                    {sort.key === column.key ? (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(({ row, derived }) => (
              <tr className="border-t border-task-border hover:bg-task-muted/60" key={row.user_profile_id}>
                <th className="sticky left-0 z-10 max-w-[13rem] bg-task-bg px-2.5 py-2 text-left font-medium" scope="row">
                  <button className="block max-w-full truncate text-left hover:text-task-accent hover:underline" onClick={() => onOpenEmployee(row)} title={`Open ${row.employee_name}'s performance`} type="button">
                    {row.employee_name}
                  </button>
                  {!row.active ? <span className="text-[0.625rem] font-normal text-task-text-muted">No longer active</span> : null}
                </th>
                <td className="whitespace-nowrap px-2.5 py-2 text-task-text-muted">{row.branch_name ?? "—"}</td>
                <td className="whitespace-nowrap px-2.5 py-2 text-task-text-muted">{row.department_name ?? "—"}</td>
                {COLUMNS.slice(3).map((column) => {
                  if (column.key === "pendingScore" || column.key === "delayedScore") {
                    const score = derived[column.key];
                    return <td className={`whitespace-nowrap px-2.5 py-2 text-right tabular-nums ${score === null ? "text-task-text-muted" : "font-semibold text-task-overdue"}`} key={column.key}>{formatTaskPerformanceScore(score)}</td>;
                  }
                  const count = derived[column.key as "assigned"];
                  const tone = count > 0 && column.tone === "bad" ? "font-semibold text-task-overdue" : count > 0 && column.tone === "warn" ? "text-warning" : count > 0 && column.tone === "good" ? "text-success" : count === 0 ? "text-task-text-muted" : "";
                  return (
                    <td className="px-1 py-1 text-right" key={column.key}>
                      {count > 0 && column.selector ? (
                        <button className={`min-h-8 min-w-8 rounded-md px-1.5 tabular-nums hover:bg-task-accent-soft hover:underline ${tone}`} onClick={() => onOpenCell(row, column.selector!, count)} title={`Open ${row.employee_name}: ${column.label}`} type="button">
                          {count.toLocaleString("en-IN")}
                        </button>
                      ) : <span className={`px-1.5 tabular-nums ${tone}`}>{count}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!visible.length ? <tr><td className="px-3 py-8 text-center text-sm text-task-text-muted" colSpan={COLUMNS.length}>No employees match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-task-text-muted">
        <span>{rows.length} employee{rows.length === 1 ? "" : "s"} · one row is one person; a task shared by two people counts for both. Done includes any completion without a recorded time, so On time + Delayed can be less than Done.</span>
        {rows.length > PREVIEW ? (
          <button className="min-h-10 rounded-lg border border-task-border px-3 font-medium text-task-text" onClick={() => setShowAll(!showAll)} type="button">
            {showAll ? "Show first 10" : `View all ${rows.length}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
