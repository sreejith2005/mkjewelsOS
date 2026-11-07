import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ListChecks, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  canManageTaskTemplates, canSelectTaskControlBranch, canViewTaskControl,
  taskControlShowsSearch, taskControlTabsFor,
  TASK_CONTROL_TAB_DESCRIPTIONS,
  type Json, type TaskWorkKindFilter, hasPermission, isOnDemandSchedule, taskWorkKind,
} from "@jewelos/core";
import { supabase } from "@jewelos/api-client";
import { useAuth } from "@/auth/AuthContext";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { ErrorPanel, LoadingPanels } from "@/features/analytics/components";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { TaskTemplateForm } from "@/features/tasks/TaskForms";
import { loadAvailabilityUsers, loadTaskAuthoringReferenceData, startOnDemandDuty, type TaskReferenceData, type TaskTemplate, type TaskUser } from "@/features/tasks/api";
import { materializeRecurringTemplate, runRecurringTemplateNow, saveRecurringTemplate, setRecurringTemplateActive } from "@/features/recurringTodo/api";
import {
  deleteTaskTemplate, loadTaskTemplateDirectory, setTaskTemplateSchedule, templateFrequencyLabel,
  type TaskTemplateDirectoryRow,
} from "@/features/taskTemplates/api";
import { fetchReportingOptions, fetchTaskControlSnapshot, type ReportingOptions, type TaskControlSnapshot } from "@/features/taskControl/api";
import { TaskControlFilterBar } from "@/features/taskControl/FilterBar";
import { TasksTab } from "@/features/taskControl/TasksTab";
import { TaskManagement } from "@/features/taskControl/TaskManagement";
import { FmsWorkCancelDialog } from "@/features/taskControl/FmsWorkCancelDialog";
import { BulkDeleteDialog, type BulkDeleteRequest } from "@/features/taskControl/BulkDeleteDialog";
import { ReassignDialog, type ReassignRequest } from "@/features/taskControl/ReassignDialog";
import { OverviewTab } from "@/features/taskControl/OverviewTab";
import { PeopleTab } from "@/features/taskControl/PeopleTab";
import { TemplatesTab } from "@/features/taskControl/TemplatesTab";
import { ReviewTab } from "@/features/taskControl/ReviewTab";
import {
  defaultFilters, evidenceFilter, initialFiltersFromSearch, rangeIsValid, tenantToday,
  type TaskControlFilters, type TaskControlTab,
} from "@/features/taskControl/filters";
import type { TaskRow, TaskView } from "@/features/taskEvidence/types";
import { errorMessage } from "@/lib/format";

