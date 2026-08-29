import { useCallback, useEffect, useMemo, useState } from "react";
import { kolkataDateKey } from "@jewelos/core";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  MessageSquareMore,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { Button, Modal, Notice } from "@/components/ui";
import { TaskTemplateForm } from "@/features/tasks/TaskForms";
import {
  loadTaskAuthoringReferenceData,
  completeRecurringTaskWithImage,
  updateTask,
  type TaskReferenceData,
} from "@/features/tasks/api";
import {
  loadFormDynamicOptions,
  loadTaskForms,
  submitForm,
  type FormBundle,
} from "@/features/forms/api";
import {
  FormRenderer,
  type DynamicOptions,
} from "@/features/forms/FormRenderer";
import {
  deleteRecurringTemplate,
  loadRecurringWorkspace,
  materializeRecurringTemplate,
  runRecurringTemplateNow,
  saveRecurringTemplate,
  sendRecurringFollowup,
  setRecurringTemplateActive,
  verifyRecurringTask,
  recurringInstanceDisplayStatus,
  recurringInstanceNeedsWork,
  EMPTY_RECURRING_STATS,
  type RecurringInstance,
  type RecurringTemplate,
  type RecurringWorkspace,
} from "@/features/recurringTodo/api";
import { titleCase } from "@/lib/format";

type Tab =
  | "today"
  | "overdue"
  | "rejected"
  | "completed"
  | "coverage"
  | "manager_review"
  | "my_work"
  | "schedules"
  | "verification"
  | "followups"
  | "performance";
const EMPTY: RecurringWorkspace = {
  templates: [],
  instances: [],
  stats: EMPTY_RECURRING_STATS,
};

