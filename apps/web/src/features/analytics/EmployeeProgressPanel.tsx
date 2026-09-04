import type { ReactNode } from "react";
import { useAsyncData } from "./useAsyncData";
import { fetchEmployeeTaskProgress } from "./api";
import type { EmployeeProgress } from "./types";
import { Panel } from "./components";

type ProgressRow = Readonly<{ assigned: number; completed: number; remaining: number }>;
type RollupRow = ProgressRow & Readonly<{ branch_id?: string; branch_name?: string; department_id?: string; department_name?: string | null }>;

function RollupTable({ children, rows }: { children: (row: RollupRow) => ReactNode; rows: RollupRow[] }) {
  return rows.length ? <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr><th>Scope</th><th>Assigned</th><th>Completed</th><th>Remaining</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.branch_id ?? row.department_id)}>{children(row)}</tr>)}</tbody></table></div> : <p className="py-4 text-sm text-task-text-muted">No task data in this range.</p>;
}

function Summary({ progress }: { progress: EmployeeProgress }) {
  const totals = progress.employees.reduce<ProgressRow>((result, row) => ({ assigned: result.assigned + row.assigned, completed: result.completed + row.completed, remaining: result.remaining + row.remaining }), { assigned: 0, completed: 0, remaining: 0 });
  return <div className="grid gap-3 sm:grid-cols-3">{(["Assigned", "Completed", "Remaining"] as const).map((label) => <div className="rounded-lg border border-task-border bg-task-muted p-3" key={label}><p className="text-xs text-task-text-muted">{label}</p><p className="mt-1 text-2xl font-semibold">{totals[label.toLowerCase() as keyof ProgressRow]}</p></div>)}</div>;
}

export function EmployeeProgressPanel({ context, role }: { context: Readonly<Record<string, string>>; role: string }) {
  const allowed = ["super_admin", "admin", "manager", "hr"].includes(role);
  const { data, error, loading } = useAsyncData(() => allowed ? fetchEmployeeTaskProgress(context) : Promise.resolve(null), [allowed, context]);
  if (!allowed) return null;
  return <div className="space-y-4">{loading ? <Panel description="Assigned, completed, and remaining work within your authorized scope." title="Employee Task Progress"><p className="py-4 text-sm text-task-text-muted">Loading employee progress…</p></Panel> : error ? <Panel description="Assigned, completed, and remaining work within your authorized scope." title="Employee Task Progress"><p className="py-4 text-sm text-task-overdue">Employee progress could not load.</p></Panel> : data ? <><Summary progress={data} /><Panel description="Task totals for every employee in your authorized scope." title="By employee"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr><th>Employee</th><th>Branch</th><th>Department</th><th>Assigned</th><th>Completed</th><th>Remaining</th></tr></thead><tbody>{data.employees.map((row) => <tr key={row.user_profile_id}><td>{row.employee_name}</td><td>{row.branch_name}</td><td>{row.department_name ?? "—"}</td><td>{row.assigned}</td><td>{row.completed}</td><td>{row.remaining}</td></tr>)}</tbody></table></div>{data.employees.length === 0 ? <p className="py-4 text-sm text-task-text-muted">No employee task data in this range.</p> : null}</Panel><div className="grid gap-4 lg:grid-cols-2"><Panel description="Roll-up of all employees in each branch." title="By branch"><RollupTable rows={data.branches}>{(row) => <><td>{row.branch_name}</td><td>{row.assigned}</td><td>{row.completed}</td><td>{row.remaining}</td></>}</RollupTable></Panel><Panel description="Roll-up of all employees in each department." title="By department"><RollupTable rows={data.departments}>{(row) => <><td>{row.department_name ?? "No department"}</td><td>{row.assigned}</td><td>{row.completed}</td><td>{row.remaining}</td></>}</RollupTable></Panel></div></> : null}</div>;
}
