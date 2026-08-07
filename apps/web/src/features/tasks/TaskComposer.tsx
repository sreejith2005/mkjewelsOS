import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, CalendarDays, Check, ChevronDown, ClipboardCheck, Flag, Layers3, Plus, Rocket, Trash2, Users, UserRoundCheck } from "lucide-react";
import { normalizeTaskParticipants, type Enums, type Json } from "@jewelos/core";
import type { UserProfile } from "@/types";
import { Button, Modal, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ChipSelector } from "./ChipSelector";
import type { TaskReferenceData } from "./api";
import { UserPicker } from "./UserPicker";

type ChecklistDraft = { item_text: string; is_required: boolean; sort_order: number };
type Panel = "users" | "due" | "priority" | "category" | "watchers" | null;
type ComposerMode = "manual" | "template";

export function TaskComposer({ data, onClose, onCreated, onManageTemplates, onSave, onUseTemplate, profile }: {
  data: TaskReferenceData;
  onClose: () => void;
  onCreated: () => void;
  onManageTemplates: () => void;
  onSave: (payload: Json, doers: string[], watchers: string[], checklist: Json) => Promise<void>;
  onUseTemplate: (templateId: string, planned: string) => Promise<void>;
  profile: UserProfile;
}) {
  const [mode, setMode] = useState<ComposerMode>("manual");
  const [panel, setPanel] = useState<Panel>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [planned, setPlanned] = useState("");
  const [priority, setPriority] = useState<Enums<"task_priority">>("high");
  const [categoryId, setCategoryId] = useState("");
  const [doers, setDoers] = useState<string[]>([]);
  const [watchers, setWatchers] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<ChecklistDraft[]>([]);
  const [checklistText, setChecklistText] = useState("");
  const [requiresUpload, setRequiresUpload] = useState(false);
  const [requiresRemark, setRequiresRemark] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [templatePlanned, setTemplatePlanned] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const eligibleDoers = useMemo(() => data.users.filter((user) =>
    user.branch_id === profile.branch_id && user.department_id === profile.department_id),
  [data.users, profile.branch_id, profile.department_id]);
  const eligibleWatchers = useMemo(() => data.users.filter((user) =>
    profile.user_role === "manager" ? user.branch_id === profile.branch_id : user.tenant_id === profile.tenant_id),
  [data.users, profile.branch_id, profile.tenant_id, profile.user_role]);
  const category = data.categories.find((item) => item.id === categoryId);
  const activeTemplates = data.templates.filter((template) => template.is_active);

  const togglePanel = (next: Exclude<Panel, null>) => setPanel((current) => current === next ? null : next);
  const addChecklistItem = () => {
    const itemText = checklistText.trim();
    if (!itemText) return;
    setChecklist((current) => [...current, { item_text: itemText, is_required: true, sort_order: current.length }]);
    setChecklistText("");
  };

  const submitManual = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Add a task title.");
    if (doers.length === 0) return setError("Select at least one user.");
    if (!planned) return setError("Choose a due date and time.");
    if (!categoryId) return setError("Choose an active task category.");
    setSaving(true);
    try {
      const participants = normalizeTaskParticipants(doers, watchers);
      await onSave({
        title: title.trim(),
        description: description.trim(),
        planned_datetime: new Date(planned).toISOString(),
        priority,
        category_id: categoryId,
        requires_upload: requiresUpload,
        requires_remark: requiresRemark,
      }, [...participants.doerIds], [...participants.watcherIds], checklist);
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

          <div className="flex flex-wrap gap-2 border-b border-task-border py-3">
            <ChipSelector active={panel === "users"} Icon={Users} label="Users" onClick={() => togglePanel("users")} summary={doers.length ? `${doers.length} user${doers.length === 1 ? "" : "s"}` : undefined} />
            <ChipSelector active={panel === "due"} Icon={CalendarDays} label="Due Date" onClick={() => togglePanel("due")} summary={planned ? new Date(planned).toLocaleString("en-IN", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" }) : undefined} />
            <ChipSelector active={panel === "priority"} Icon={Flag} label="Priority" onClick={() => togglePanel("priority")} summary={priority[0]!.toUpperCase() + priority.slice(1)} />
            <ChipSelector active={panel === "category"} Icon={Layers3} label="Category" onClick={() => togglePanel("category")} summary={category?.label} />
            <ChipSelector active={panel === "watchers"} Icon={UserRoundCheck} label="In Loop" onClick={() => togglePanel("watchers")} summary={watchers.length ? `${watchers.length} in loop` : undefined} />
          </div>

          {panel === "users" ? <div className="py-3"><UserPicker disabledIds={watchers} label="Eligible users" onChange={setDoers} selectedIds={doers} users={eligibleDoers} /></div> : null}
          {panel === "watchers" ? <div className="py-3"><UserPicker disabledIds={doers} label="In Loop · read only" onChange={setWatchers} selectedIds={watchers} users={eligibleWatchers} /></div> : null}
          {panel === "due" ? <div className="py-3"><label><span className="mb-1 block text-xs font-semibold text-task-text">Due date and time</span><input className="task-field" min={new Date().toISOString().slice(0, 16)} onChange={(event) => setPlanned(event.target.value)} type="datetime-local" value={planned} /></label></div> : null}
          {panel === "priority" ? <fieldset className="grid grid-cols-3 gap-2 py-3"><legend className="sr-only">Priority</legend>{(["high", "medium", "low"] as const).map((value) => <button className={cn("min-h-11 rounded-lg border text-sm capitalize", priority === value ? "border-task-accent bg-task-accent-soft text-task-text" : "border-task-border text-task-text-muted")} key={value} onClick={() => { setPriority(value); setPanel(null); }} type="button">{priority === value ? <Check className="mr-1 inline size-4" /> : null}{value}</button>)}</fieldset> : null}
          {panel === "category" ? <fieldset className="grid max-h-48 gap-1 overflow-y-auto py-3 sm:grid-cols-2"><legend className="sr-only">Task category</legend>{data.categories.map((item) => <button className={cn("min-h-11 rounded-lg border px-3 text-left text-sm", categoryId === item.id ? "border-task-accent bg-task-accent-soft text-task-text" : "border-task-border text-task-text-muted")} key={item.id} onClick={() => { setCategoryId(item.id); setPanel(null); }} type="button">{item.label}</button>)}</fieldset> : null}

          <button aria-expanded={detailsOpen} className="flex min-h-12 items-center gap-2 border-b border-task-border text-left text-sm font-semibold text-task-text-muted" onClick={() => setDetailsOpen((open) => !open)} type="button">
            <Plus className="size-4" /> Add Checklist & Requirements <ChevronDown className={cn("ml-auto size-4 transition-transform", detailsOpen && "rotate-180")} />
          </button>
          {detailsOpen ? <div className="flex flex-col gap-3 border-b border-task-border py-3">
            {checklist.map((item, index) => <div className="flex items-center gap-2 rounded-lg bg-task-muted p-2" key={`${item.item_text}-${index}`}><ClipboardCheck className="size-4 text-task-accent" /><span className="flex-1 text-sm text-task-text">{item.item_text}</span><button aria-label={`Remove ${item.item_text}`} className="flex size-10 items-center justify-center rounded-lg text-task-text-muted hover:bg-task-bg" onClick={() => setChecklist((current) => current.filter((_, itemIndex) => itemIndex !== index).map((next, nextIndex) => ({ ...next, sort_order: nextIndex })))} type="button"><Trash2 className="size-4" /></button></div>)}
            <div className="flex gap-2"><input className="task-field" onChange={(event) => setChecklistText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addChecklistItem(); } }} placeholder="Checklist item" value={checklistText} /><Button className="shrink-0 bg-task-bg text-task-text hover:bg-task-muted" onClick={addChecklistItem} type="button" variant="secondary">Add</Button></div>
            <div className="flex flex-wrap gap-4 text-sm text-task-text">
              <label className="flex min-h-11 items-center gap-2"><input checked={requiresUpload} className="size-4 accent-task-accent" onChange={(event) => setRequiresUpload(event.target.checked)} type="checkbox" />Require upload</label>
              <label className="flex min-h-11 items-center gap-2"><input checked={requiresRemark} className="size-4 accent-task-accent" onChange={(event) => setRequiresRemark(event.target.checked)} type="checkbox" />Require remark</label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={() => { setMode("template"); setError(null); }} type="button" variant="secondary">Use task template</Button>
              <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={onManageTemplates} type="button" variant="secondary">Manage templates</Button>
            </div>
          </div> : null}

          <div className="sticky -bottom-5 -mx-5 mt-4 flex items-center gap-3 border-t border-task-border bg-task-bg px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
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