const TAB_LABELS: Readonly<Record<TaskControlTab, string>> = {
  overview: "Overview",
  people: "People",
  tasks: "Tasks",
  review: "Review",
  templates: "Templates",
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
  const { profile, access } = useAuth();
  const canAdministerTasks = access ? hasPermission(access, "tasks.view_all") : false;
  const role = profile?.user_role ?? "staff";
  const authorized = canViewTaskControl(role);
  const canManageTemplates = canManageTaskTemplates(role);
  const tabs = useMemo<TaskControlTab[]>(() => [...taskControlTabsFor(role)], [role]);

  const [tab, setTab] = useState<TaskControlTab>(() => initialTab(tabs));
  const [filters, setFilters] = useState<TaskControlFilters>(() => initialFiltersFromSearch(window.location.search));
  const [search, setSearch] = useState(filters.search);
  useEffect(() => { const timer = setTimeout(() => setSearch(filters.search), 250); return () => clearTimeout(timer); }, [filters.search]);
  const requestFilters = useMemo(() => ({ ...filters, search }), [filters.preset, filters.from, filters.to, filters.branch_id, filters.department_id, filters.user_profile_id, search]);
  const snapshotGeneration = useRef(0);
  const templatesGeneration = useRef(0);
  const [view, setView] = useState<TaskView>("all");
  // Tasks > "Anytime duties": the standing as-needed duties (templates), which have no dated task until started.
  const [dutiesSelected, setDutiesSelected] = useState(false);
  const [kind, setKind] = useState<TaskWorkKindFilter>("all");
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
  const [managedTaskId, setManagedTaskId] = useState<string | null>(null);
  const [deletingRow, setDeletingRow] = useState<TaskRow | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [bulkDelete, setBulkDelete] = useState<BulkDeleteRequest | null>(null);
  // `?reassign=1&user=<id>` (the Users page "Reassign tasks" button) opens the
  // dialog for that person's open work.
  const [reassign, setReassign] = useState<ReassignRequest | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("reassign") === "1" ? { selectedIds: null, fromUserId: params.get("user") ?? "" } : null;
  });
  const reassignNames = useMemo(() => ({
    branches: new Map(options.branches.map((item) => [item.id, item.name])),
    departments: new Map(options.departments.map((item) => [item.id, item.name])),
  }), [options]);
  const [reviewReload, setReviewReload] = useState(0);
  useEffect(() => { setSelectedTaskIds([]); }, [filters, view, kind, profile?.id, canAdministerTasks]);

  useEffect(() => {
    if (!authorized) return;
    void fetchReportingOptions().then(setOptions).catch(() => setOptions({ branches: [], departments: [] }));
    void loadAvailabilityUsers().then(setUsers).catch(() => setUsers([]));
  }, [authorized]);

  const loadSnapshot = useCallback(async () => {
    if (!authorized || tab === "review" || tab === "templates") return;
    if (!rangeIsValid(filters)) {
      setSnapshotError("Choose a date range that ends on or after it starts and spans at most 366 days.");
      setSnapshotLoading(false);
      return;
    }
    setSnapshotLoading(true);
    setSnapshotError(null);
    const request = ++snapshotGeneration.current;
    try {
      const next = await fetchTaskControlSnapshot(requestFilters, view, page, pageSize, kind);
      if (request === snapshotGeneration.current) setSnapshot(next);
    } catch (caught) {
      if (request === snapshotGeneration.current) setSnapshotError(errorMessage(caught));
    } finally {
      if (request === snapshotGeneration.current) setSnapshotLoading(false);
    }
  }, [authorized, requestFilters, kind, page, pageSize, view, tab]);

  const loadTemplates = useCallback(async () => {
    if (!canManageTemplates || !(tab === "templates" || (tab === "tasks" && dutiesSelected))) return;
    setTemplatesLoading(true);
    setTemplatesError(null);
    const request = ++templatesGeneration.current;
    try {
      const directory = await loadTaskTemplateDirectory({ search });
      if (request === templatesGeneration.current) setTemplates(directory.templates);
    } catch (caught) {
      if (request === templatesGeneration.current) setTemplatesError(errorMessage(caught));
    } finally {
      if (request === templatesGeneration.current) setTemplatesLoading(false);
    }
  }, [canManageTemplates, dutiesSelected, search, tab]);

  useEffect(() => { void loadSnapshot(); return () => { snapshotGeneration.current += 1; }; }, [loadSnapshot]);
  useEffect(() => { void loadTemplates(); return () => { templatesGeneration.current += 1; }; }, [loadTemplates]);

  const refresh = useCallback(async () => { setReviewReload((value) => value + 1); await Promise.all([loadSnapshot(), loadTemplates()]); }, [loadSnapshot, loadTemplates]);
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

  const dutyRows = useMemo(() => visibleTemplates.filter((row) => isOnDemandSchedule(row)), [visibleTemplates]);
  const showDuties = tab === "tasks" && dutiesSelected && canManageTemplates;

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
    try {
      const [{ data, error: loadError }, nextReferences] = await Promise.all([
        supabase.from("task_templates").select("*").eq("id", row.id).maybeSingle(),
        loadTaskAuthoringReferenceData(),
      ]);
      if (loadError || !data) throw new Error(loadError?.message ?? "This task template is no longer available.");
      setReferences(nextReferences);
      setEditing(data);
    } catch (cause) {
      const message = errorMessage(cause);
      setTemplatesError(message);
      toast.error(message);
    } finally { setBusyId(null); }
  };

  const openNew = async () => {
    setBusyId("new");
    try { setReferences(await loadTaskAuthoringReferenceData()); setEditing(null); }
    catch (cause) { toast.error(errorMessage(cause)); }
    finally { setBusyId(null); }
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

  const assignNow = (row: TaskTemplateDirectoryRow) =>
    void run(row, async () => {
      await startOnDemandDuty(row.id);
      toast.success(`Assigned now as high priority${row.assignee_name ? ` to ${row.assignee_name}` : ""}: ${row.title}`);
    });

  const runNow = (row: TaskTemplateDirectoryRow) =>
    void run(row, async () => {
      await runRecurringTemplateNow(row.id, tenantToday());
      toast.success(`Run now finished for ${row.title}. Today's occurrence exists if the schedule falls today.`);
    });

  /** A Review tile opens the matching recurring work in the Tasks tab. */
  const openRecurringTasks = (next: TaskView) => {
    setKind("recurring");
    setView(next);
    setPage(1);
    changeTab("tasks");
  };

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

  // Review loads and reports its own data.
  const loading = tab === "templates" ? templatesLoading : tab === "review" ? false : snapshotLoading || (showDuties && templatesLoading);
  const error = tab === "templates" ? templatesError : tab === "review" ? null : snapshotError ?? (showDuties ? templatesError : null);

  return (
    <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-bg pb-24 text-task-text sm:-m-6 md:min-h-[calc(100vh-4rem)] md:pb-10">
      {/* Header, tabs, filters and content share one left and right edge across the full width. */}
      <header className="border-b border-task-border bg-task-bg px-4 pt-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-xl bg-gold-sheen p-2 text-on-gold shadow-gold">
              <ListChecks className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-semibold leading-tight text-gold-secondary md:text-2xl">Task Control</h1>
              <p className="truncate text-xs text-soft-grey sm:text-sm">{TASK_CONTROL_TAB_DESCRIPTIONS[tab]}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {canManageTemplates ? (
              <Button disabled={busyId === "new"} className="bg-gold text-on-gold hover:bg-gold/90" onClick={() => void openNew()}>
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
        <nav aria-label="Task Control sections" className="scroll-x no-scrollbar -mx-4 mt-2 flex gap-1 px-4 sm:-mx-6 sm:px-6">
          {tabs.map((item) => (
            <button
              aria-current={tab === item ? "page" : undefined}
              className={
                tab === item
                  ? "relative min-h-11 shrink-0 px-3 text-sm font-semibold text-task-text after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-task-accent"
                  : "min-h-11 shrink-0 px-3 text-sm font-medium text-task-text-muted hover:text-task-text"
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

      <div className="space-y-4 p-4 sm:px-6 sm:py-5">
        <TaskControlFilterBar
          canSelectBranch={canSelectTaskControlBranch(role)}
          filters={filters}
          onChange={changeFilters}
          onReset={() => changeFilters(defaultFilters())}
          options={options}
          showSearch={taskControlShowsSearch(tab)}
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
              onAssignNow={assignNow}
              onRunNow={runNow}
              rows={visibleTemplates}
            />
          ) : tab === "review" ? (
            <ReviewTab filters={requestFilters} onOpenRecurringTasks={openRecurringTasks} reloadKey={reviewReload} />
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
                selection={canAdministerTasks ? { ids: selectedTaskIds, onChange: setSelectedTaskIds } : undefined}
                onBulkDelete={canAdministerTasks ? (selected) => setBulkDelete({ filter: evidenceFilter(filters, view, 1, 100, kind), selected, scopeLabel: filters.user_profile_id ? (users.find((user) => user.id === filters.user_profile_id)?.employee_name ?? "Selected employee") : "All employees matching these filters" }) : undefined}
                onReassign={canAdministerTasks ? (selected) => setReassign({ selectedIds: selected, fromUserId: filters.user_profile_id }) : undefined}
                onManage={canAdministerTasks ? setManagedTaskId : undefined}
                onDelete={canAdministerTasks ? setDeletingRow : undefined}
                evidence={snapshot.evidence}
                onPage={setPage}
                onPageSize={(size) => { setPageSize(size); setPage(1); }}
                onView={(next) => { setView(next); setPage(1); setDutiesSelected(false); }}
                anytime={canManageTemplates ? {
                  selected: showDuties,
                  count: showDuties || templates.length ? dutyRows.length : null,
                  onSelect: () => setDutiesSelected(true),
                  content: (
                    <div className="space-y-3">
                      <p className="text-sm text-task-text-muted">
                        Standing duties without a fixed time (As Required, Per Customer, After Visit and similar). Each person sees them under &quot;Anytime duties&quot; in My Tasks and starts one whenever it applies. Press &quot;Assign now&quot; to give one as high priority, &quot;Edit&quot; to change it, or &quot;Delete&quot; to remove it (open occurrences are removed; completed work is kept).
                      </p>
                      <TemplatesTab
                        busyId={busyId}
                        onDelete={remove}
                        onEdit={(row) => void openEdit(row)}
                        onSchedule={openSchedule}
                        onToggle={toggle}
                        onAssignNow={assignNow}
                        onRunNow={runNow}
                        rows={dutyRows}
                        emptyText="No anytime duties match these filters."
                      />
                    </div>
                  ),
                } : undefined}
                kind={kind}
                onKind={(next) => { setKind(next); setPage(1); }}
                page={page}
                pageSize={pageSize}
                view={view}
              />
            )
          ) : null}
      </div>

      {bulkDelete && canAdministerTasks ? <BulkDeleteDialog request={bulkDelete} onClose={() => setBulkDelete(null)} onFinished={async (result) => {
        setSelectedTaskIds(result.failed.filter((row) => row.kind !== "template").map((row) => row.id));
        if (page === 1) await refresh();
        else { setPage(1); await loadTemplates(); }
      }} /> : null}

      {reassign && canAdministerTasks ? <ReassignDialog branchNames={reassignNames.branches} departmentNames={reassignNames.departments} request={reassign}
        onClose={() => {
          setReassign(null);
          const params = new URLSearchParams(window.location.search);
          if (params.has("reassign")) { params.delete("reassign"); window.history.replaceState({}, "", `${window.location.pathname}?${params}`); }
        }}
        onFinished={async () => { setSelectedTaskIds([]); if (page === 1) await refresh(); else { setPage(1); await loadTemplates(); } }} /> : null}

      {editing !== undefined && references ? (
        <Modal onClose={() => setEditing(undefined)} title={editing ? "Edit task template" : "Add new task"} wide>
          <TaskTemplateForm data={references} initialAssigneeId={filters.user_profile_id} onCancel={() => setEditing(undefined)} onSave={save} template={editing} />
        </Modal>
      ) : null}

      {deletingRow && canAdministerTasks ? (() => {
        const kind = taskWorkKind(deletingRow);
        const done = async () => { setDeletingRow(null); if (page === 1) await refresh(); else { setPage(1); await loadTemplates(); } };
        return kind === "fms_step" || kind === "fms_start"
          ? <FmsWorkCancelDialog kind={kind} row={deletingRow} onClose={() => setDeletingRow(null)} onDone={done} />
          : <Modal title="Delete task" onClose={() => setDeletingRow(null)}><TaskManagement initialMode="delete" taskId={deletingRow.task_id} onChanged={done} /></Modal>;
      })() : null}

      {managedTaskId && canAdministerTasks ? <Modal title="Manage assigned task" onClose={() => setManagedTaskId(null)}>
        <TaskManagement taskId={managedTaskId} onChanged={async () => { setManagedTaskId(null); if (page === 1) await refresh(); else { setPage(1); await loadTemplates(); } }} />
      </Modal> : null}

      {scheduling ? (
        <Modal onClose={() => setScheduling(null)} title="Task schedule">
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm text-task-text-muted">
              <CalendarDays className="size-4 text-gold-secondary" />
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
