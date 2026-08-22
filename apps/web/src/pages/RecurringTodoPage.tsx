import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, ClipboardCheck, MessageSquareMore, Play, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Modal, Notice } from "@/components/ui";
import { TaskTemplateForm } from "@/features/tasks/TaskForms";
import { loadTaskAuthoringReferenceData, updateTask, type TaskReferenceData } from "@/features/tasks/api";
import {
  deleteRecurringTemplate,
  loadRecurringWorkspace,
  runRecurringTemplateNow,
  saveRecurringTemplate,
  sendRecurringFollowup,
  verifyRecurringTask,
  type RecurringInstance,
  type RecurringTemplate,
  type RecurringWorkspace,
} from "@/features/recurringTodo/api";
import { titleCase } from "@/lib/format";

type Tab = "overview" | "my_work" | "schedules" | "verification" | "followups";
const EMPTY: RecurringWorkspace = { templates: [], instances: [], stats: { total: 0, pending: 0, in_progress: 0, completed: 0, overdue: 0, coverage_required: 0, manager_review: 0 } };

function dateKey(date: Date): string { return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }
function defaultRange(): [string, string] { const from = new Date(); from.setDate(from.getDate() - 7); const to = new Date(); to.setDate(to.getDate() + 30); return [dateKey(from), dateKey(to)]; }
function dueLabel(value: string): string { return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); }

