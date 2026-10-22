import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import {
  canManageRecurringWorkspace,
  formatTaskPerformanceScore,
  isRecurringInstanceInTab,
  kolkataDateKey,
  recurringPerformanceRows,
  recurringPerformanceScores,
  RECURRING_FREQUENCY_FILTERS,
  RECURRING_PRIORITY_FILTERS,
  TASK_DELAYED_SCORE_LABEL,
  TASK_PENDING_SCORE_LABEL,
  type RecurringTodoTab,
} from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { Modal, Notice } from "@/components/ui";
import { ErrorPanel, LoadingPanels } from "@/features/analytics/components";
import { loadFormDynamicOptions, loadTaskForms, type FormBundle } from "@/features/forms/api";
import type { DynamicOptions } from "@/features/forms/FormRenderer";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { TaskRequiredForm } from "@/features/tasks/TaskRequiredForm";
import { EMPTY_RECURRING_STATS, loadRecurringWorkspace, type RecurringInstance, type RecurringStats, type RecurringWorkspace } from "@/features/recurringTodo/api";
import type { TaskView } from "@/features/taskEvidence/types";
import { errorMessage, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RecurringWorkCard } from "./RecurringWorkCard";
import type { TaskControlFilters } from "./filters";

/**
 * The review buckets of the retired Recurring / To-Do page. Today, Completed
 * and My Work are not repeated here: Task Control → Tasks (type Recurring)
 * lists recurring work by date and status, and each employee's own work is in
 * Tasks. Schedules are the Templates tab.
 */
export type ReviewBucket = Extract<RecurringTodoTab, "verification" | "rejected" | "overdue" | "coverage" | "manager_review" | "followups" | "performance">;

export const REVIEW_BUCKETS: ReadonlyArray<readonly [ReviewBucket, string]> = [
  ["verification", "Verification"],
  ["rejected", "Rejected"],
  ["overdue", "Overdue"],
  ["coverage", "Coverage Required"],
  ["manager_review", "Manager Review"],
  ["followups", "Follow-ups"],
  ["performance", "Performance"],
];

type Tile = readonly [string, keyof RecurringStats | "awaiting_verification", { bucket: ReviewBucket } | { view: TaskView }];

/** Each tile opens the list that explains its number. */
const TILES: readonly Tile[] = [
  ["Total", "total", { view: "all" }],
  ["Pending", "pending", { view: "remaining" }],
  ["In progress", "in_progress", { view: "remaining" }],
  ["Completed", "completed", { view: "completed" }],
  ["Awaiting verification", "awaiting_verification", { bucket: "verification" }],
  ["Overdue", "overdue", { bucket: "overdue" }],
  ["Rejected", "rejected", { bucket: "rejected" }],
  ["On time", "on_time", { view: "completed" }],
  ["Delayed", "delayed", { view: "completed" }],
  ["On behalf", "completed_on_behalf", { view: "completed" }],
  ["Coverage required", "coverage_required", { bucket: "coverage" }],
  ["Manager review", "manager_review", { bucket: "manager_review" }],
];

const EMPTY: RecurringWorkspace = { templates: [], instances: [], stats: EMPTY_RECURRING_STATS };

function initialBucket(): ReviewBucket {
  const requested = new URLSearchParams(window.location.search).get("bucket");
  return REVIEW_BUCKETS.some(([value]) => value === requested) ? (requested as ReviewBucket) : "verification";
}

/**
 * Task Control → Review: verification, rejected and overdue recurring work,
 * coverage, follow-ups and recurring performance, read from
 * `get_recurring_todo_workspace` with Task Control's own date, branch,
 * department, person and search filters.
 */
