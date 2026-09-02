import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CalendarDays, Check, ChevronDown, FileText, Flag, Paperclip, Plus, Rocket, Users, UserRoundCheck, X } from "lucide-react";
import { normalizeTaskParticipants, type Enums, type Json } from "@jewelos/core";
import type { UserProfile } from "@/types";
import { Button, Modal, Notice } from "@/components/ui";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ChipSelector } from "./ChipSelector";
import type { TaskReferenceData } from "./api";
import { AssigneePicker } from "@/components/assignees/AssigneePicker";

type Panel = "users" | "due" | "priority" | "form" | "watchers" | null;

function TaskSelector({ children, id, open, panel }: { children: ReactNode; id: Exclude<Panel, null>; open: boolean; panel: ReactNode }) {
  return <div className="min-w-0" data-testid={`task-selector-${id}`}>
    {children}
    {open ? <div className="mt-2 max-h-[min(26rem,50dvh)] overflow-y-auto rounded-xl border border-task-border bg-task-muted p-3" data-testid={`task-panel-${id}`}>{panel}</div> : null}
  </div>;
}

export function TaskComposer({ data, onClose, onCreated, onSave, onUploadAttachment, profile }: {
  data: TaskReferenceData;
  onClose: () => void;
  onCreated: () => void;
  onSave: (payload: Json, doers: string[], watchers: string[], checklist: Json) => Promise<string>;
  onUploadAttachment: (taskId: string, file: File) => Promise<void>;
  profile: UserProfile;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [planned, setPlanned] = useState("");
  const [priority, setPriority] = useState<Enums<"task_priority">>("high");
  const [doers, setDoers] = useState<string[]>([]);
  const [watchers, setWatchers] = useState<string[]>([]);
  const [formTemplateId, setFormTemplateId] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [checklist, setChecklist] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const branchNames = useMemo(() => new Map(data.branches.map((branch) => [branch.id, branch.name])), [data.branches]);
  const departmentNames = useMemo(() => new Map(data.departments.map((department) => [department.id, department.name])), [data.departments]);
  const priorityOptions = useMemo(() => data.priorities.flatMap((option) => option.value === "high" || option.value === "medium" || option.value === "low"
    ? [{ ...option, value: option.value as Enums<"task_priority"> }]
    : []), [data.priorities]);
  const eligiblePeople = useMemo(() => data.users.filter((user) => user.id && user.tenant_id === profile.tenant_id), [data.users, profile.tenant_id]);
  const priorityLabel = priorityOptions.find((option) => option.value === priority)?.label ?? priority;
  const attachedForm = data.forms.find((form) => form.id === formTemplateId);

  useEffect(() => {
    if (!priorityOptions.some((option) => option.value === priority)) setPriority(priorityOptions[0]?.value ?? "high");
  }, [priority, priorityOptions]);

  const togglePanel = (next: Exclude<Panel, null>) => setPanel((current) => current === next ? null : next);
  const updateDoers = (nextDoers: string[]) => {
    const nextDoer = nextDoers.slice(0, 1);
    setDoers(nextDoer);
    setWatchers((current) => current.filter((id) => !nextDoer.includes(id)));
    setPanel(null);
  };
  const addChecklistItem = () => {
    const item = checklistDraft.trim();
    if (!item) return;
    setChecklist((current) => [...current, item]);
    setChecklistDraft("");
  };

  const submitManual = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Add a task title.");
    if (doers.length === 0) return setError("Select at least one user.");
    const selectedDoer = eligiblePeople.find((person) => person.id === doers[0]);
    if (!selectedDoer?.branch_id || !selectedDoer.department_id) return setError("The selected user needs an active branch and department.");
    if (!planned) return setError("Choose a due date and time.");
    setSaving(true);
    try {
      const participants = normalizeTaskParticipants(doers, watchers);
      const taskId = await onSave({
        title: title.trim(),
        description: description.trim(),
        planned_datetime: new Date(planned).toISOString(),
        priority,
        branch_id: selectedDoer.branch_id,
        department_id: selectedDoer.department_id,
        requires_upload: false,
        requires_remark: false,
        requires_form: Boolean(formTemplateId),
        form_template_id: formTemplateId,
      }, [...participants.doerIds], [...participants.watcherIds], checklist.map((item, sort_order) => ({ item_text: item, is_required: true, sort_order })));
      if (attachment) await onUploadAttachment(taskId, attachment);
      toast.success("Task assigned", { description: `Sent to ${participants.doerIds.length} user${participants.doerIds.length === 1 ? "" : "s"}.` });
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create task");
    } finally {
      setSaving(false);
    }
  };

  const usersPanel = <AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label="Assign user" multiple={false} onChange={updateDoers} people={eligiblePeople.flatMap((person) => person.id ? [{ ...person, id: person.id }] : [])} selectedIds={doers} />;
  const duePanel = <label><span className="mb-1 block text-xs font-semibold text-task-text">Due date and time</span><input className="task-field" min={new Date().toISOString().slice(0, 16)} onChange={(event) => { setPlanned(event.target.value); setPanel(null); }} type="datetime-local" value={planned} /></label>;
  const priorityPanel = <fieldset className="grid grid-cols-3 gap-2"><legend className="sr-only">Priority</legend>{priorityOptions.map((option) => <button className={cn("min-h-11 rounded-lg border text-sm", priority === option.value ? "border-task-accent bg-task-accent-soft text-task-text" : "border-task-border text-task-text-muted")} key={option.id} onClick={() => { setPriority(option.value); setPanel(null); }} type="button">{priority === option.value ? <Check className="mr-1 inline size-4" /> : null}{option.label}</button>)}</fieldset>;
  const formPanel = <div><label><span className="mb-1 block text-xs font-semibold text-task-text">Required form</span><select className="task-field" onChange={(event) => { setFormTemplateId(event.target.value); setPanel(null); }} value={formTemplateId}><option value="">No form required</option>{data.forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label><p className="mt-2 text-xs text-task-text-muted">The selected form must be completed before this task can be finished.</p></div>;
  const watchersPanel = <AssigneePicker branchNames={branchNames} departmentNames={departmentNames} disabledIds={doers} label="In Loop · read only" multiple onChange={(nextWatchers) => { setWatchers(nextWatchers); setPanel(null); }} people={eligiblePeople.flatMap((person) => person.id ? [{ ...person, id: person.id }] : [])} selectedIds={watchers} />;

  return (
    <Modal onClose={onClose} title="Assign New Task" tone="light" wide>
      {error ? <div className="mb-4"><Notice tone="danger">{error}</Notice></div> : null}

      <form className="flex flex-col" onSubmit={(event) => void submitManual(event)}>
          <label className="border-b border-task-border px-1 pb-3">
            <span className="sr-only">Task title</span>
            <input autoFocus className="w-full bg-transparent text-base font-medium text-task-text placeholder:text-task-text-muted/80 focus-visible:ring-0" data-autofocus maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Add Title" value={title} />
          </label>
          <label className="border-b border-task-border px-1 py-3">
            <span className="sr-only">Task description</span>
            <textarea className="min-h-24 w-full resize-y rounded-xl bg-task-muted p-3 text-base md:text-sm text-task-text placeholder:text-task-text-muted focus-visible:ring-task-accent" onChange={(event) => setDescription(event.target.value)} placeholder="Add Description" value={description} />
          </label>
          <section className="border-b border-task-border py-3">
            <button aria-expanded={checklistOpen} className="flex min-h-11 w-full items-center justify-between text-sm font-semibold text-task-text" onClick={() => setChecklistOpen((current) => !current)} type="button"><span className="flex items-center gap-2"><Plus className="size-4" />Add Checklist</span><ChevronDown className={cn("size-4 transition-transform", checklistOpen ? "rotate-180" : "")} /></button>
            {checklistOpen ? <div className="mt-2 space-y-2"><input className="task-field" onChange={(event) => setChecklistDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addChecklistItem(); } }} placeholder="Type and hit Enter" value={checklistDraft} />{checklist.map((item, index) => <div className="flex items-center gap-3 rounded-xl border border-task-border bg-task-muted px-3 py-2 text-sm text-task-text" key={`${item}-${index}`}><input aria-label={`Required checklist item ${index + 1}`} checked readOnly type="checkbox" /><span className="min-w-0 flex-1 truncate">{item}</span><button aria-label={`Remove checklist item ${index + 1}`} className="text-task-text-muted hover:text-task-text" onClick={() => setChecklist((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><X className="size-4" /></button></div>)}</div> : null}
          </section>

          <div className="grid grid-cols-2 gap-2 border-b border-task-border py-3">
            <TaskSelector id="users" open={panel === "users"} panel={usersPanel}><ChipSelector active={panel === "users"} Icon={Users} label="Users" onClick={() => togglePanel("users")} summary={doers.length ? `${doers.length} user${doers.length === 1 ? "" : "s"}` : undefined} /></TaskSelector>
            <TaskSelector id="due" open={panel === "due"} panel={duePanel}><ChipSelector active={panel === "due"} Icon={CalendarDays} label="Due Date" onClick={() => togglePanel("due")} summary={planned ? new Date(planned).toLocaleString("en-IN", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" }) : undefined} /></TaskSelector>
            <TaskSelector id="priority" open={panel === "priority"} panel={priorityPanel}><ChipSelector active={panel === "priority"} Icon={Flag} label="Priority" onClick={() => togglePanel("priority")} summary={priorityLabel} /></TaskSelector>
            <TaskSelector id="form" open={panel === "form"} panel={formPanel}><ChipSelector active={panel === "form"} Icon={FileText} label="Attach Form" onClick={() => togglePanel("form")} summary={attachedForm?.name} /></TaskSelector>
            <TaskSelector id="watchers" open={panel === "watchers"} panel={watchersPanel}><ChipSelector active={panel === "watchers"} Icon={UserRoundCheck} label="In Loop" onClick={() => togglePanel("watchers")} summary={watchers.length ? `${watchers.length} in loop` : undefined} /></TaskSelector>
          </div>


          <div className="sticky -bottom-5 -mx-5 mt-4 flex items-center gap-3 border-t border-task-border bg-task-bg px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <label className="flex size-11 cursor-pointer items-center justify-center rounded-lg text-task-text-muted hover:bg-task-muted"><Paperclip className="size-5" /><span className="sr-only">Attach image or document</span><input accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} type="file" /></label>
            <Button className="ml-auto bg-task-accent text-task-text hover:bg-task-accent/90" disabled={saving} type="submit"><Rocket />{saving ? "Assigning…" : "Assign Task"}</Button>
          </div>
      </form>
    </Modal>
  );
}
