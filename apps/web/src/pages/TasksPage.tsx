import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Plus, RefreshCw, Upload, UserRoundPlus } from "lucide-react";
import { countTaskFeedStatuses, deriveTaskMutationCapability, kolkataDateKey, splitAssignedTaskFeed, taskMatchesStatus, type TaskFeedStatusFilter } from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { Button, Modal, Notice } from "@/components/ui";
import {
  createDelegationTask,
  ensureMyRecurringTasks,
  loadTaskFeed,
  loadTaskAuthoringReferenceData,
  loadTaskFeedReferenceData,
  reviseTask,
  updateTask,
  uploadAndCompleteTask,
  uploadTaskAttachment,
  type TaskBundle,
  type TaskReferenceData,
} from "@/features/tasks/api";
import { TaskCard, type TaskCardAction } from "@/features/tasks/TaskCard";
import { TaskComposer } from "@/features/tasks/TaskComposer";
import { TaskFilterBar } from "@/features/tasks/TaskFilterBar";
import { prepareRecurringTasksThenLoad } from "@/features/tasks/taskRefresh";
import { shouldShowTaskLoading } from "@/features/tasks/taskLoading";
import { loadFormDynamicOptions, loadTaskForms, submitForm, type FormBundle } from "@/features/forms/api";
import { FormRenderer, type DynamicOptions } from "@/features/forms/FormRenderer";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";

type TaskWorkspaceView = "mine" | "delegated";
const TASK_TOPICS = ["tasks", "forms", "organization"] as const;

