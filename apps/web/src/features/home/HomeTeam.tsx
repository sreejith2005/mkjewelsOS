import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ChevronRight, Users } from "lucide-react";
import { canViewTaskControl } from "@jewelos/core";
import { fetchEmployeeTaskProgress } from "@/features/analytics/api";
import type { EmployeeProgress, ProgressCounts } from "@/features/analytics/types";
import { needsAttention, totals } from "@/features/taskControl/filters";

export type TeamToday = Readonly<{ progress: EmployeeProgress; summary: ProgressCounts }>;

/**
 * Leaders (the Task Control oversight roles) mostly delegate, so their own task
 * list is often empty. Home shows them today's team work from the same server
 * contract Task Control uses (get_employee_task_progress, default range = today),
 * which authorizes the caller and scopes managers to their branch. A failure only
 * hides the section; it never affects the personal work queue.
 */
export function useTeamToday(role: string | undefined): { team: TeamToday | null; refresh: () => void } {
  const enabled = !!role && canViewTaskControl(role);
  const [team, setTeam] = useState<TeamToday | null>(null);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) { setTeam(null); return; }
    let cancelled = false;
    fetchEmployeeTaskProgress({})
      .then((progress) => {
        const employees = progress.employees.map((row) => ({ ...row, overdue: Number.isFinite(row.overdue) ? row.overdue : 0 }));
        const departments = progress.departments.map((row) => ({ ...row, overdue: Number.isFinite(row.overdue) ? row.overdue : 0 }));
        if (!cancelled) setTeam({ progress: { ...progress, employees, departments }, summary: totals(employees) });
      })
      .catch(() => { if (!cancelled) setTeam(null); });
    return () => { cancelled = true; };
  }, [enabled, generation]);
  return { team, refresh };
}

const percent = (row: ProgressCounts) => (row.assigned ? Math.round((row.completed / row.assigned) * 100) : 0);

export function HomeTeamSection({ team, onNavigate }: Readonly<{ team: TeamToday; onNavigate: (path: string) => void }>) {
  const { summary, progress } = team;
  const people = needsAttention(progress.employees).slice(0, 8);
  const departments = [...progress.departments].filter((row) => row.assigned > 0).sort((a, b) => b.assigned - a.assigned).slice(0, 6);
  return (
    <section aria-labelledby="team-today-heading" className="mt-7">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold" id="team-today-heading">Team today</h2>
          <p className="mt-1 text-sm text-task-text-muted">Tasks scheduled today for the people you oversee.</p>
        </div>
        <button className="group inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-semibold text-gold-secondary transition-colors hover:bg-gold/10" onClick={() => onNavigate("/task-templates?tab=overview")} type="button">
          Task Control<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TeamTile label="Assigned" value={summary.assigned} />
        <TeamTile label="Done" value={summary.completed} tone="success" />
        <TeamTile label="Pending" value={summary.remaining} />
        <TeamTile label="Overdue" value={summary.overdue} tone={summary.overdue ? "danger" : undefined} />
      </div>
      {summary.assigned === 0 ? (
        <p className="mt-3 rounded-2xl border border-task-border bg-task-bg p-4 text-sm text-task-text-muted">No team tasks are scheduled for today.</p>
      ) : (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="min-w-0 rounded-2xl border border-task-border bg-task-bg p-4 shadow-card">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-task-text-muted">Needs follow-up</h3>
            {people.length ? (
              <ul aria-label="People with pending work" className="mt-2 divide-y divide-task-border">
                {people.map((row) => (
                  <li key={row.user_profile_id}>
                    <button className="group flex min-h-11 w-full items-center gap-3 py-2.5 text-left" onClick={() => onNavigate(`/task-templates?tab=tasks&user=${row.user_profile_id}`)} type="button">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-xs font-semibold text-gold-secondary">{initials(row.employee_name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{row.employee_name}</span>
                        <span className="block truncate text-xs text-task-text-muted">{row.department_name ?? row.branch_name} · {row.completed}/{row.assigned} done</span>
                      </span>
                      {row.overdue ? <span className="shrink-0 rounded-full bg-task-overdue/10 px-2 py-0.5 text-xs font-semibold text-task-overdue">{row.overdue} overdue</span>
                        : <span className="shrink-0 text-xs text-task-text-muted">{row.remaining} pending</span>}
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-task-text-muted group-hover:text-gold-secondary" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-task-text-muted">Everyone has finished today&apos;s tasks.</p>}
          </div>
          <div className="min-w-0 rounded-2xl border border-task-border bg-task-bg p-4 shadow-card">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-task-text-muted"><Users aria-hidden className="size-4" />By department</h3>
            <ul className="mt-3 space-y-3">
              {departments.map((row) => (
                <li key={row.department_id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{row.department_name}</span>
                    <span className="shrink-0 tabular-nums text-xs text-task-text-muted">{row.completed}/{row.assigned} · {percent(row)}%</span>
                  </div>
                  <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-task-muted">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${percent(row)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function TeamTile({ label, value, tone }: Readonly<{ label: string; value: number; tone?: "success" | "danger" | undefined }>) {
  return (
    <div className="rounded-2xl border border-task-border bg-task-bg p-3 shadow-card">
      <p className={`text-2xl font-semibold tabular-nums ${tone === "danger" ? "text-task-overdue" : tone === "success" ? "text-success" : ""}`}>{value.toLocaleString("en-IN")}</p>
      <p className="text-xs font-medium uppercase tracking-wide text-task-text-muted">{label}</p>
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}
