import { useMemo, useState, type FormEvent } from "react";
import {
  AS_NEEDED_TRIGGER_SUGGESTIONS,
  SCHEDULE_EDIT_EFFECT,
  SCHEDULE_PRESETS,
  buildScheduledTaskPayload,
  kolkataDateKey,
  scheduledTaskDraftFromTemplate,
  validateScheduledTaskDraft,
  type Json,
  type ScheduledTaskDraft,
  type ScheduledTaskPriority,
} from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { TaskReferenceData, TaskTemplate } from "./api";
import { ScheduleFields, type CalendarTiming } from "./schedule/ScheduleFields";
import { ScheduleOptions } from "./schedule/ScheduleOptions";

function newDraft(today: string): ScheduledTaskDraft {
  return {
    title: "", description: "", mode: "checklist", checklistItems: [], priority: "medium", formTemplateId: "",
    startTime: "11:00", dueTime: "13:00",
    timing: { type: "calendar", spec: SCHEDULE_PRESETS[0]!.spec(today), startsOn: today, keepRule: null },
    verificationRequired: false, verifierId: "", followupEnabled: false, requiresRemark: false, buddy: true,
    active: true, personalPerformance: true,
  };
}

/**
 * Task Control's Add Task / Edit task template form. It builds schedules with
 * the same `ScheduleFields` as Create Task and saves the same payload
 * (`buildScheduledTaskPayload`), so a schedule means the same thing whichever
 * screen made it. Editing writes back every setting the template already has.
 */
