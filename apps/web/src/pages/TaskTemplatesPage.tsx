import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ListChecks, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Json } from "@jewelos/core";
import { supabase } from "@jewelos/api-client";
import { useAuth } from "@/auth/AuthContext";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { ErrorPanel, LoadingPanels } from "@/features/analytics/components";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { TaskTemplateForm } from "@/features/tasks/TaskForms";
import { loadAvailabilityUsers, loadTaskAuthoringReferenceData, type TaskReferenceData, type TaskTemplate, type TaskUser } from "@/features/tasks/api";
import { materializeRecurringTemplate, saveRecurringTemplate, setRecurringTemplateActive } from "@/features/recurringTodo/api";
import {
  deleteTaskTemplate, loadTaskTemplateDirectory, setTaskTemplateSchedule, templateFrequencyLabel,
  type TaskTemplateDirectoryRow,
} from "@/features/taskTemplates/api";
import { fetchReportingOptions, fetchTaskControlSnapshot, type ReportingOptions, type TaskControlSnapshot } from "@/features/taskControl/api";
import { TaskControlFilterBar } from "@/features/taskControl/FilterBar";
import { TasksTab } from "@/features/taskControl/TasksTab";
import { OverviewTab } from "@/features/taskControl/OverviewTab";
import { PeopleTab } from "@/features/taskControl/PeopleTab";
import { TemplatesTab } from "@/features/taskControl/TemplatesTab";
import {
  defaultFilters, rangeIsValid, tenantToday, TASK_CONTROL_TABS,
  type TaskControlFilters, type TaskControlTab,
} from "@/features/taskControl/filters";
import type { TaskView } from "@/features/taskEvidence/types";
import { errorMessage } from "@/lib/format";

const OVERSIGHT_ROLES = ["super_admin", "admin", "manager", "hr"];
const MANAGE_ROLES = ["super_admin", "admin"];
const BRANCH_SELECT_ROLES = ["super_admin", "admin", "hr"];

const TAB_LABELS: Readonly<Record<TaskControlTab, string>> = {
  overview: "Overview",
  people: "People",
  tasks: "Tasks",
  templates: "Templates",
};

const TAB_DESCRIPTIONS: Readonly<Record<TaskControlTab, string>> = {
  overview: "Who is behind, what is overdue, and which evidence is still missing.",
  people: "Assigned, completed, remaining and overdue work for every person in scope.",
  tasks: "Every task assigned in scope — checklist and upload alike — with its evidence on the row.",
  templates: "Recurring rules, schedules and source-linked task templates.",
};

function initialTab(available: readonly TaskControlTab[]): TaskControlTab {
  const requested = new URLSearchParams(window.location.search).get("tab") as TaskControlTab | null;
  return requested && available.includes(requested) ? requested : (available[0] ?? "overview");
}

/** The tab lives in the URL so a deep link opens the panel it names. */
function rememberTab(tab: TaskControlTab) {
  const params = new URLSearchParams(window.location.search);
  params.set("tab", tab);
  window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
}

/**
 * Task Control: one filtered workspace over the task templates directory, the
 * per-employee progress roll-up and the evidence workspace. They previously
 * lived in three places with three independent filter states, so no number on
 * one screen could be trusted against a number on another.
 */