export function ReviewTab({ filters, reloadKey, onOpenRecurringTasks }: {
  filters: TaskControlFilters;
  reloadKey: number;
  /** Opens Task Control → Tasks filtered to recurring work in one view. */
  onOpenRecurringTasks: (view: TaskView) => void;
}) {
  const { profile } = useAuth();
  const canManage = canManageRecurringWorkspace(profile?.user_role);
  const [bucket, setBucket] = useState<ReviewBucket>(initialBucket);
  const [priority, setPriority] = useState("");
  const [frequency, setFrequency] = useState("");
  const [workspace, setWorkspace] = useState<RecurringWorkspace>(EMPTY);
  const [formBundles, setFormBundles] = useState<FormBundle[]>([]);
  const [formOptions, setFormOptions] = useState<DynamicOptions>({ users: [], branches: [], departments: [], masters: [] });
  const [formTarget, setFormTarget] = useState<RecurringInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadRecurringWorkspace({
        date_from: filters.from, date_to: filters.to, search: filters.search, priority, schedule_kind: frequency,
        branch_id: filters.branch_id, department_id: filters.department_id,
      });
      const formIds = [...new Set(next.instances.flatMap((task) => (task.form_template_id ? [task.form_template_id] : [])))];
      setWorkspace(next);
      if (formIds.length) {
        const [forms, options] = await Promise.all([loadTaskForms(formIds, next.instances.map((task) => task.id)), loadFormDynamicOptions()]);
        setFormBundles(forms.bundles);
        setFormOptions(options);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [canManage, filters.branch_id, filters.department_id, filters.from, filters.search, filters.to, frequency, priority]);

  useEffect(() => { void load(); }, [load, reloadKey]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["tasks", "forms"], refresh: load });

  const changeBucket = (next: ReviewBucket) => {
    setBucket(next);
    const params = new URLSearchParams(window.location.search);
    params.set("bucket", next);
    window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
  };

  const templateFollowups = useMemo(() => new Map(workspace.templates.map((template) => [template.id, Boolean(template.followup_enabled)])), [workspace.templates]);
  // The workspace RPC has no person filter; the shared one is applied to the assignees here.
  const instances = useMemo(
    () => (filters.user_profile_id ? workspace.instances.filter((task) => task.assignees.some((assignee) => assignee.id === filters.user_profile_id)) : workspace.instances),
    [filters.user_profile_id, workspace.instances],
  );
  const today = kolkataDateKey(new Date());
  const inBucket = useCallback((task: RecurringInstance, tab: ReviewBucket) => isRecurringInstanceInTab({
    task, tab, viewerId: profile?.id, todayKey: today, plannedKey: kolkataDateKey(task.planned_datetime),
    followupEnabled: Boolean(task.task_template_id && templateFollowups.get(task.task_template_id)),
  }), [profile?.id, templateFollowups, today]);
  const visible = useMemo(() => (bucket === "performance" ? [] : instances.filter((task) => inBucket(task, bucket))), [bucket, inBucket, instances]);
  const counts = useMemo(() => Object.fromEntries(REVIEW_BUCKETS.map(([value]) => [value, value === "performance" ? 0 : instances.filter((task) => inBucket(task, value)).length])) as Record<ReviewBucket, number>, [inBucket, instances]);
  const performance = useMemo(() => recurringPerformanceRows(instances), [instances]);
  const stats = { ...workspace.stats, awaiting_verification: counts.verification };

  if (!canManage) return <Notice tone="danger">Review is available to administrators.</Notice>;
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-4" data-testid="task-control-review">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {TILES.map(([label, key, target]) => (
          <button
            className="rounded-xl border border-task-border bg-charcoal p-3 text-left transition-colors hover:border-gold/50 sm:p-4"
            key={label}
            onClick={() => ("bucket" in target ? changeBucket(target.bucket) : onOpenRecurringTasks(target.view))}
            type="button"
          >
            <span className="block text-[11px] uppercase leading-tight text-task-text-muted sm:text-xs">{label}</span>
            <span className="mt-1 block text-xl font-semibold tabular-nums text-task-text sm:text-2xl">{loading ? "…" : stats[key]}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-task-text-muted">
        Recurring occurrences planned in the selected dates. Each occurrence counts once; Performance counts each assignee of a shared occurrence.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Review lists" className="no-scrollbar flex flex-1 gap-2 overflow-x-auto pb-1">
          {REVIEW_BUCKETS.map(([value, label]) => (
            <button
              aria-current={bucket === value ? "page" : undefined}
              className={cn("min-h-9 shrink-0 rounded-full px-3 text-sm", bucket === value ? "bg-gold font-semibold text-on-gold" : "bg-white/10 text-champagne hover:bg-white/15")}
              key={value}
              onClick={() => changeBucket(value)}
              type="button"
            >
              {label}{value !== "performance" && !loading ? ` · ${counts[value]}` : ""}
            </button>
          ))}
        </nav>
        <select aria-label="Priority" className="task-field w-auto" onChange={(event) => setPriority(event.target.value)} value={priority}>
          <option value="">All priorities</option>
          {RECURRING_PRIORITY_FILTERS.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}
        </select>
        <select aria-label="Frequency" className="task-field w-auto" onChange={(event) => setFrequency(event.target.value)} value={frequency}>
          <option value="">All frequencies</option>
          {RECURRING_FREQUENCY_FILTERS.map((value) => <option key={value} value={value}>{titleCase(value.replace("_", " "))}</option>)}
        </select>
      </div>

      {loading ? <LoadingPanels count={2} /> : bucket === "performance" ? (
        <div className="overflow-x-auto rounded-2xl border border-task-border">
          <table className="w-full min-w-[540px] text-left text-sm">
            <thead className="bg-charcoal text-xs uppercase text-soft-grey">
              <tr>
                {["Employee", "Assigned", "Completed", "Verified", "On time", "Delayed", "On behalf"].map((header) => <th className="p-3" key={header}>{header}</th>)}
                <th className="whitespace-nowrap p-3">{TASK_PENDING_SCORE_LABEL}</th>
                <th className="whitespace-nowrap p-3">{TASK_DELAYED_SCORE_LABEL}</th>
              </tr>
            </thead>
            <tbody>
              {performance.map((row) => {
                const score = recurringPerformanceScores(row);
                return (
                  <tr className="border-t border-task-border" key={row.name}>
                    <td className="p-3 font-semibold text-white">{row.name}</td>
                    <td className="p-3">{row.assigned}</td>
                    <td className="p-3">{row.completed}</td>
                    <td className="p-3">{row.verified}</td>
                    <td className="p-3">{row.onTime}</td>
                    <td className="p-3">{row.delayed}</td>
                    <td className="p-3">{row.onBehalf}</td>
                    <td className={`p-3 tabular-nums ${score.pending === null ? "text-soft-grey" : "font-semibold text-task-overdue"}`}>{formatTaskPerformanceScore(score.pending)}</td>
                    <td className={`p-3 tabular-nums ${score.delayed === null ? "text-soft-grey" : "font-semibold text-task-overdue"}`}>{formatTaskPerformanceScore(score.delayed)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {performance.length === 0 ? <p className="p-10 text-center text-soft-grey">No recurring work in this date range.</p> : null}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((task) => (
            <RecurringWorkCard
              canManage={canManage}
              followupEnabled={Boolean(task.task_template_id && templateFollowups.get(task.task_template_id))}
              key={task.id}
              onChanged={load}
              onOpenForm={setFormTarget}
              task={task}
            />
          ))}
          {visible.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-task-border bg-charcoal py-16 text-center">
              <ClipboardCheck className="mx-auto size-10 text-gold-secondary" />
              <p className="mt-3 text-soft-grey">Nothing needs attention in this list.</p>
            </div>
          ) : null}
        </div>
      )}

      {formTarget?.form_template_id ? (() => {
        const form = formBundles.find((item) => item.id === formTarget.form_template_id);
        return form ? (
          <Modal onClose={() => setFormTarget(null)} title={`Required form: ${form.name}`} wide>
            <TaskRequiredForm
              definition={{ name: form.name, description: form.description ?? undefined, sections: form.sections, fields: form.fields }}
              dynamicOptions={formOptions}
              onCompleted={async () => { setFormTarget(null); await load(); }}
              requiresUpload={Boolean(formTarget.requires_upload)}
              taskId={formTarget.id}
              templateId={form.id}
            />
          </Modal>
        ) : (
          <Modal onClose={() => setFormTarget(null)} title="Required form">
            <Notice tone="danger">The required form version is not available to this account.</Notice>
          </Modal>
        );
      })() : null}
    </div>
  );
}