export function TaskTemplateForm({ data, template, initialAssigneeId, onCancel, onSave }: { data: TaskReferenceData; template: TaskTemplate | null; initialAssigneeId?: string; onCancel: () => void; onSave: (id: string | null, payload: Json) => Promise<void> }) {
  const today = kolkataDateKey(new Date());
  const [user, setUser] = useState(template?.default_assignee_user_id ?? initialAssigneeId ?? "");
  const [draft, setDraft] = useState<ScheduledTaskDraft>(() => (template ? scheduledTaskDraftFromTemplate(template, today) : newDraft(today)));
  const [calendar, setCalendar] = useState<CalendarTiming>(() => draft.timing.type === "calendar" ? draft.timing : newDraft(today).timing as CalendarTiming);
  const [checklistText, setChecklistText] = useState(() => draft.checklistItems.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const assignee = useMemo(() => data.users.find((candidate) => candidate.id === user), [data.users, user]);
  const asNeeded = draft.timing.type === "as_required";
  const set = (patch: Partial<ScheduledTaskDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const current: ScheduledTaskDraft = {
      ...draft,
      timing: asNeeded ? draft.timing : calendar,
      checklistItems: draft.mode === "checklist" ? checklistText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) : [],
    };
    const people = assignee?.id ? [{ id: assignee.id, branch_id: assignee.branch_id, department_id: assignee.department_id }] : [];
    const invalid = validateScheduledTaskDraft(current, people);
    if (invalid || !people[0]) { setError(invalid ?? "Choose who does this work."); return; }
    setError(null);
    setSaving(true);
    try {
      await onSave(template?.id ?? null, buildScheduledTaskPayload(current, people[0], !template) as Json);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save task"); } finally { setSaving(false); }
  };

  return <form className="space-y-3" onSubmit={(event) => void submit(event)}>{error ? <Notice tone="danger">{error}</Notice> : null}
    <section className="rounded-2xl border border-task-border bg-task-bg p-4"><p className="mb-4 text-xs font-semibold uppercase tracking-wider">1 · Assignment</p>
      <Field label="Assign To User *"><select className="field" required value={user} onChange={(event) => setUser(event.target.value)}><option value="">Select user</option>{data.users.map((candidate) => candidate.id ? <option key={candidate.id} value={candidate.id}>{candidate.employee_name}</option> : null)}</select></Field>
      {assignee ? <p className="mt-3 text-sm text-task-text-muted">Branch and department are automatically taken from this user’s profile.</p> : null}
      <div className="mt-4"><Field label="Core Task *"><input className="field" maxLength={200} required placeholder="Enter the responsibility / task name" value={draft.title} onChange={(event) => set({ title: event.target.value })} /></Field></div><div className="mt-4"><Field label="Description"><textarea className="field min-h-24" placeholder="What should be completed?" value={draft.description} onChange={(event) => set({ description: event.target.value })} /></Field></div></section>
    <section className="rounded-2xl border border-task-border bg-task-bg p-4"><p className="mb-4 text-xs font-semibold uppercase tracking-wider">2 · Schedule</p>
      <div className="mb-4 grid grid-cols-2 gap-2" role="group" aria-label="Schedule type">
        {([["calendar", "Recurring"], ["as_required", "As needed"]] as const).map(([value, label]) => <button aria-pressed={draft.timing.type === value} className={cn("min-h-11 rounded-lg border px-3 text-sm", draft.timing.type === value ? "border-task-accent bg-task-accent-soft font-semibold text-task-text" : "border-task-border text-task-text-muted")} key={value} onClick={() => set({ timing: value === "calendar" ? calendar : { type: "as_required", triggerLabel: template?.trigger_label ?? "" } })} type="button">{label}</button>)}
      </div>
      {asNeeded && draft.timing.type === "as_required" ? <div className="space-y-2">
        <Field label="When does it apply?"><input className="field" list="template-triggers" maxLength={80} placeholder="As Required, Per Customer, After Visit…" value={draft.timing.triggerLabel} onChange={(event) => set({ timing: { type: "as_required", triggerLabel: event.target.value } })} /></Field>
        <datalist id="template-triggers">{AS_NEEDED_TRIGGER_SUGGESTIONS.map((label) => <option key={label} value={label} />)}</datalist>
        <p className="text-xs text-task-text-muted">Nothing is created on a calendar. Employees start it under “Anytime duties”; use “Assign now” to give it as high priority.</p>
      </div> : <ScheduleFields assigneeNames={assignee?.employee_name ? [assignee.employee_name] : []} dueTime={draft.dueTime} isNew={!template} onDueTime={(dueTime) => set({ dueTime })} onStartTime={(startTime) => set({ startTime })} onTiming={setCalendar} onUseCheckpoints={(labels) => { set({ mode: "checklist" }); setChecklistText(labels.map((label) => `${label}: ${draft.title.trim() || "Task"}`).join("\n")); }} startTime={draft.startTime} timing={calendar} />}
      {template ? <div className="mt-4"><Notice tone="task">{SCHEDULE_EDIT_EFFECT}</Notice></div> : null}
    </section>
    <section className="rounded-2xl border border-task-border bg-task-bg p-4"><p className="mb-4 text-xs font-semibold uppercase tracking-wider">3 · Task Controls</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Task Type *"><select className="field" value={draft.mode} onChange={(event) => set({ mode: event.target.value as "task" | "checklist" })}><option value="checklist">CHECKBOX — Tap to complete</option><option value="task">TASK — Upload image to complete</option></select></Field>
      <Field label="Priority"><select className="field" value={draft.priority} onChange={(event) => set({ priority: event.target.value as ScheduledTaskPriority })}>{(["high", "medium", "low"] as const).map((value) => <option key={value} value={value}>{data.priorities.find((priority) => priority.value === value)?.label ?? value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></Field></div>
      {draft.mode === "checklist" ? <div className="mt-4"><Field label="Checklist items (one per line)"><textarea className="field min-h-24" placeholder="Leave empty to complete with one tap" value={checklistText} onChange={(event) => setChecklistText(event.target.value)} /></Field></div> : null}
      <div className="mt-4"><ScheduleOptions onChange={(values) => set(values)} people={data.users} values={draft} /></div>
    </section>
    <Field label="Required form version"><select className="field" value={draft.formTemplateId} onChange={(event) => set({ formTemplateId: event.target.value })}><option value="">No form required</option>{draft.formTemplateId && !data.forms.some((form) => form.id === draft.formTemplateId) ? <option value={draft.formTemplateId}>Current pinned form (unavailable for new work)</option> : null}{data.forms.filter((form) => form.lifecycle === "published" || form.id === draft.formTemplateId).map((form) => <option key={form.id} value={form.id}>{form.name} v{form.version}{form.lifecycle === "archived" ? " (current pinned version)" : " (published)"}</option>)}</select></Field>
    <div className="flex justify-end gap-2"><Button disabled={saving} onClick={onCancel} type="button" variant="secondary">Cancel</Button><Button disabled={saving} type="submit">{saving ? "Saving…" : template ? "Update Task" : "Save Task"}</Button></div>
  </form>;
}

export function DelegationTaskForm() { return null; }
export function UseTemplateForm() { return null; }
