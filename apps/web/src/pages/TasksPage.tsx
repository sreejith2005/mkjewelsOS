import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, RefreshCw, Upload } from "lucide-react";
import { countTaskFeedStatuses, deriveTaskMutationCapability, taskMatchesStatus, type TaskFeedStatusFilter } from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { Button, Modal, Notice } from "@/components/ui";
import {
  createDelegationTask,
  createFromTemplate,
  delegateTask,
  loadTaskFeed,
  loadTaskAuthoringReferenceData,
  loadTaskFeedReferenceData,
  reviseTask,
  saveTaskTemplate,
  updateTask,
  uploadTaskAttachment,
  type TaskBundle,
  type TaskReferenceData,
  type TaskTemplate,
} from "@/features/tasks/api";
import { DelegateTaskModal } from "@/features/tasks/DelegateTaskModal";
import { TaskCard, type TaskCardAction } from "@/features/tasks/TaskCard";
import { TaskComposer } from "@/features/tasks/TaskComposer";
import { TaskImportDialog } from "@/features/tasks/import/TaskImportDialog";
import { TaskFilterBar, type DateRangePreset } from "@/features/tasks/TaskFilterBar";
import { TaskTemplateForm } from "@/features/tasks/TaskForms";
import { loadFormDynamicOptions, loadTaskForms, submitForm, type FormBundle } from "@/features/forms/api";
import { FormRenderer, type DynamicOptions } from "@/features/forms/FormRenderer";

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeForPreset(preset: Exclude<DateRangePreset, "custom">): [string, string] {
  const now = new Date();
  if (preset === "today") return [dateKey(now), dateKey(now)];
  if (preset === "week") {
    const start = new Date(now);
    const weekday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - weekday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return [dateKey(start), dateKey(end)];
  }
  return [dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
}

type TaskWorkspaceView = "mine" | "delegated";

export function TasksPage() {
  const { profile } = useAuth();
  const initialRange = useMemo(() => rangeForPreset("month"), []);
  const [preset, setPreset] = useState<DateRangePreset>("month");
  const [startDate, setStartDate] = useState(initialRange[0]);
  const [endDate, setEndDate] = useState(initialRange[1]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskFeedStatusFilter>("pending");
  const [myTasks, setMyTasks] = useState<TaskBundle[]>([]);
  const [delegatedTasks, setDelegatedTasks] = useState<TaskBundle[]>([]);
  const [workspaceView, setWorkspaceView] = useState<TaskWorkspaceView>("mine");
  const [categories, setCategories] = useState<TaskReferenceData["categories"]>([]);
  const [references, setReferences] = useState<TaskReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [delegateTarget, setDelegateTarget] = useState<TaskBundle | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editTemplate, setEditTemplate] = useState<TaskTemplate | null | undefined>(undefined);
  const [formBundles, setFormBundles] = useState<FormBundle[]>([]);
  const [formDynamicOptions, setFormDynamicOptions] = useState<DynamicOptions>({ users: [], branches: [], departments: [] });
  const [formTarget, setFormTarget] = useState<TaskBundle | null>(null);
  const canManage = profile ? ["super_admin", "admin", "manager"].includes(profile.user_role) : false;

  const refresh = useCallback(async () => {
    if (!profile || !startDate || !endDate) return;
    setLoading(true);
    setError(null);
    try {
      const start = new Date(`${startDate}T00:00:00`).toISOString();
      const end = new Date(`${endDate}T23:59:59.999`).toISOString();
      const [nextMyTasks, nextDelegatedTasks, nextCategories] = await Promise.all([
        loadTaskFeed(profile.id, start, end, { includeBlockedCoverage: canManage }),
        loadTaskFeed(profile.id, start, end, { delegated: true }),
        loadTaskFeedReferenceData().catch(() => ({ categories: [] })),
      ]);
      const nextTasks = [...nextMyTasks, ...nextDelegatedTasks.filter((task) => !nextMyTasks.some((myTask) => myTask.id === task.id))];
      const [forms, dynamicOptions] = await Promise.all([
        loadTaskForms([...new Set(nextTasks.flatMap((task) => task.requires_form && task.form_template_id ? [task.form_template_id] : []))], nextTasks.flatMap((task) => task.id ? [task.id] : [])),
        loadFormDynamicOptions(),
      ]);
      setMyTasks(nextMyTasks);
      setDelegatedTasks(nextDelegatedTasks);
      setCategories(nextCategories.categories);
      setFormBundles(forms.bundles);
      setFormDynamicOptions(dynamicOptions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load tasks");
    } finally {
      setLoading(false);
    }
  }, [canManage, endDate, profile, startDate]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openComposer = useCallback(async () => {
    try { setError(null); setReferences(await loadTaskAuthoringReferenceData()); setComposerOpen(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load task authoring options"); }
  }, []);

  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.label])), [categories]);
  const tasks = workspaceView === "mine" ? myTasks : delegatedTasks;
  const counts = useMemo(() => countTaskFeedStatuses(tasks), [tasks]);
  const scopedTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks.filter((task) => taskMatchesStatus(task, statusFilter) && (!query || [
      task.title,
      task.description,
      task.assigneeName,
      task.category_id ? categoryNames.get(task.category_id) : "",
    ].join(" ").toLowerCase().includes(query)));
  }, [categoryNames, search, statusFilter, tasks]);

  const handlePresetChange = (next: DateRangePreset) => {
    setPreset(next);
    if (next !== "custom") {
      const [start, end] = rangeForPreset(next);
      setStartDate(start);
      setEndDate(end);
    }
  };

  const handleAction = async (task: TaskBundle, action: TaskCardAction) => {
    if (!task.id || !profile) throw new Error("Task identifier is missing");
    const capability = deriveTaskMutationCapability({
      assigneeIds: task.assignees.map((assignee) => assignee.id),
      isWatcher: task.isWatchedByViewer,
      viewerId: profile.id,
      viewerRole: profile.user_role,
    });
    if (!capability.canMutate) throw new Error("You do not have permission to update this task");
    if (action.kind === "delegate") {
      setDelegateTarget(task);
      return;
    }
    if (action.kind === "fill_form") { setFormTarget(task); return; }
    if (action.kind === "upload") await uploadTaskAttachment(profile.tenant_id, task.id, action.file);
    else if (action.kind === "revise") await reviseTask(task.id, action.datetime, action.reason);
    else if (action.kind === "checklist") await updateTask(task.id, "checklist", { checklistId: action.checklistId, completed: action.completed });
    else if (action.kind === "complete") await updateTask(task.id, "complete", { remark: action.remark });
    else await updateTask(task.id, "start");
    await refresh();
  };

  return (
    <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-bg pb-24 text-task-text sm:-m-6 md:min-h-[calc(100vh-4rem)] md:pb-10">
      <h1 className="sr-only">Tasks</h1>
      <div className="hidden items-center justify-between border-b border-task-border px-6 py-4 md:flex">
        <div><h2 className="text-2xl font-semibold text-task-text">Tasks</h2><p className="text-sm text-task-text-muted">Assigned, watched, coverage-blocked, and delegated work in one place.</p></div>
      </div>

      <div className="flex gap-2 overflow-x-auto border-b border-task-border bg-task-bg px-3 pt-3 sm:px-5">
        {([
          ["mine", "My Tasks", myTasks.length],
          ["delegated", "Delegated", delegatedTasks.length],
        ] as const).map(([view, label, count]) => <button
          aria-pressed={workspaceView === view}
          className={`relative shrink-0 px-3 pb-3 text-sm font-medium ${workspaceView === view ? "text-task-text after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-task-accent" : "text-task-text-muted"}`}
          key={view}
          onClick={() => setWorkspaceView(view)}
          type="button"
        >
          {label} <span className="tabular-nums">({count})</span>
        </button>)}
      </div>

      <TaskFilterBar counts={counts} endDate={endDate} onEndDateChange={setEndDate} onPresetChange={handlePresetChange} onSearchChange={setSearch} onStartDateChange={setStartDate} onStatusChange={setStatusFilter} preset={preset} search={search} startDate={startDate} status={statusFilter} />

      <div className="w-full p-3 sm:p-5">
        {error ? <div className="flex flex-col gap-3 rounded-xl border border-danger/40 bg-danger/10 p-4"><Notice tone="danger">{error}</Notice><Button className="self-start border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={() => void refresh()} variant="secondary"><RefreshCw />Retry</Button></div> : loading ? <div aria-label="Loading tasks" className="flex flex-col gap-3">{[0, 1, 2].map((item) => <div className="h-28 animate-pulse rounded-2xl border border-task-border bg-task-muted" key={item} />)}</div> : scopedTasks.length === 0 ? <div className="flex min-h-[48dvh] flex-col items-center justify-center px-5 text-center"><span className="mb-5 flex size-20 items-center justify-center rounded-[1.75rem] bg-task-muted text-task-accent"><CheckCircle2 className="size-10" /></span><h2 className="text-2xl font-semibold text-task-text">No Tasks Here</h2><p className="mt-1 max-w-sm text-sm text-task-text-muted">It seems that you don’t have any tasks in this list.</p></div> : <div className="flex flex-col gap-3">{profile ? scopedTasks.map((task) => <TaskCard capability={deriveTaskMutationCapability({ assigneeIds: task.assignees.map((assignee) => assignee.id), isWatcher: task.isWatchedByViewer, viewerId: profile.id, viewerRole: profile.user_role })} categoryLabel={task.category_id ? categoryNames.get(task.category_id) ?? "Uncategorized" : "Uncategorized"} key={task.id} onAction={(action) => handleAction(task, action)} task={task} />) : null}</div>}
      </div>

      {canManage ? <div className="fixed bottom-[86px] right-4 z-20 flex gap-2 md:bottom-8 md:right-8"><Button onClick={() => setImportOpen(true)} variant="secondary"><Upload className="size-4" />Import Tasks</Button><Button aria-label="Create task" className="min-h-14 rounded-2xl bg-task-accent px-5 text-task-text shadow-xl hover:bg-task-accent/90" onClick={() => void openComposer()}><Plus className="size-6" />Create Task</Button></div> : null}

      {importOpen && canManage ? <TaskImportDialog onClose={() => setImportOpen(false)} onImported={refresh} /> : null}

      {composerOpen && canManage && references && profile ? <TaskComposer data={references} onClose={() => setComposerOpen(false)} onCreated={() => { setComposerOpen(false); void refresh(); }} onManageTemplates={() => { setComposerOpen(false); setShowTemplates(true); }} onSave={createDelegationTask} onUploadAttachment={(taskId, file) => uploadTaskAttachment(profile.tenant_id, taskId, file)} onSaveRecurring={(payload) => saveTaskTemplate(null, payload)} onUseTemplate={createFromTemplate} profile={profile} /> : null}

      {showTemplates && canManage && references ? <Modal onClose={() => setShowTemplates(false)} title="Task Templates">
        <div className="flex flex-col gap-3">
          <Button onClick={() => { setShowTemplates(false); setEditTemplate(null); }}><Plus />New template</Button>
          {references.templates.length === 0 ? <p className="rounded-xl border border-dashed border-gold/20 p-6 text-center text-sm text-soft-grey">No task templates yet.</p> : references.templates.map((template) => <button className="flex items-center justify-between gap-4 rounded-xl border border-gold/20 p-3 text-left" key={template.id} onClick={() => { setShowTemplates(false); setEditTemplate(template); }} type="button"><span><span className="block text-sm font-semibold text-white">{template.title}</span><span className="text-xs text-soft-grey">{template.recurrence_rule} · {template.planned_time?.slice(0, 5)}</span></span><span className="text-xs text-gold">{template.is_active ? "Active" : "Inactive"}</span></button>)}
        </div>
      </Modal> : null}

      {editTemplate !== undefined && canManage && references ? <Modal onClose={() => setEditTemplate(undefined)} title={editTemplate ? "Edit Task Template" : "New Task Template"} wide><TaskTemplateForm data={references} onCancel={() => setEditTemplate(undefined)} onSave={async (id, payload) => { await saveTaskTemplate(id, payload); setEditTemplate(undefined); await refresh(); }} template={editTemplate} /></Modal> : null}

      {delegateTarget && references && profile ? <DelegateTaskModal canManage={canManage} currentUserId={profile.id} onClose={() => setDelegateTarget(null)} onDelegate={async (fromUserId, toUserId, reason) => { if (!delegateTarget.id) throw new Error("Task identifier is missing"); await delegateTask(delegateTarget.id, fromUserId, toUserId, reason); setDelegateTarget(null); await refresh(); }} task={delegateTarget} users={references.users} /> : null}
      {formTarget?.id && formTarget.form_template_id ? (() => { const form = formBundles.find((item) => item.id === formTarget.form_template_id); return form ? <Modal onClose={() => setFormTarget(null)} title={`Required form: ${form.name}`} wide><FormRenderer definition={{ name: form.name, description: form.description ?? undefined, fields: form.fields }} dynamicOptions={formDynamicOptions} onSubmit={async (answers) => { await submitForm(form.id, answers, formTarget.task_type === "delegation" ? "delegation_task" : "checklist_task", formTarget.id as string); setFormTarget(null); await refresh(); }} /></Modal> : <Modal onClose={() => setFormTarget(null)} title="Required form"><Notice tone="danger">The exact required form version is not available to this account.</Notice></Modal>; })() : null}
    </section>
  );
}
