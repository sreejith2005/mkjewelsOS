import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, CalendarDays, Check, FileText, Flag, Paperclip, Rocket, Users, UserRoundCheck } from "lucide-react";
import { normalizeTaskParticipants, type Enums, type Json } from "@jewelos/core";
import type { UserProfile } from "@/types";
import { Button, Modal, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ChipSelector } from "./ChipSelector";
import type { TaskReferenceData } from "./api";
import { UserPicker } from "./UserPicker";

type Panel = "users" | "due" | "priority" | "form" | "watchers" | null;
type ComposerMode = "manual" | "template";

function TaskSelector({ children, id, open, panel, side = "left" }: { children: ReactNode; id: Exclude<Panel, null>; open: boolean; panel: ReactNode; side?: "left" | "right" }) {
  return <div className="relative min-w-0" data-testid={`task-selector-${id}`}>
    {children}
    {open ? <div className={cn("absolute top-full z-20 mt-2 max-h-[min(26rem,50dvh)] w-[calc(200%+0.5rem)] overflow-y-auto rounded-xl border border-task-border bg-task-bg p-3 shadow-lg", side === "right" ? "right-0" : "left-0")} data-testid={`task-panel-${id}`}>{panel}</div> : null}
  </div>;
}

export function TaskComposer({ data, onClose, onCreated, onManageTemplates, onSave, onUploadAttachment, onSaveRecurring, onUseTemplate, profile }: {
  data: TaskReferenceData;
  onClose: () => void;
  onCreated: () => void;
  onManageTemplates: () => void;
  onSave: (payload: Json, doers: string[], watchers: string[], checklist: Json) => Promise<string>;
  onUploadAttachment: (taskId: string, file: File) => Promise<void>;
  onSaveRecurring: (payload: Json) => Promise<void>;
  onUseTemplate: (templateId: string, planned: string) => Promise<void>;
  profile: UserProfile;
}) {
  const [mode, setMode] = useState<ComposerMode>("manual");
  const [panel, setPanel] = useState<Panel>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [planned, setPlanned] = useState("");
  const [priority, setPriority] = useState<Enums<"task_priority">>("high");
  const [categoryId, setCategoryId] = useState(data.categories[0]?.id ?? "");
  const [branchId, setBranchId] = useState(profile.branch_id);
  const [departmentId, setDepartmentId] = useState("");
  const [doers, setDoers] = useState<string[]>([]);
  const [watchers, setWatchers] = useState<string[]>([]);
  const [formTemplateId, setFormTemplateId] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [repeatSchedule, setRepeatSchedule] = useState("daily");
  const [repeatEndDate, setRepeatEndDate] = useState("");
  const [repeatDays, setRepeatDays] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templatePlanned, setTemplatePlanned] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canSelectBranch = profile.user_role === "admin" || profile.user_role === "super_admin";
  const scopedDepartments = useMemo(() => data.departments.filter((department) => !department.branch_id || department.branch_id === branchId), [branchId, data.departments]);
  const branchNames = useMemo(() => new Map(data.branches.map((branch) => [branch.id, branch.name])), [data.branches]);
  const departmentNames = useMemo(() => new Map(data.departments.map((department) => [department.id, department.name])), [data.departments]);
  const priorityOptions = useMemo(() => data.priorities.flatMap((option) => option.value === "high" || option.value === "medium" || option.value === "low"
    ? [{ ...option, value: option.value as Enums<"task_priority"> }]
    : []), [data.priorities]);
  const eligibleDoers = useMemo(() => data.users.filter((user) =>
    user.branch_id === branchId && user.department_id === departmentId),
  [branchId, data.users, departmentId]);
  const eligibleWatchers = useMemo(() => data.users.filter((user) =>
    profile.user_role === "manager" ? user.branch_id === branchId : user.tenant_id === profile.tenant_id),
  [branchId, data.users, profile.tenant_id, profile.user_role]);
  const priorityLabel = priorityOptions.find((option) => option.value === priority)?.label ?? priority;
  const attachedForm = data.forms.find((form) => form.id === formTemplateId);
  const activeTemplates = data.templates.filter((template) => template.is_active);

  useEffect(() => {
    if (!priorityOptions.some((option) => option.value === priority)) setPriority(priorityOptions[0]?.value ?? "high");
  }, [priority, priorityOptions]);

  useEffect(() => {
    if (!categoryId && data.categories[0]?.id) setCategoryId(data.categories[0].id);
  }, [categoryId, data.categories]);

  const togglePanel = (next: Exclude<Panel, null>) => setPanel((current) => current === next ? null : next);
  const updateDoers = (nextDoers: string[]) => {
    setDoers(nextDoers);
    setWatchers((current) => current.filter((id) => !nextDoers.includes(id)));
  };
  const pruneDoersForScope = (nextBranchId: string, nextDepartmentId: string) => {
    const eligibleIds = new Set(data.users.filter((user) =>
      user.branch_id === nextBranchId && user.department_id === nextDepartmentId).flatMap((user) => user.id ? [user.id] : []));
    const nextDoers = doers.filter((id) => eligibleIds.has(id));
    setDoers(nextDoers);
    setWatchers((current) => current.filter((id) => !nextDoers.includes(id)));
  };
  const changeBranch = (nextBranchId: string) => {
    setBranchId(nextBranchId);
    setDepartmentId("");
    pruneDoersForScope(nextBranchId, "");
  };
  const changeDepartment = (nextDepartmentId: string) => {
    setDepartmentId(nextDepartmentId);
    pruneDoersForScope(branchId, nextDepartmentId);
  };

  const submitManual = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Add a task title.");
    if (!branchId || !departmentId) return setError("Choose a valid branch and department.");
    if (doers.length === 0) return setError("Select at least one user.");
    if (!planned) return setError("Choose a due date and time.");
    if (!categoryId) return setError("No active task category is configured.");
    if (repeat && repeatSchedule === "weekly" && repeatDays.length === 0) return setError("Select at least one repeat day.");
    setSaving(true);
    try {
      const participants = normalizeTaskParticipants(doers, watchers);
      if (repeat) {
        const recurrenceRule = repeatSchedule === "daily" ? "FREQ=DAILY"
          : repeatSchedule === "weekly" ? `FREQ=WEEKLY;BYDAY=${repeatDays.map((day) => day.slice(0, 2).toUpperCase()).join(",")}`
            : "FREQ=MONTHLY";
        await onSaveRecurring({ title: title.trim(), description: description.trim(), recurrence_rule: `${recurrenceRule}${repeatEndDate ? `;UNTIL=${repeatEndDate.replaceAll("-", "")}T235959Z` : ""}`, planned_time: planned.slice(11, 16), priority, category_id: categoryId, branch_id: branchId, department_id: departmentId, default_assignee_type: "specific_user", default_assignee_user_id: participants.doerIds[0], default_assignee_role: "", checklist_items: [], requires_upload: false, requires_remark: false, requires_form: Boolean(formTemplateId), form_template_id: formTemplateId, is_active: true });
        onCreated();
        return;
      }
      const taskId = await onSave({
        title: title.trim(),
        description: description.trim(),
        planned_datetime: new Date(planned).toISOString(),
        priority,
        branch_id: branchId,
        department_id: departmentId,
        category_id: categoryId,
        requires_upload: false,
        requires_remark: false,
        requires_form: Boolean(formTemplateId),
        form_template_id: formTemplateId,
      }, [...participants.doerIds], [...participants.watcherIds], []);
      if (attachment) await onUploadAttachment(taskId, attachment);
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create task");
    } finally {
      setSaving(false);
    }
  };

  const submitTemplate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!templateId || !templatePlanned) return setError("Choose a template and due date.");
    setSaving(true);
    try {
      await onUseTemplate(templateId, new Date(templatePlanned).toISOString());
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create task from template");
    } finally {
      setSaving(false);
    }
  };

  const usersPanel = <div className="flex flex-col gap-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label><span className="mb-1 block text-xs font-semibold text-task-text">Branch{canSelectBranch ? "" : " (fixed)"}</span><select className="task-field" disabled={!canSelectBranch} onChange={(event) => changeBranch(event.target.value)} value={branchId}><option value="">Select branch</option>{data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label><span className="mb-1 block text-xs font-semibold text-task-text">Department</span><select className="task-field" onChange={(event) => changeDepartment(event.target.value)} value={departmentId}><option value="">Select department first</option>{scopedDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
    </div>
    {!departmentId ? <Notice tone="task">Select a department to see its active users.</Notice> : eligibleDoers.length === 0 ? <Notice tone="task">No active users are assigned to this branch and department.</Notice> : <UserPicker branchNames={branchNames} departmentNames={departmentNames} disabledIds={[]} label="Users in this department" onChange={updateDoers} selectedIds={doers} users={eligibleDoers} />}
  </div>;
  const duePanel = <label><span className="mb-1 block text-xs font-semibold text-task-text">Due date and time</span><input className="task-field" min={new Date().toISOString().slice(0, 16)} onChange={(event) => setPlanned(event.target.value)} type="datetime-local" value={planned} /></label>;
  const priorityPanel = <fieldset className="grid grid-cols-3 gap-2"><legend className="sr-only">Priority</legend>{priorityOptions.map((option) => <button className={cn("min-h-11 rounded-lg border text-sm", priority === option.value ? "border-task-accent bg-task-accent-soft text-task-text" : "border-task-border text-task-text-muted")} key={option.id} onClick={() => { setPriority(option.value); setPanel(null); }} type="button">{priority === option.value ? <Check className="mr-1 inline size-4" /> : null}{option.label}</button>)}</fieldset>;
  const formPanel = <div><label><span className="mb-1 block text-xs font-semibold text-task-text">Required form</span><select className="task-field" onChange={(event) => { setFormTemplateId(event.target.value); setPanel(null); }} value={formTemplateId}><option value="">No form required</option>{data.forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label><p className="mt-2 text-xs text-task-text-muted">The selected form must be completed before this task can be finished.</p></div>;
  const watchersPanel = <UserPicker branchNames={branchNames} departmentNames={departmentNames} disabledIds={doers} label="In Loop · read only" onChange={setWatchers} selectedIds={watchers} users={eligibleWatchers} />;

  return (
    <Modal onClose={onClose} title="Assign New Task" tone="light" wide>
      {error ? <div className="mb-4"><Notice tone="danger">{error}</Notice></div> : null}

      {mode === "manual" ? (
        <form className="flex flex-col" onSubmit={(event) => void submitManual(event)}>
          <label className="border-b border-task-border px-1 pb-3">
            <span className="sr-only">Task title</span>
            <input autoFocus className="w-full bg-transparent text-base font-medium text-task-text placeholder:text-task-text-muted/80 focus-visible:ring-0" data-autofocus maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Add Title" value={title} />
          </label>
          <label className="border-b border-task-border px-1 py-3">
            <span className="sr-only">Task description</span>
            <textarea className="min-h-24 w-full resize-y bg-task-muted p-3 text-sm text-task-text placeholder:text-task-text-muted focus-visible:ring-task-accent" onChange={(event) => setDescription(event.target.value)} placeholder="Add Description" value={description} />
          </label>

          <div className="grid grid-cols-2 gap-2 border-b border-task-border py-3">
            <TaskSelector id="users" open={panel === "users"} panel={usersPanel}><ChipSelector active={panel === "users"} Icon={Users} label="Users" onClick={() => togglePanel("users")} summary={doers.length ? `${doers.length} user${doers.length === 1 ? "" : "s"}` : undefined} /></TaskSelector>
            <TaskSelector id="due" open={panel === "due"} panel={duePanel} side="right"><ChipSelector active={panel === "due"} Icon={CalendarDays} label="Due Date" onClick={() => togglePanel("due")} summary={planned ? new Date(planned).toLocaleString("en-IN", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" }) : undefined} /></TaskSelector>
            <TaskSelector id="priority" open={panel === "priority"} panel={priorityPanel}><ChipSelector active={panel === "priority"} Icon={Flag} label="Priority" onClick={() => togglePanel("priority")} summary={priorityLabel} /></TaskSelector>
            <TaskSelector id="form" open={panel === "form"} panel={formPanel} side="right"><ChipSelector active={panel === "form"} Icon={FileText} label="Attach Form" onClick={() => togglePanel("form")} summary={attachedForm?.name} /></TaskSelector>
            <TaskSelector id="watchers" open={panel === "watchers"} panel={watchersPanel}><ChipSelector active={panel === "watchers"} Icon={UserRoundCheck} label="In Loop" onClick={() => togglePanel("watchers")} summary={watchers.length ? `${watchers.length} in loop` : undefined} /></TaskSelector>
          </div>


          {repeat ? <section className="mt-4 rounded-xl border border-task-border bg-task-muted p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-task-text-muted">Recurring settings</p><select className="task-field" onChange={(event) => setRepeatSchedule(event.target.value)} value={repeatSchedule}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select><div className="mt-2 grid grid-cols-2 gap-2"><label><span className="sr-only">End date</span><input className="task-field" min={new Date().toISOString().slice(0, 10)} onChange={(event) => setRepeatEndDate(event.target.value)} type="date" value={repeatEndDate} /></label><span className="flex min-h-11 items-center rounded-lg border border-task-border px-3 text-sm text-task-text-muted">{repeatEndDate ? "Ends on selected date" : "No end date"}</span></div>{repeatSchedule === "weekly" ? <div className="mt-3 flex flex-wrap gap-2">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day) => <button className={cn("size-10 rounded-full border text-xs", repeatDays.includes(day) ? "border-task-accent bg-task-accent-soft text-task-text" : "border-task-border text-task-text-muted")} key={day} onClick={() => setRepeatDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])} type="button">{day}</button>)}</div> : null}</section> : null}
          <div className="sticky -bottom-5 -mx-5 mt-4 flex items-center gap-3 border-t border-task-border bg-task-bg px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-task-text"><input checked={repeat} className="size-4 accent-task-accent" onChange={(event) => setRepeat(event.target.checked)} type="checkbox" />Repeat</label>
            <label className="flex size-11 cursor-pointer items-center justify-center rounded-lg text-task-text-muted hover:bg-task-muted"><Paperclip className="size-5" /><span className="sr-only">Attach image or document</span><input accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} type="file" /></label>
            <Button className="ml-auto bg-task-accent text-task-text hover:bg-task-accent/90" disabled={saving} type="submit"><Rocket />{saving ? "Assigning…" : "Assign Task"}</Button>
          </div>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void submitTemplate(event)}>
          <button className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-task-text-muted hover:text-task-text" onClick={() => { setMode("manual"); setError(null); }} type="button"><ArrowLeft className="size-4" />Back to manual task</button>
          <p className="text-sm text-task-text-muted">Create from an active database-backed template, including its checklist and configured requirements.</p>
          <label><span className="mb-1 block text-xs font-semibold text-task-text">Task template</span><select className="task-field" onChange={(event) => setTemplateId(event.target.value)} value={templateId}><option value="">Select template</option>{activeTemplates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-semibold text-task-text">Due date and time</span><input className="task-field" onChange={(event) => setTemplatePlanned(event.target.value)} type="datetime-local" value={templatePlanned} /></label>
          <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={onManageTemplates} type="button" variant="secondary">Manage task templates</Button>
          <Button className="bg-task-accent text-task-text hover:bg-task-accent/90" disabled={saving} type="submit"><Rocket />{saving ? "Creating…" : "Create from Template"}</Button>
        </form>
      )}
    </Modal>
  );
}
