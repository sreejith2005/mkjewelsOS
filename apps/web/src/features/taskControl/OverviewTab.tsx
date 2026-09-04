import { AlertTriangle, ArrowRight } from "lucide-react";
import { Panel } from "@/features/analytics/components";
import type { EmployeeProgress, EmployeeProgressRow } from "@/features/analytics/types";
import type { EvidenceWorkspace } from "@/features/taskEvidence/types";
import { CompletionBar, ProgressTable, StatTile } from "./panels";
import { completionRate, needsAttention, totals, type TaskControlTab } from "./filters";

const ATTENTION_LIMIT = 8;
const EVIDENCE_GAP_LIMIT = 5;

const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

/**
 * Task-level totals come from the evidence workspace, which counts each task
 * once; per-person totals come from employee progress, which counts a task once
 * per assignee. Every tile below says which of the two it is counting, because
 * summing the person rows would silently double-count shared tasks.
 */
export function OverviewTab({
  progress,
  evidence,
  onSelectUser,
  onOpenTab,
}: {
  progress: EmployeeProgress;
  evidence: EvidenceWorkspace;
  onSelectUser: (row: EmployeeProgressRow) => void;
  onOpenTab: (tab: TaskControlTab) => void;
}) {
  const stats = evidence.stats;
  const rate = stats.tasks_total === 0 ? 0 : Math.round((stats.completed / stats.tasks_total) * 100);
  const behind = needsAttention(progress.employees);
  const people = totals(progress.employees);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatTile hint="Each task counted once" label="Tasks in range" value={stats.tasks_total.toLocaleString("en-IN")} />
        <StatTile hint="Marked complete" label="Completed" tone="good" value={stats.completed.toLocaleString("en-IN")} />
        <StatTile hint="Completed ÷ tasks in range" label="Completion rate" tone={rate >= 80 ? "good" : rate >= 50 ? "warn" : "bad"} value={`${rate}%`} />
        <StatTile hint="Past the effective deadline" label="Overdue" tone={stats.overdue > 0 ? "bad" : "good"} value={stats.overdue.toLocaleString("en-IN")} />
        <StatTile hint="Upload required, no file yet" label="Awaiting evidence" tone={stats.upload_tasks_awaiting_evidence > 0 ? "warn" : "good"} value={stats.upload_tasks_awaiting_evidence.toLocaleString("en-IN")} />
      </div>

      <Panel
        description={`${behind.length} of ${progress.employees.length} people in scope still owe work. Ranked by overdue first, then backlog. Select a row to filter everything to that person.`}
        title="Needs attention"
      >
        {behind.length === 0 ? (
          <p className="py-6 text-center text-sm text-success">Everyone in this scope has cleared their assigned work.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {behind.slice(0, ATTENTION_LIMIT).map((row) => (
                <li key={row.user_profile_id}>
                  <button
                    className="flex w-full items-center gap-3 rounded-lg border border-task-border px-3 py-2 text-left hover:bg-gold/5"
                    onClick={() => onSelectUser(row)}
                    type="button"
                  >
                    {row.overdue > 0 ? <AlertTriangle className="size-4 shrink-0 text-task-overdue" /> : <span className="size-4 shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.employee_name}</span>
                      <span className="block truncate text-xs text-task-text-muted">
                        {row.branch_name}{row.department_name ? ` · ${row.department_name}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className={row.overdue > 0 ? "font-semibold text-task-overdue" : "text-task-text-muted"}>{row.overdue} overdue</span>
                      <span className="block text-task-text-muted">{row.remaining} of {row.assigned} left</span>
                    </span>
                    <CompletionBar row={row} />
                  </button>
                </li>
              ))}
            </ul>
            {behind.length > ATTENTION_LIMIT ? (
              <button className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-gold hover:underline" onClick={() => onOpenTab("people")} type="button">
                See all {behind.length} people <ArrowRight className="size-3" />
              </button>
            ) : null}
            <p className="mt-3 text-xs text-task-text-muted">
              Across everyone in scope: {people.completed} completed, {people.remaining} remaining, {people.overdue} overdue
              {people.assigned > 0 ? ` (${completionRate(people)}% of ${people.assigned} assignments)` : ""}. An assignment is one person on one task.
            </p>
          </>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel description="Every assignment rolled up by the assignee's branch." title="By branch">
          <ProgressTable columns={["Branch"]} empty="No task data in this range." head={(row) => <td className="px-2 py-2 font-medium">{row.branch_name}</td>} rows={progress.branches} />
        </Panel>
        <Panel description="Every assignment rolled up by the assignee's department." title="By department">
          <ProgressTable columns={["Department"]} empty="No task data in this range." head={(row) => <td className="px-2 py-2 font-medium">{row.department_name ?? "No department"}</td>} rows={progress.departments} />
        </Panel>
      </div>

      <Panel
        description={`${evidence.missing_total.toLocaleString("en-IN")} upload-required task${evidence.missing_total === 1 ? "" : "s"} still owe a file.`}
        title="Evidence gaps"
      >
        {evidence.missing.length === 0 ? (
          <p className="py-6 text-center text-sm text-success">Every upload-required task in this range has a file.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {evidence.missing.slice(0, EVIDENCE_GAP_LIMIT).map((row) => (
                <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-task-border px-3 py-2" key={row.task_id}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{row.task_title}</span>
                    <span className="block truncate text-xs text-task-text-muted">{row.assignee_names ?? "Unassigned"} · due {dateTime(row.due_datetime ?? row.planned_datetime)}</span>
                  </span>
                  <span className={`shrink-0 text-xs ${row.overdue ? "font-semibold text-task-overdue" : "text-warning"}`}>{row.overdue ? "Overdue, no file" : "No file yet"}</span>
                </li>
              ))}
            </ul>
            <button className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-gold hover:underline" onClick={() => onOpenTab("tasks")} type="button">
              Open the full task list <ArrowRight className="size-3" />
            </button>
          </>
        )}
      </Panel>
    </div>
  );
}