function dateKey(date: Date): string {
  return kolkataDateKey(date);
}
function defaultRange(): [string, string] {
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 30);
  return [dateKey(from), dateKey(to)];
}
function dueLabel(value: string): string {
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function StatusPill({ task }: { task: RecurringInstance }) {
  const special = task.coverage_status;
  const displayStatus = recurringInstanceDisplayStatus(task);
  const label = special ?? displayStatus;
  const tone =
    special === "coverage_required" || displayStatus === "overdue"
      ? "bg-danger/15 text-danger"
      : special === "manager_review"
        ? "bg-warning/15 text-warning"
        : displayStatus === "completed"
          ? "bg-success/15 text-success"
          : "bg-gold/10 text-gold";
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${tone}`}
    >
      {titleCase(label ?? "pending")}
    </span>
  );
}

function WorkCard({
  task,
  canManage,
  followupEnabled,
  onChanged,
}: {
  task: RecurringInstance;
  canManage: boolean;
  followupEnabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const isOwnWork = task.assignees.some((assignee) => assignee.id === profile?.id);
  const canVerify = canManage || task.verifier_user_profile_id === profile?.id;
  const act = async (action: "start" | "complete") => {
    if (action === "complete") {
      // The doer's own remark, never a placeholder: a template that requires a
      // remark and an on-behalf completion both have to be explained.
      const needsRemark = Boolean(task.requires_remark) || !isOwnWork;
      const entered = needsRemark
        ? window.prompt(
            isOwnWork
              ? "Completion remark"
              : "Why are you completing this on behalf of the doer?",
          )
        : null;
      if (needsRemark && !entered?.trim()) return;
      await updateTask(
        task.id,
        "complete",
        entered?.trim() ? { remark: entered.trim() } : undefined,
      );
    } else {
      await updateTask(task.id, "start");
    }
    await onChanged();
  };
  const checklist = async (id: string, completed: boolean) => {
    await updateTask(task.id, "checklist", { checklistId: id, completed });
    await onChanged();
  };
  const followup = async () => {
    const message = window.prompt("Follow-up message");
    if (!message?.trim()) return;
    await sendRecurringFollowup(task.id, message);
    await onChanged();
  };
  const verify = async (decision: "verified" | "rejected") => {
    const note =
      decision === "rejected"
        ? (window.prompt("Why is this rejected?") ?? "")
        : "";
    if (decision === "rejected" && !note.trim()) return;
    await verifyRecurringTask(task.id, decision, note);
    await onChanged();
  };
  const canComplete =
    task.checklist
      .filter((item) => item.is_required)
      .every((item) => item.is_completed) &&
    (!task.requires_upload || task.has_attachment) &&
    (!task.requires_form || task.has_form_submission);
  return (
    <article className="rounded-2xl border border-gold/15 bg-charcoal p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-white">{task.title}</h3>
          <p className="mt-1 text-xs text-soft-grey">
            Start {dueLabel(task.planned_datetime)} · Due {dueLabel(task.revised_datetime ?? task.due_datetime ?? task.planned_datetime)} |{" "}
            {task.assignees.map((item) => item.name).join(", ") ||
              "Coverage required"}
          </p>
        </div>
        <StatusPill task={task} />
      </div>
      {task.description ? (
        <p className="mt-3 line-clamp-2 text-sm text-soft-grey">
          {task.description}
        </p>
      ) : null}
      {task.on_time_status ? (
        <p className="mt-2 text-xs text-soft-grey">
          <span className={task.on_time_status === "delayed" ? "text-danger" : "text-success"}>
            {task.on_time_status === "delayed"
              ? `Delayed by ${task.completion_delay_minutes ?? 0} min`
              : "On time"}
          </span>
          {task.completion_mode === "on_behalf" ? " · Completed on behalf" : null}
          {task.completion_remark ? ` · ${task.completion_remark}` : null}
        </p>
      ) : null}
      {task.status === "rejected" && task.verification_note ? (
        <p className="mt-2 text-xs text-danger">
          Returned for rework: {task.verification_note}
        </p>
      ) : null}
      {task.followups?.length ? (
        <details className="mt-3 rounded-lg border border-task-border p-2">
          <summary className="cursor-pointer text-xs text-task-text-muted">
            {task.followups.length} follow-up
            {task.followups.length === 1 ? "" : "s"}
            {task.last_followup_at
              ? ` · last ${dueLabel(task.last_followup_at)}`
              : null}
          </summary>
          <ul className="mt-2 space-y-1">
            {task.followups.map((entry) => (
              <li className="text-xs text-soft-grey" key={entry.id}>
                <span className="text-champagne">{entry.author ?? "System"}</span>{" "}
                · {dueLabel(entry.created_at)} — {entry.comment}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {!task.requires_form && task.checklist.length ? (
        <div className="mt-3 space-y-2">
          {task.checklist.map((item) => (
            <button
              className="flex w-full items-center gap-2 rounded-lg border border-task-border p-2 text-left text-xs text-soft-grey"
              key={item.id}
              onClick={() => void checklist(item.id, !item.is_completed)}
              type="button"
            >
              <span
                className={`flex size-4 items-center justify-center rounded border ${item.is_completed ? "border-gold bg-gold text-obsidian" : "border-task-border"}`}
              >
                {item.is_completed ? <Check className="size-3" /> : null}
              </span>
              {item.item_text}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {task.requires_form && task.status !== "completed" && task.coverage_status !== "coverage_required" ? <Button disabled={!task.form_template_id} onClick={() => window.dispatchEvent(new CustomEvent("recurring-form-request", { detail: task }))}><CheckCircle2 className="size-4" />Complete form</Button> : null}
        {!task.requires_form && task.task_type === "checklist" && task.status !== "completed" ? <Button aria-label="Complete checklist" onClick={() => void act("complete")}><CheckCircle2 className="size-4" />Complete checklist</Button> : null}
        {!task.requires_form && task.task_type !== "checklist" &&
        (task.status === "pending" || task.status === "rejected") &&
        task.coverage_status !== "coverage_required" ? (
          <Button onClick={() => void act("start")} variant="secondary">
            <Play className="size-4" />
            Start
          </Button>
        ) : null}
        {!task.requires_form && task.task_type !== "checklist" && task.status === "in_progress" && canComplete ? (
          <Button onClick={() => void act("complete")}>
            <CheckCircle2 className="size-4" />
            Complete
          </Button>
        ) : null}
        {!task.requires_form && task.task_type === "delegation" && task.requires_upload && !task.has_attachment ? (
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-gold/30 px-4 py-2 text-sm font-semibold text-gold">
            <Upload className="size-4" />
            Upload image to complete
            <input
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file && profile)
                  void completeRecurringTaskWithImage(
                    profile.tenant_id,
                    task.id,
                    file,
                  ).then(onChanged);
              }}
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              type="file"
            />
          </label>
        ) : null}
        {!task.requires_form && followupEnabled && canManage && task.status !== "completed" ? (
          <Button onClick={() => void followup()} variant="secondary">
            <MessageSquareMore className="size-4" />
            Follow up
          </Button>
        ) : null}
        {!task.requires_form && canVerify &&
        task.status === "completed" &&
        task.verification_status === "pending" ? (
          <>
            <Button onClick={() => void verify("verified")}>
              <ShieldCheck className="size-4" />
              Verify
            </Button>
            <Button onClick={() => void verify("rejected")} variant="danger">
              Reject
            </Button>
          </>
        ) : null}
      </div>
    </article>
  );
}

export function RecurringTodoPage() {
  const { profile } = useAuth();
  const [[dateFrom, dateTo], setRange] = useState(defaultRange);
  const [workspace, setWorkspace] = useState(EMPTY);
  const [references, setReferences] = useState<TaskReferenceData | null>(null);
  const [formBundles, setFormBundles] = useState<FormBundle[]>([]);
  const [formOptions, setFormOptions] = useState<DynamicOptions>({
    users: [],
    branches: [],
    departments: [],
  });
  const [formTarget, setFormTarget] = useState<RecurringInstance | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RecurringTemplate | null | undefined>(
    undefined,
  );
  // `get_recurring_todo_workspace` admits super_admin and admin only, so the
  // manager-only affordances this page used to render could never run.
  const canManage =
    !!profile && ["super_admin", "admin"].includes(profile.user_role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextWorkspace, nextReferences] = await Promise.all([
        loadRecurringWorkspace({
          date_from: dateFrom,
          date_to: dateTo,
          search,
          status: statusFilter,
          priority: priorityFilter,
          branch_id: branchFilter,
          department_id: departmentFilter,
          schedule_kind: kindFilter,
        }),
        loadTaskAuthoringReferenceData(),
      ]);
      const templateIds = [
        ...new Set(
          nextWorkspace.instances.flatMap((task) =>
            task.form_template_id ? [task.form_template_id] : [],
          ),
        ),
      ];
      const [forms, options] = await Promise.all([
        loadTaskForms(
          templateIds,
          nextWorkspace.instances.map((task) => task.id),
        ),
        loadFormDynamicOptions(),
      ]);
      setWorkspace(nextWorkspace);
      setReferences(nextReferences);
      setFormBundles(forms.bundles);
      setFormOptions(options);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load recurring work",
      );
    } finally {
      setLoading(false);
    }
  }, [branchFilter, dateFrom, dateTo, departmentFilter, kindFilter, priorityFilter, search, statusFilter]);
  useEffect(() => {
    void load();
  }, [load]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["tasks", "forms", "organization"], refresh: load });
  useEffect(() => {
    const open = (event: Event) =>
      setFormTarget((event as CustomEvent<RecurringInstance>).detail);
    window.addEventListener("recurring-form-request", open);
    return () => window.removeEventListener("recurring-form-request", open);
  }, []);

  const templateById = useMemo(
    () =>
      new Map(workspace.templates.map((template) => [template.id, template])),
    [workspace.templates],
  );
  const visibleTasks = useMemo(
    () =>
      workspace.instances.filter((task) => {
        const today = dateKey(new Date());
        const plannedDate = dateKey(new Date(task.planned_datetime));
        if (tab === "today")
          return plannedDate === today && task.status !== "completed";
        if (tab === "overdue")
          return recurringInstanceDisplayStatus(task) === "overdue";
        if (tab === "rejected") return task.status === "rejected";
        if (tab === "completed") return task.status === "completed";
        if (tab === "coverage")
          return task.coverage_status === "coverage_required";
        if (tab === "manager_review")
          return task.coverage_status === "manager_review";
        if (tab === "my_work")
          return task.assignees.some((assignee) => assignee.id === profile?.id);
        if (tab === "verification")
          return (
            task.status === "completed" &&
            task.verification_status === "pending"
          );
        if (tab === "followups")
          return (
            recurringInstanceNeedsWork(task) &&
            Boolean(
              task.task_template_id &&
                templateById.get(task.task_template_id)?.followup_enabled,
            )
          );
        return false;
      }),
    [profile?.id, tab, templateById, workspace.instances],
  );

  const performance = useMemo(() => {
    const rows = new Map<
      string,
      {
        name: string;
        assigned: number;
        completed: number;
        verified: number;
        onTime: number;
        delayed: number;
        onBehalf: number;
      }
    >();
    for (const task of workspace.instances)
      for (const assignee of task.assignees) {
        const current = rows.get(assignee.id) ?? {
          name: assignee.name,
          assigned: 0,
          completed: 0,
          verified: 0,
          onTime: 0,
          delayed: 0,
          onBehalf: 0,
        };
        current.assigned += 1;
        if (task.status === "completed") current.completed += 1;
        if (task.verification_status === "verified") current.verified += 1;
        if (task.on_time_status === "on_time") current.onTime += 1;
        if (task.on_time_status === "delayed") current.delayed += 1;
        if (task.completion_mode === "on_behalf") current.onBehalf += 1;
        rows.set(assignee.id, current);
      }
    return [...rows.values()].sort(
      (left, right) =>
        right.completed - left.completed || left.name.localeCompare(right.name),
    );
  }, [workspace.instances]);

  const save = async (
    id: string | null,
    payload: Parameters<typeof saveRecurringTemplate>[1],
  ) => {
    const templateId = await saveRecurringTemplate(id, payload);
    await materializeRecurringTemplate(templateId, payload);
    setEditing(undefined);
    await load();
  };
  const remove = async (template: RecurringTemplate) => {
    if (
      !window.confirm(
        `Delete ${template.title}? Used schedules will be archived to preserve task history.`,
      )
    )
      return;
    await deleteRecurringTemplate(template.id);
    await load();
  };
  const runNow = async (template: RecurringTemplate) => {
    await runRecurringTemplateNow(template.id, dateKey(new Date()));
    await load();
  };
  const toggleActive = async (template: RecurringTemplate) => {
    await setRecurringTemplateActive(template.id, !template.is_active);
    await load();
  };

  const tabs: Array<[Tab, string]> = [
    ["today", "Today"],
    ["overdue", "Overdue"],
    ["rejected", "Rejected"],
    ["completed", "Completed"],
    ["coverage", "Coverage Required"],
    ["manager_review", "Manager Review"],
    ["my_work", "My Work"],
    ["schedules", "Schedules"],
    ["verification", "Verification"],
    ["followups", "Follow-ups"],
    ["performance", "Performance"],
  ];
  return (
    <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-bg pb-24 text-task-text sm:-m-6 md:min-h-[calc(100vh-4rem)] md:pb-10">
      <header className="border-b border-task-border bg-charcoal px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-gold p-2.5 text-obsidian">
              <CalendarClock className="size-5" />
            </span>
            <div>
              <h1 className="font-display text-3xl text-gold">
                Recurring / To-Do List
              </h1>
              <p className="text-sm text-soft-grey">
                Schedules, daily work, verification, follow-ups, and
                profile-based coverage.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {canManage ? (
              <Button onClick={() => setEditing(null)}>
                <Plus className="size-4" />
                New schedule
              </Button>
            ) : null}
            <Button onClick={() => void load()} variant="secondary">
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {(
            [
              ["Total", workspace.stats.total],
              ["Pending", workspace.stats.pending],
              ["In progress", workspace.stats.in_progress],
              ["Completed", workspace.stats.completed],
              ["Overdue", workspace.stats.overdue],
              ["Rejected", workspace.stats.rejected],
              ["On time", workspace.stats.on_time],
              ["Delayed", workspace.stats.delayed],
              ["On behalf", workspace.stats.completed_on_behalf],
              ["Coverage required", workspace.stats.coverage_required],
              ["Manager review", workspace.stats.manager_review],
            ] as const
          ).map(([label, value]) => (
            <div
              className="rounded-xl border border-task-border bg-charcoal p-4"
              key={label}
            >
              <p className="text-xs uppercase text-task-text-muted">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-task-text">
                {value}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex gap-2 overflow-x-auto border-b border-task-border">
          {tabs.map(([value, label]) => (
            <button
              className={`shrink-0 border-b-2 px-3 py-3 text-sm ${tab === value ? "border-gold text-gold" : "border-transparent text-task-text-muted"}`}
              key={value}
              onClick={() => setTab(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_160px_auto]">
          <label className="relative">
            <Search className="absolute left-3 top-3 size-4 text-task-text-muted" />
            <input
              className="task-field pl-9"
              placeholder="Search schedules and tasks"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <input
            aria-label="From date"
            className="task-field"
            type="date"
            value={dateFrom}
            onChange={(event) => setRange([event.target.value, dateTo])}
          />
          <input
            aria-label="To date"
            className="task-field"
            min={dateFrom}
            type="date"
            value={dateTo}
            onChange={(event) => setRange([dateFrom, event.target.value])}
          />
          {canManage ? (
            <Button
              onClick={() => {
                window.history.pushState({}, "", "/tasks/import");
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
              variant="secondary"
            >
              Import schedules
            </Button>
          ) : null}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <select
            aria-label="Status"
            className="task-field"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {["pending", "in_progress", "completed", "rejected", "blocked"].map(
              (value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ),
            )}
          </select>
          <select
            aria-label="Priority"
            className="task-field"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <option value="">All priorities</option>
            {["high", "medium", "low"].map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
          <select
            aria-label="Branch"
            className="task-field"
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
          >
            <option value="">All branches</option>
            {(references?.branches ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Frequency"
            className="task-field"
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value)}
          >
            <option value="">All frequencies</option>
            {["daily", "weekly", "monthly", "quarterly", "yearly", "one_time", "as_required", "recurring"].map(
              (value) => (
                <option key={value} value={value}>
                  {titleCase(value.replace("_", " "))}
                </option>
              ),
            )}
          </select>
          <select
            aria-label="Department"
            className="task-field"
            value={departmentFilter}
            onChange={(event) => setDepartmentFilter(event.target.value)}
          >
            <option value="">All departments</option>
            {(references?.departments ?? [])
              .filter(
                (department) =>
                  !branchFilter || department.branch_id === branchFilter,
              )
              .map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
          </select>
        </div>
        {loading ? (
          <p className="py-16 text-center text-gold">
            Loading recurring work...
          </p>
        ) : tab === "schedules" ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {workspace.templates.map((template) => (
              <article
                className="rounded-2xl border border-task-border bg-charcoal p-4"
                key={template.id}
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">
                      {template.title}
                    </h3>
                    <p className="mt-1 text-xs text-soft-grey">
                      {titleCase(template.schedule_kind)} | Starts{" "}
                      {template.starts_on ?? "immediately"} |{" "}
                      {template.planned_time?.slice(0, 5)} |{" "}
                      {template.is_active ? "Active" : "Paused"}
                    </p>
                  </div>
                  <span className="rounded-full bg-gold/10 px-2 py-1 text-xs text-gold">
                    {template.recurrence_rule}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-soft-grey">
                  <span>{titleCase(template.priority ?? "medium")} priority</span>
                  {Array.isArray(template.checklist_items) &&
                  template.checklist_items.length ? (
                    <span>{template.checklist_items.length} checklist items</span>
                  ) : null}
                  {template.verification_required ? (
                    <span>Verification</span>
                  ) : null}
                  {template.followup_enabled ? <span>Follow-ups</span> : null}
                  {template.requires_upload ? <span>Upload</span> : null}
                  {template.requires_form ? <span>Form</span> : null}
                </div>
                {canManage ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      onClick={() => setEditing(template)}
                      variant="secondary"
                    >
                      Edit
                    </Button>
                    {template.schedule_kind !== "as_required" ? (
                      <Button
                        onClick={() => void toggleActive(template)}
                        variant="secondary"
                      >
                        {template.is_active ? "Pause" : "Activate"}
                      </Button>
                    ) : null}
                    <Button
                      disabled={
                        !template.is_active &&
                        template.schedule_kind !== "as_required"
                      }
                      onClick={() => void runNow(template)}
                    >
                      <Play className="size-4" />
                      Run now
                    </Button>
                    <Button
                      onClick={() => void remove(template)}
                      variant="danger"
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
            {workspace.templates.length === 0 ? (
              <p className="col-span-full py-16 text-center text-soft-grey">
                No recurring schedules yet.
              </p>
            ) : null}
          </div>
        ) : tab === "performance" ? (
          <div className="mt-5 overflow-x-auto rounded-2xl border border-task-border">
            <table className="w-full min-w-[540px] text-left text-sm">
              <thead className="bg-charcoal text-xs uppercase text-soft-grey">
                <tr>
                  <th className="p-3">Employee</th>
                  <th className="p-3">Assigned</th>
                  <th className="p-3">Completed</th>
                  <th className="p-3">Verified</th>
                  <th className="p-3">On time</th>
                  <th className="p-3">Delayed</th>
                  <th className="p-3">On behalf</th>
                  <th className="p-3">Completion</th>
                  <th className="p-3">On time %</th>
                </tr>
              </thead>
              <tbody>
                {performance.map((row) => (
                  <tr className="border-t border-task-border" key={row.name}>
                    <td className="p-3 font-semibold text-white">{row.name}</td>
                    <td className="p-3">{row.assigned}</td>
                    <td className="p-3">{row.completed}</td>
                    <td className="p-3">{row.verified}</td>
                    <td className="p-3">{row.onTime}</td>
                    <td className="p-3">{row.delayed}</td>
                    <td className="p-3">{row.onBehalf}</td>
                    <td className="p-3">
                      {row.assigned
                        ? Math.round((row.completed / row.assigned) * 100)
                        : 0}
                      %
                    </td>
                    <td className="p-3">
                      {row.onTime + row.delayed
                        ? Math.round(
                            (row.onTime / (row.onTime + row.delayed)) * 100,
                          )
                        : 0}
                      %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {performance.length === 0 ? (
              <p className="p-10 text-center text-soft-grey">
                No performance data in this date range.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {visibleTasks.map((task) => (
              <WorkCard
                canManage={canManage}
                followupEnabled={Boolean(
                  task.task_template_id &&
                    templateById.get(task.task_template_id)?.followup_enabled,
                )}
                key={task.id}
                onChanged={load}
                task={task}
              />
            ))}
            {visibleTasks.length === 0 ? (
              <div className="col-span-full py-16 text-center">
                <ClipboardCheck className="mx-auto size-10 text-gold" />
                <p className="mt-3 text-soft-grey">
                  No work matches this view.
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {editing !== undefined && references ? (
        <Modal
          onClose={() => setEditing(undefined)}
          title={editing ? "Edit recurring schedule" : "New recurring schedule"}
          wide
        >
          <TaskTemplateForm
            data={references}
            onCancel={() => setEditing(undefined)}
            onSave={save}
            template={editing}
          />
        </Modal>
      ) : null}
      {formTarget?.form_template_id
        ? (() => {
            const form = formBundles.find(
              (item) => item.id === formTarget.form_template_id,
            );
            return form ? (
              <Modal
                onClose={() => setFormTarget(null)}
                title={`Required form: ${form.name}`}
                wide
              >
                <FormRenderer
                  definition={{
                    name: form.name,
                    description: form.description ?? undefined,
                    fields: form.fields,
                  }}
                  dynamicOptions={formOptions}
                  onSubmit={async (answers) => {
                    await submitForm(
                      form.id,
                      answers,
                      formTarget.task_type === "delegation" ? "delegation_task" : "checklist_task",
                      formTarget.id,
                    );
                    setFormTarget(null);
                    await load();
                  }}
                />
              </Modal>
            ) : (
              <Modal onClose={() => setFormTarget(null)} title="Required form">
                <Notice tone="danger">
                  The required form version is not available to this account.
                </Notice>
              </Modal>
            );
          })()
        : null}
    </section>
  );
}