export function TasksPage() {
  const { profile } = useAuth();
  const [statusFilter, setStatusFilter] = useState<TaskFeedStatusFilter>("pending");
  const [myTasks, setMyTasks] = useState<TaskBundle[]>([]);
  const [delegatedTasks, setDelegatedTasks] = useState<TaskBundle[]>([]);
  const [workspaceView, setWorkspaceView] = useState<TaskWorkspaceView>("mine");
  const [categories, setCategories] = useState<TaskReferenceData["categories"]>([]);
  const [references, setReferences] = useState<TaskReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [formBundles, setFormBundles] = useState<FormBundle[]>([]);
  const [formDynamicOptions, setFormDynamicOptions] = useState<DynamicOptions>({ users: [], branches: [], departments: [], masters: [] });
  const [formTarget, setFormTarget] = useState<TaskBundle | null>(null);
  const refreshGeneration = useRef(0);
  const hasCompletedInitialLoad = useRef(false);
  const canManage = profile ? ["super_admin", "admin", "manager"].includes(profile.user_role) : false;
  const canCreateTasks = Boolean(profile);
  const hasAdminTaskView = profile ? ["super_admin", "admin"].includes(profile.user_role) : false;

  const refresh = useCallback(async () => {
    if (!profile) return;
    const generation = ++refreshGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const today = kolkataDateKey(new Date());
      const start = `${today}T00:00:00.000+05:30`;
      const end = `${today}T23:59:59.999+05:30`;
      const loadWorkspace = () => Promise.all([
        loadTaskFeed(profile.id, start, end, { includeBlockedCoverage: canManage, includeOverdue: true }),
        hasAdminTaskView ? loadTaskFeed(profile.id, start, end, { delegated: true, includeOverdue: true }) : Promise.resolve([]),
        loadTaskFeedReferenceData().catch(() => ({ categories: [] })),
      ]);
      const applyWorkspace = async (
        [assignedTasks, authoredTasks, nextCategories]: Awaited<ReturnType<typeof loadWorkspace>>,
        workspaceGeneration: number,
      ) => {
        const assignedSplit = splitAssignedTaskFeed(assignedTasks);
        const nextMyTasks = hasAdminTaskView ? assignedTasks : assignedSplit.myTasks;
        const nextDelegatedTasks = hasAdminTaskView ? authoredTasks : assignedSplit.delegatedTasks;
        const nextTasks = [...nextMyTasks, ...nextDelegatedTasks.filter((task) => !nextMyTasks.some((myTask) => myTask.id === task.id))];
        const [forms, dynamicOptions] = await Promise.all([
          loadTaskForms([...new Set(nextTasks.flatMap((task) => task.requires_form && task.form_template_id ? [task.form_template_id] : []))], nextTasks.flatMap((task) => task.id ? [task.id] : [])),
          loadFormDynamicOptions(),
        ]);
        if (workspaceGeneration !== refreshGeneration.current) return;
        setMyTasks(nextMyTasks);
        setDelegatedTasks(nextDelegatedTasks);
        setCategories(nextCategories.categories);
        setFormBundles(forms.bundles);
        setFormDynamicOptions(dynamicOptions);
      };
      const initialWorkspace = await prepareRecurringTasksThenLoad(ensureMyRecurringTasks, loadWorkspace, async (refreshedWorkspace) => {
        const refreshedGeneration = ++refreshGeneration.current;
        await applyWorkspace(refreshedWorkspace, refreshedGeneration);
        if (refreshedGeneration === refreshGeneration.current) setLoading(false);
      });
      await applyWorkspace(initialWorkspace, generation);
    } catch (caught) {
      if (generation === refreshGeneration.current) setError(caught instanceof Error ? caught.message : "Unable to load tasks");
    } finally {
      if (generation === refreshGeneration.current) {
        hasCompletedInitialLoad.current = true;
        setLoading(false);
      }
    }
  }, [canManage, hasAdminTaskView, profile]);

  useEffect(() => { hasCompletedInitialLoad.current = false; }, [profile?.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: TASK_TOPICS, refresh });

  const openComposer = useCallback(async () => {
    try { setError(null); setReferences(await loadTaskAuthoringReferenceData()); setComposerOpen(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load task authoring options"); }
  }, []);

  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.label])), [categories]);
  const tasks = workspaceView === "mine" ? myTasks : delegatedTasks;
  const counts = useMemo(() => countTaskFeedStatuses(tasks), [tasks]);
  const scopedTasks = useMemo(() => {
    return tasks.filter((task) => taskMatchesStatus(task, statusFilter));
  }, [statusFilter, tasks]);

  const navigateTo = (path: string) => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
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
    if (action.kind === "fill_form") { setFormTarget(task); return; }
    if (action.kind === "upload") await uploadTaskAttachment(profile.tenant_id, task.id, action.file);
    else if (action.kind === "upload_and_complete") {
      await uploadAndCompleteTask(profile.tenant_id, task.id, action.file);
    }
    else if (action.kind === "revise") await reviseTask(task.id, action.datetime, action.reason);
    else if (action.kind === "checklist") await updateTask(task.id, "checklist", { checklistId: action.checklistId, completed: action.completed });
    else if (action.kind === "complete") await updateTask(task.id, "complete", { remark: action.remark });
    await refresh();
  };

  return (
    <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-bg pb-24 text-task-text sm:-m-6 md:min-h-[calc(100vh-4rem)] md:pb-10">
      <h1 className="sr-only">Tasks</h1>
      <div className="hidden items-center justify-between border-b border-task-border px-6 py-4 md:flex">
        <div><h2 className="text-2xl font-semibold text-task-text">Tasks</h2><p className="text-sm text-task-text-muted">Assigned, watched, coverage-blocked, and delegated work in one place.</p></div>
      </div>

      <div className="scroll-x no-scrollbar flex items-stretch gap-2 border-b border-task-border bg-task-bg px-3 pt-3 sm:px-5">
        {([
          ["mine", "My Tasks", countTaskFeedStatuses(myTasks).open],
          ["delegated", "Delegated", countTaskFeedStatuses(delegatedTasks).open],
        ] as const).map(([view, label, count]) => <button
          aria-pressed={workspaceView === view}
          className={`relative min-h-11 shrink-0 px-3 pb-3 text-sm font-semibold ${workspaceView === view ? "text-task-text after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-task-accent" : "text-task-text-muted"}`}
          key={view}
          onClick={() => setWorkspaceView(view)}
          type="button"
        >
          {label} <span className="tabular-nums">({count})</span>
        </button>)}
        {canManage ? <div className="ml-auto flex shrink-0 items-center gap-1 pb-2">
          {hasAdminTaskView ? <button aria-label="Assigning Left" className="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-task-text-muted transition hover:bg-task-muted" onClick={() => navigateTo("/tasks/assigning-left")} type="button"><UserRoundPlus className="size-5 shrink-0" /><span className="hidden sm:inline">Assigning Left</span></button> : null}
          <button aria-label="Bulk Import" className="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-task-text-muted transition hover:bg-task-muted" onClick={() => navigateTo("/tasks/import")} type="button"><Upload className="size-5 shrink-0" /><span className="hidden sm:inline">Bulk Import</span></button>
        </div> : null}
      </div>

      <TaskFilterBar counts={counts} onStatusChange={setStatusFilter} status={statusFilter} />

      <div className="w-full p-3 sm:p-5">
        {error ? <div className="flex flex-col gap-3 rounded-xl border border-danger/40 bg-danger/10 p-4"><Notice tone="danger">{error}</Notice><Button className="self-start border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={() => void refresh()} variant="secondary"><RefreshCw />Retry</Button></div> : shouldShowTaskLoading(loading, hasCompletedInitialLoad.current) ? <div aria-label="Loading tasks" className="flex flex-col gap-3">{[0, 1, 2].map((item) => <div className="h-28 animate-pulse rounded-2xl border border-task-border bg-task-muted" key={item} />)}</div> : scopedTasks.length === 0 ? <div className="flex min-h-[48dvh] flex-col items-center justify-center px-5 text-center"><span className="mb-5 flex size-20 items-center justify-center rounded-[1.75rem] bg-task-muted text-task-accent"><CheckCircle2 className="size-10" /></span><h2 className="text-2xl font-semibold text-task-text">No Tasks Here</h2><p className="mt-1 max-w-sm text-sm text-task-text-muted">It seems that you don’t have any tasks in this list.</p></div> : <div className="flex flex-col gap-3">{profile ? scopedTasks.map((task) => <TaskCard capability={deriveTaskMutationCapability({ assigneeIds: task.assignees.map((assignee) => assignee.id), isWatcher: task.isWatchedByViewer, viewerId: profile.id, viewerRole: profile.user_role })} categoryLabel={task.category_id ? categoryNames.get(task.category_id) ?? "Uncategorized" : "Uncategorized"} key={task.id} onAction={(action) => handleAction(task, action)} task={task} />) : null}</div>}
      </div>

      {canCreateTasks ? <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-20 md:bottom-8 md:right-8">
        <Button aria-label="Create task" className="size-14 rounded-full bg-task-accent p-0 text-task-text shadow-xl hover:bg-task-accent/90 md:h-14 md:w-auto md:rounded-2xl md:px-5" onClick={() => void openComposer()}><Plus className="size-6" /><span className="hidden md:inline">Create Task</span></Button>
      </div> : null}

      {composerOpen && canCreateTasks && references && profile ? <TaskComposer data={references} onClose={() => setComposerOpen(false)} onCreated={() => { setComposerOpen(false); void refresh(); }} onSave={createDelegationTask} onUploadAttachment={(taskId, file) => uploadTaskAttachment(profile.tenant_id, taskId, file)} profile={profile} /> : null}
      {formTarget?.id && formTarget.form_template_id ? (() => { const form = formBundles.find((item) => item.id === formTarget.form_template_id); return form ? <Modal onClose={() => setFormTarget(null)} title={`Required form: ${form.name}`} wide><FormRenderer definition={{ name: form.name, description: form.description ?? undefined, sections: form.sections, fields: form.fields }} dynamicOptions={formDynamicOptions} templateId={form.id} onSubmit={async (answers) => { await submitForm(form.id, answers, formTarget.task_type === "delegation" ? "delegation_task" : "checklist_task", formTarget.id as string); setFormTarget(null); await refresh(); }} /></Modal> : <Modal onClose={() => setFormTarget(null)} title="Required form"><Notice tone="danger">The exact required form version is not available to this account.</Notice></Modal>; })() : null}
    </section>
  );
}