export function TaskTemplatesPage() {
  const { profile } = useAuth();
  const role = profile?.user_role ?? "staff";
  const authorized = OVERSIGHT_ROLES.includes(role);
  const canManageTemplates = MANAGE_ROLES.includes(role);
  const tabs = useMemo<TaskControlTab[]>(
    () => TASK_CONTROL_TABS.filter((tab) => tab !== "templates" || canManageTemplates),
    [canManageTemplates],
  );

  const [tab, setTab] = useState<TaskControlTab>(() => initialTab(tabs));
  const [filters, setFilters] = useState<TaskControlFilters>(() => defaultFilters());
  const [view, setView] = useState<TaskView>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [snapshot, setSnapshot] = useState<TaskControlSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);

  const [templates, setTemplates] = useState<TaskTemplateDirectoryRow[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(canManageTemplates);

  const [options, setOptions] = useState<ReportingOptions>({ branches: [], departments: [] });
  const [users, setUsers] = useState<TaskUser[]>([]);
  const [references, setReferences] = useState<TaskReferenceData | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskTemplate | null | undefined>(undefined);
  const [scheduling, setScheduling] = useState<TaskTemplateDirectoryRow | null>(null);
  const [scheduleDate, setScheduleDate] = useState(tenantToday());

  useEffect(() => {
    if (!authorized) return;
    void fetchReportingOptions().then(setOptions).catch(() => setOptions({ branches: [], departments: [] }));
    void loadAvailabilityUsers().then(setUsers).catch(() => setUsers([]));
  }, [authorized]);

  const loadSnapshot = useCallback(async () => {
    if (!authorized) return;
    if (!rangeIsValid(filters)) {
      setSnapshotError("Choose a date range that ends on or after it starts and spans at most 366 days.");
      setSnapshotLoading(false);
      return;
    }
    setSnapshotLoading(true);
    setSnapshotError(null);
    try {
      setSnapshot(await fetchTaskControlSnapshot(filters, view, page, pageSize));
    } catch (caught) {
      setSnapshotError(errorMessage(caught));
    } finally {
      setSnapshotLoading(false);
    }
  }, [authorized, filters, page, pageSize, view]);

  const loadTemplates = useCallback(async () => {
    if (!canManageTemplates) return;
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const [directory, nextReferences] = await Promise.all([
        loadTaskTemplateDirectory({ search: filters.search }),
        loadTaskAuthoringReferenceData(),
      ]);
      setTemplates(directory.templates);
      setReferences(nextReferences);
    } catch (caught) {
      setTemplatesError(errorMessage(caught));
    } finally {
      setTemplatesLoading(false);
    }
  }, [canManageTemplates, filters.search]);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);
  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const refresh = useCallback(async () => { await Promise.all([loadSnapshot(), loadTemplates()]); }, [loadSnapshot, loadTemplates]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["tasks", "organization"], refresh });

  const changeTab = (next: TaskControlTab) => { setTab(next); rememberTab(next); };
  const changeFilters = (next: TaskControlFilters) => { setFilters(next); setPage(1); };
  const focusUser = (userProfileId: string, next: TaskControlTab) => {
    changeFilters({ ...filters, user_profile_id: userProfileId });
    changeTab(next);
  };

  // The templates directory already searched server-side; scope is applied here
  // because the directory row carries the same ids the shared filter selects.
  const visibleTemplates = useMemo(
    () => templates.filter((row) =>
      (!filters.branch_id || row.branch_id === filters.branch_id) &&
      (!filters.department_id || row.department_id === filters.department_id) &&
      (!filters.user_profile_id || row.assignee_user_id === filters.user_profile_id)),
    [templates, filters.branch_id, filters.department_id, filters.user_profile_id],
  );

  const run = async (row: TaskTemplateDirectoryRow, action: () => Promise<void>) => {
    setBusyId(row.id);
    setTemplatesError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      const message = errorMessage(caught);
      setTemplatesError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = async (row: TaskTemplateDirectoryRow) => {
    setBusyId(row.id);
    setTemplatesError(null);
    const { data, error: loadError } = await supabase.from("task_templates").select("*").eq("id", row.id).maybeSingle();
    setBusyId(null);
    if (loadError || !data) {
      const message = loadError ? loadError.message : "This task template is no longer available.";
      setTemplatesError(message);
      toast.error(message);
      return;
    }
    setEditing(data);
  };

  const save = async (id: string | null, payload: Json) => {
    const templateId = await saveRecurringTemplate(id, payload);
    await materializeRecurringTemplate(templateId, payload);
    setEditing(undefined);
    toast.success(id ? "Task template updated" : "Task added successfully");
    await refresh();
  };

  const toggle = (row: TaskTemplateDirectoryRow) =>
    void run(row, async () => {
      await setRecurringTemplateActive(row.id, !row.is_active);
      toast.success(row.is_active ? "Template deactivated" : "Template activated");
    });

  const remove = (row: TaskTemplateDirectoryRow) => {
    const confirmed = window.confirm(
      `Delete this task template: ${row.title}?\n\nPending, in-progress and overdue occurrences will also be removed. Completed work and history will be preserved.`,
    );
    if (!confirmed) return;
    void run(row, async () => {
      const result = await deleteTaskTemplate(row.id);
      toast.success(
        result.outcome === "deleted"
          ? `Task deleted. ${result.open_instances_removed} open occurrence(s) removed.`
          : `Task archived. ${result.open_instances_removed} open occurrence(s) removed, ${result.instances_preserved} completed record(s) preserved.`,
      );
    });
  };

  const openSchedule = (row: TaskTemplateDirectoryRow) => {
    setScheduleDate(row.starts_on ?? tenantToday());
    setScheduling(row);
  };

  const saveSchedule = async () => {
    if (!scheduling) return;
    const row = scheduling;
    if (!scheduleDate) {
      toast.error("Select a start date.");
      return;
    }
    setScheduling(null);
    await run(row, async () => {
      await setTaskTemplateSchedule(row.id, scheduleDate);
      await materializeRecurringTemplate(row.id);
      toast.success("Schedule saved");
    });
  };

  if (!authorized) return <Notice tone="danger">Task Control is available only to authorized leaders.</Notice>;

  const loading = tab === "templates" ? templatesLoading : snapshotLoading;
  const error = tab === "templates" ? templatesError : snapshotError;

  return (
    <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-bg pb-24 text-task-text sm:-m-6 md:min-h-[calc(100vh-4rem)] md:pb-10">
      <header className="border-b border-task-border bg-charcoal px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-gold p-2.5 text-obsidian">
              <ListChecks className="size-5" />
            </span>
            <div>
              <h1 className="font-display text-2xl text-gold sm:text-3xl">Task Control</h1>
              <p className="text-sm text-soft-grey">{TAB_DESCRIPTIONS[tab]}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {canManageTemplates ? (
              <Button className="bg-gold text-obsidian hover:bg-gold/90" onClick={() => setEditing(null)}>
                <Plus className="size-4" />
                Add Task
              </Button>
            ) : null}
            <Button disabled={loading} onClick={() => void refresh()} variant="secondary">
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
              Refresh
            </Button>
          </div>
        </div>
        <nav aria-label="Task Control sections" className="mx-auto mt-4 flex max-w-[100rem] gap-2 overflow-x-auto pb-1">
          {tabs.map((item) => (
            <button
              aria-current={tab === item ? "page" : undefined}
              className={
                tab === item
                  ? "min-h-9 shrink-0 rounded-full bg-gold px-4 text-sm font-semibold text-obsidian"
                  : "min-h-9 shrink-0 rounded-full bg-white/10 px-4 text-sm font-medium text-champagne hover:bg-white/15"
              }
              key={item}
              onClick={() => changeTab(item)}
              type="button"
            >
              {TAB_LABELS[item]}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-[100rem] space-y-4 p-4 sm:p-6">
        <TaskControlFilterBar
          canSelectBranch={BRANCH_SELECT_ROLES.includes(role)}
          filters={filters}
          onChange={changeFilters}
          onReset={() => changeFilters(defaultFilters())}
          options={options}
          showSearch={tab === "tasks" || tab === "templates"}
          users={users}
        />

        {loading ? <LoadingPanels count={4} />
          : error ? <ErrorPanel message={error} onRetry={() => void refresh()} />
          : tab === "templates" ? (
            <TemplatesTab
              busyId={busyId}
              onDelete={remove}
              onEdit={(row) => void openEdit(row)}
              onSchedule={openSchedule}
              onToggle={toggle}
              rows={visibleTemplates}
            />
          ) : snapshot ? (
            tab === "overview" ? (
              <OverviewTab
                evidence={snapshot.evidence}
                onOpenTab={changeTab}
                onSelectUser={(row) => focusUser(row.user_profile_id, "tasks")}
                progress={snapshot.progress}
              />
            ) : tab === "people" ? (
              <PeopleTab onSelectUser={(row) => focusUser(row.user_profile_id, "tasks")} progress={snapshot.progress} />
            ) : (
              <TasksTab
                evidence={snapshot.evidence}
                onPage={setPage}
                onPageSize={(size) => { setPageSize(size); setPage(1); }}
                onView={(next) => { setView(next); setPage(1); }}
                page={page}
                pageSize={pageSize}
                view={view}
              />
            )
          ) : null}
      </div>

      {editing !== undefined && references ? (
        <Modal onClose={() => setEditing(undefined)} title={editing ? "Edit task template" : "Add new task"} wide>
          <TaskTemplateForm data={references} onCancel={() => setEditing(undefined)} onSave={save} template={editing} />
        </Modal>
      ) : null}

      {scheduling ? (
        <Modal onClose={() => setScheduling(null)} title="Task schedule">
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm text-task-text-muted">
              <CalendarDays className="size-4 text-gold" />
              {[scheduling.assignee_name, scheduling.title, templateFrequencyLabel(scheduling)].filter(Boolean).join(" · ")}
            </p>
            <Field label="Task start date">
              <input className="task-field" onChange={(event) => setScheduleDate(event.target.value)} type="date" value={scheduleDate} />
            </Field>
            <Notice tone="task">
              Recurring schedules continue automatically from this date until the template is deactivated.
            </Notice>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setScheduling(null)} variant="secondary">Cancel</Button>
              <Button onClick={() => void saveSchedule()}>Save schedule</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {busyId ? <p className="sr-only" role="status">Working…</p> : null}
    </section>
  );
}