function StatusPill({ task }: { task: RecurringInstance }) {
  const special = task.coverage_status;
  const label = special ?? task.status;
  const tone = special === "coverage_required" || task.status === "overdue" ? "bg-danger/15 text-danger" : special === "manager_review" ? "bg-warning/15 text-warning" : task.status === "completed" ? "bg-success/15 text-success" : "bg-gold/10 text-gold";
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${tone}`}>{titleCase(label ?? "pending")}</span>;
}

function WorkCard({ task, canManage, followupEnabled, onChanged }: { task: RecurringInstance; canManage: boolean; followupEnabled: boolean; onChanged: () => Promise<void> }) {
  const act = async (action: "start" | "complete") => { await updateTask(task.id, action, action === "complete" ? { remark: "Completed from Recurring / To-Do" } : undefined); await onChanged(); };
  const followup = async () => { const message = window.prompt("Follow-up message"); if (!message?.trim()) return; await sendRecurringFollowup(task.id, message); await onChanged(); };
  const verify = async (decision: "verified" | "rejected") => { const note = decision === "rejected" ? window.prompt("Why is this rejected?") ?? "" : ""; if (decision === "rejected" && !note.trim()) return; await verifyRecurringTask(task.id, decision, note); await onChanged(); };
  return <article className="rounded-2xl border border-gold/15 bg-charcoal p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-semibold text-white">{task.title}</h3><p className="mt-1 text-xs text-soft-grey">{dueLabel(task.planned_datetime)} · {task.assignees.map((item) => item.name).join(", ") || "Coverage required"}</p></div><StatusPill task={task} /></div>{task.description ? <p className="mt-3 line-clamp-2 text-sm text-soft-grey">{task.description}</p> : null}{task.checklist.length ? <p className="mt-3 text-xs text-soft-grey">Checklist {task.checklist.filter((item) => item.is_completed).length}/{task.checklist.length}</p> : null}<div className="mt-4 flex flex-wrap gap-2">{task.status === "pending" && task.coverage_status !== "coverage_required" ? <Button onClick={() => void act("start")} variant="secondary"><Play className="size-4" />Start</Button> : null}{task.status === "in_progress" && !task.requires_upload && !task.requires_form ? <Button onClick={() => void act("complete")}><CheckCircle2 className="size-4" />Complete</Button> : null}{followupEnabled && canManage && task.status !== "completed" ? <Button onClick={() => void followup()} variant="secondary"><MessageSquareMore className="size-4" />Follow up</Button> : null}{canManage && task.status === "completed" && task.verification_status === "pending" ? <><Button onClick={() => void verify("verified")}><ShieldCheck className="size-4" />Verify</Button><Button onClick={() => void verify("rejected")} variant="danger">Reject</Button></> : null}</div></article>;
}

export function RecurringTodoPage() {
  const { profile } = useAuth();
  const [[dateFrom, dateTo], setRange] = useState(defaultRange);
  const [workspace, setWorkspace] = useState(EMPTY);
  const [references, setReferences] = useState<TaskReferenceData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RecurringTemplate | null | undefined>(undefined);
  const canManage = !!profile && ["super_admin", "admin", "manager"].includes(profile.user_role);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextWorkspace, nextReferences] = await Promise.all([
        loadRecurringWorkspace({ date_from: dateFrom, date_to: dateTo, search }),
        loadTaskAuthoringReferenceData(),
      ]);
      setWorkspace(nextWorkspace); setReferences(nextReferences);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load recurring work"); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, search]);
  useEffect(() => { void load(); }, [load]);

  const templateById = useMemo(() => new Map(workspace.templates.map((template) => [template.id, template])), [workspace.templates]);
  const visibleTasks = useMemo(() => workspace.instances.filter((task) => {
    if (tab === "my_work") return task.assignees.some((assignee) => assignee.id === profile?.id);
    if (tab === "verification") return task.status === "completed" && task.verification_status === "pending";
    if (tab === "followups") return task.status !== "completed" && Boolean(task.task_template_id && templateById.get(task.task_template_id)?.followup_enabled);
    return tab === "overview";
  }), [profile?.id, tab, templateById, workspace.instances]);

  const save = async (id: string | null, payload: Parameters<typeof saveRecurringTemplate>[1]) => { await saveRecurringTemplate(id, payload); setEditing(undefined); await load(); };
  const remove = async (template: RecurringTemplate) => { if (!window.confirm(`Delete ${template.title}? Used schedules will be archived to preserve task history.`)) return; await deleteRecurringTemplate(template.id); await load(); };
  const runNow = async (template: RecurringTemplate) => { const planned = new Date(Date.now() + 60 * 60 * 1000).toISOString(); await runRecurringTemplateNow(template.id, planned); await load(); };

  const tabs: Array<[Tab, string]> = [["overview", "Overview"], ["my_work", "My Work"], ["schedules", "Schedules"], ["verification", "Verification"], ["followups", "Follow-ups"]];
  return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-bg pb-24 text-task-text sm:-m-6 md:min-h-[calc(100vh-4rem)] md:pb-10"><header className="border-b border-task-border bg-charcoal px-4 py-5 sm:px-6"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="rounded-xl bg-gold p-2.5 text-obsidian"><CalendarClock className="size-5" /></span><div><h1 className="font-display text-3xl text-gold">Recurring / To-Do List</h1><p className="text-sm text-soft-grey">Schedules, daily work, verification, follow-ups, and profile-based coverage.</p></div></div><div className="flex gap-2">{canManage ? <Button onClick={() => setEditing(null)}><Plus className="size-4" />New schedule</Button> : null}<Button onClick={() => void load()} variant="secondary"><RefreshCw className="size-4" />Refresh</Button></div></div></header>
    <div className="mx-auto max-w-7xl p-4 sm:p-6">{error ? <Notice tone="danger">{error}</Notice> : null}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{([['Total',workspace.stats.total],['Pending',workspace.stats.pending],['In progress',workspace.stats.in_progress],['Completed',workspace.stats.completed],['Coverage required',workspace.stats.coverage_required],['Manager review',workspace.stats.manager_review]] as const).map(([label,value]) => <div className="rounded-xl border border-task-border bg-charcoal p-4" key={label}><p className="text-xs uppercase text-task-text-muted">{label}</p><p className="mt-1 text-2xl font-semibold text-task-text">{value}</p></div>)}</div>
      <div className="mt-5 flex gap-2 overflow-x-auto border-b border-task-border">{tabs.map(([value,label]) => <button className={`shrink-0 border-b-2 px-3 py-3 text-sm ${tab===value?'border-gold text-gold':'border-transparent text-task-text-muted'}`} key={value} onClick={() => setTab(value)} type="button">{label}</button>)}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_160px_auto]"><label className="relative"><Search className="absolute left-3 top-3 size-4 text-task-text-muted" /><input className="task-field pl-9" placeholder="Search schedules and tasks" value={search} onChange={(event) => setSearch(event.target.value)} /></label><input aria-label="From date" className="task-field" type="date" value={dateFrom} onChange={(event) => setRange([event.target.value,dateTo])} /><input aria-label="To date" className="task-field" min={dateFrom} type="date" value={dateTo} onChange={(event) => setRange([dateFrom,event.target.value])} />{canManage ? <Button onClick={() => { window.history.pushState({},"","/tasks/import"); window.dispatchEvent(new PopStateEvent("popstate")); }} variant="secondary">Bulk import</Button> : null}</div>
      {loading ? <p className="py-16 text-center text-gold">Loading recurring work…</p> : tab === "schedules" ? <div className="mt-5 grid gap-3 lg:grid-cols-2">{workspace.templates.map((template) => <article className="rounded-2xl border border-task-border bg-charcoal p-4" key={template.id}><div className="flex justify-between gap-3"><div><h3 className="font-semibold text-white">{template.title}</h3><p className="mt-1 text-xs text-soft-grey">{titleCase(template.schedule_kind)} · {template.planned_time?.slice(0,5)} · {template.is_active?'Active':'Inactive'}</p></div><span className="rounded-full bg-gold/10 px-2 py-1 text-xs text-gold">{template.recurrence_rule}</span></div><div className="mt-3 flex flex-wrap gap-2 text-xs text-soft-grey">{template.verification_required?<span>Verification</span>:null}{template.followup_enabled?<span>Follow-ups</span>:null}{template.requires_upload?<span>Upload</span>:null}{template.requires_form?<span>Form</span>:null}</div>{canManage ? <div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => setEditing(template)} variant="secondary">Edit</Button><Button onClick={() => void runNow(template)}><Play className="size-4" />Run now</Button><Button onClick={() => void remove(template)} variant="danger"><Trash2 className="size-4" />Delete</Button></div> : null}</article>)}{workspace.templates.length===0?<p className="col-span-full py-16 text-center text-soft-grey">No recurring schedules yet.</p>:null}</div> : <div className="mt-5 grid gap-3 lg:grid-cols-2">{visibleTasks.map((task) => <WorkCard canManage={canManage} followupEnabled={Boolean(task.task_template_id && templateById.get(task.task_template_id)?.followup_enabled)} key={task.id} onChanged={load} task={task} />)}{visibleTasks.length===0?<div className="col-span-full py-16 text-center"><ClipboardCheck className="mx-auto size-10 text-gold"/><p className="mt-3 text-soft-grey">No work matches this view.</p></div>:null}</div>}
    </div>{editing !== undefined && references ? <Modal onClose={() => setEditing(undefined)} title={editing ? "Edit recurring schedule" : "New recurring schedule"} wide><TaskTemplateForm data={references} onCancel={() => setEditing(undefined)} onSave={save} template={editing} /></Modal> : null}</section>;
}
