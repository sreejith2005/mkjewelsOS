import { useMemo, useState, type FormEvent } from "react";
import type { Json } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import type { TaskReferenceData, TaskTemplate } from "./api";

/**
 * Schedule kinds the recurring save contract accepts, with the recurrence rule
 * each one stores. `one_time` and `as_required` still carry a rule because
 * `save_task_template_with_audit` validates one on every template; the
 * materializer keys off `schedule_kind`, not the rule, for those two.
 */
const FREQUENCIES = [
  ["daily", "DAILY", "FREQ=DAILY"],
  ["alternate_days", "ALTERNATE DAYS", "FREQ=DAILY;INTERVAL=2"],
  ["weekly", "WEEKLY", "FREQ=WEEKLY"],
  ["monthly", "MONTHLY", "FREQ=MONTHLY"],
  ["quarterly", "QUARTERLY", "FREQ=MONTHLY;INTERVAL=3"],
  ["yearly", "YEARLY", "FREQ=YEARLY"],
  ["one_time", "ONE TIME", "FREQ=DAILY;COUNT=1"],
  ["as_required", "AS REQUIRED", "FREQ=DAILY;COUNT=1"],
] as const;

/**
 * Alternate days is a recurrence interval, not one of the schedule kinds the
 * database check constraint knows, so it is stored as a plain recurrence.
 */
const SCHEDULE_KINDS: Record<string, string> = { alternate_days: "recurring" };

const PRIORITIES = [
  ["high", "HIGH"],
  ["medium", "MEDIUM"],
  ["low", "LOW"],
] as const;

type ChecklistDraft = { key: string; text: string; required: boolean };

function frequencyOf(template: TaskTemplate | null): string {
  if (!template) return "daily";
  const rule = (template.recurrence_rule ?? "").toUpperCase();
  if (template.schedule_kind === "recurring" && rule.includes("FREQ=DAILY") && rule.includes("INTERVAL=2")) {
    return "alternate_days";
  }
  const kind = template.schedule_kind ?? "";
  return FREQUENCIES.some(([value]) => value === kind) ? kind : "daily";
}

/** Reads the stored `checklist_items` jsonb back into editable rows. */
function checklistOf(template: TaskTemplate | null): ChecklistDraft[] {
  const items = template?.checklist_items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const text = typeof item.item_text === "string" ? item.item_text : "";
    return [{ key: `stored-${index}`, text, required: item.is_required !== false }];
  });
}

export function TaskTemplateForm({ data, template, onCancel, onSave }: { data: TaskReferenceData; template: TaskTemplate | null; onCancel: () => void; onSave: (id: string | null, payload: Json) => Promise<void> }) {
  void onCancel;
  const [user, setUser] = useState(template?.default_assignee_user_id ?? "");
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [frequency, setFrequency] = useState(() => frequencyOf(template));
  const [start, setStart] = useState(template?.starts_on ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const [startTime, setStartTime] = useState(template?.planned_time?.slice(0, 5) ?? "");
  const [dueTime, setDueTime] = useState(template?.due_time?.slice(0, 5) ?? template?.planned_time?.slice(0, 5) ?? "");
  const [mode, setMode] = useState<"task" | "checklist">(template?.task_type === "delegation" ? "task" : "checklist");
  const [buddy, setBuddy] = useState(template?.buddy_assignment_allowed ?? true);
  const [priority, setPriority] = useState<string>(template?.priority ?? "medium");
  const [checklist, setChecklist] = useState<ChecklistDraft[]>(() => checklistOf(template));
  const [verification, setVerification] = useState(template?.verification_required ?? false);
  const [verifier, setVerifier] = useState(template?.verifier_user_profile_id ?? "");
  const [followup, setFollowup] = useState(template?.followup_enabled ?? false);
  const [requiresRemark, setRequiresRemark] = useState(template?.requires_remark ?? false);
  const [requiresForm, setRequiresForm] = useState(template?.requires_form ?? false);
  const [formTemplateId, setFormTemplateId] = useState(template?.form_template_id ?? "");
  const [active, setActive] = useState(template?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const assignee = useMemo(() => data.users.find((candidate) => candidate.id === user), [data.users, user]);

  const addItem = () => setChecklist((rows) => [...rows, { key: `new-${Date.now()}-${rows.length}`, text: "", required: true }]);
  const setItem = (key: string, patch: Partial<ChecklistDraft>) =>
    setChecklist((rows) => rows.map((row) => row.key === key ? { ...row, ...patch } : row));
  const removeItem = (key: string) => setChecklist((rows) => rows.filter((row) => row.key !== key));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!assignee || !title || !start || !startTime || !dueTime) { setError("Complete all required task details."); return; }
    // task_templates_due_after_start (migration 0100) requires a strictly later
    // deadline; say so here instead of surfacing a check-constraint violation.
    if (dueTime <= startTime) { setError("Due Time must be later than the Scheduled Start Time."); return; }
    if (verification && !verifier) { setError("Choose who verifies this task."); return; }
    if (requiresForm && !formTemplateId) { setError("Choose the form this task must submit."); return; }
    const items = checklist
      .map((row, index) => ({ item_text: row.text.trim(), is_required: row.required, sort_order: index }))
      .filter((row) => row.item_text.length > 0);
    if (mode === "checklist" && items.length === 0 && !requiresForm) {
      setError("Add at least one checklist item, or require a form instead."); return;
    }
    setSaving(true);
    try {
      await onSave(template?.id ?? null, {
        title,
        description,
        recurrence_rule: FREQUENCIES.find(([value]) => value === frequency)?.[2] ?? "FREQ=DAILY",
        schedule_kind: SCHEDULE_KINDS[frequency] ?? frequency,
        starts_on: start,
        planned_time: startTime,
        due_time: dueTime,
        priority,
        branch_id: assignee.branch_id,
        department_id: assignee.department_id,
        default_assignee_type: "specific_user",
        default_assignee_user_id: assignee.id,
        default_assignee_role: "",
        task_type: mode === "task" ? "delegation" : "checklist",
        buddy_assignment_allowed: buddy,
        checklist_items: mode === "task" ? [] : items,
        requires_upload: mode === "task",
        requires_remark: requiresRemark,
        requires_form: requiresForm,
        form_template_id: requiresForm ? formTemplateId : "",
        is_active: active,
        verification_required: verification,
        verifier_user_profile_id: verification ? verifier : "",
        followup_enabled: followup,
        personal_performance_enabled: true,
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save task"); } finally { setSaving(false); }
  };

  return <form className="space-y-3" onSubmit={(event) => void submit(event)}>{error ? <Notice tone="danger">{error}</Notice> : null}
    <section className="rounded-2xl border border-task-border bg-task-bg p-4">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wider">1 · Assignment</p>
      <Field label="Assign To User *"><select className="field" required value={user} onChange={(event) => setUser(event.target.value)}><option value="">Select user</option>{data.users.map((candidate) => candidate.id ? <option key={candidate.id} value={candidate.id}>{candidate.employee_name}</option> : null)}</select></Field>
      {assignee ? <p className="mt-3 text-sm text-task-text-muted">Branch and department are automatically taken from this user’s profile.</p> : null}
      <div className="mt-4"><Field label="Core Task *"><input className="field" required placeholder="Enter the responsibility / task name" value={title} onChange={(event) => setTitle(event.target.value)} /></Field></div>
      <div className="mt-4"><Field label="Description"><textarea className="field min-h-24" placeholder="What should be completed?" value={description} onChange={(event) => setDescription(event.target.value)} /></Field></div>
    </section>

    <section className="rounded-2xl border border-task-border bg-task-bg p-4">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wider">2 · Schedule</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Frequency *"><select className="field" value={frequency} onChange={(event) => setFrequency(event.target.value)}>{FREQUENCIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Task Start Date *"><input className="field" required type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
        <Field label="Scheduled Start Time"><input className="field" required type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></Field>
        <Field label="Due Time"><input className="field" required type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} /></Field>
        <Field label="Priority"><select className="field" value={priority} onChange={(event) => setPriority(event.target.value)}>{PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Schedule Status"><select className="field" value={active ? "active" : "paused"} onChange={(event) => setActive(event.target.value === "active")}><option value="active">ACTIVE</option><option value="paused">PAUSED</option></select></Field>
      </div>
      {!start ? <Notice tone="task">Select a start date.</Notice> : null}
    </section>

    <section className="rounded-2xl border border-task-border bg-task-bg p-4">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wider">3 · Task Controls</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Task Type"><select className="field" value={mode} onChange={(event) => setMode(event.target.value as "task" | "checklist")}><option value="checklist">CHECKBOX — Tap to complete</option><option value="task">TASK — Upload image to complete</option></select></Field>
        <Field label="Buddy Assignment Allowed"><select className="field" value={buddy ? "yes" : "no"} onChange={(event) => setBuddy(event.target.value === "yes")}><option value="yes">Yes</option><option value="no">No</option></select></Field>
        <Field label="Completion Remark Required"><select className="field" value={requiresRemark ? "yes" : "no"} onChange={(event) => setRequiresRemark(event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></Field>
        <Field label="Follow-ups Allowed"><select className="field" value={followup ? "yes" : "no"} onChange={(event) => setFollowup(event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></Field>
        <Field label="Form Required"><select className="field" value={requiresForm ? "yes" : "no"} onChange={(event) => setRequiresForm(event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></Field>
        {requiresForm ? <Field label="Form *"><select className="field" required value={formTemplateId} onChange={(event) => setFormTemplateId(event.target.value)}><option value="">Select form</option>{data.forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></Field> : null}
      </div>
    </section>

    <section className="rounded-2xl border border-task-border bg-task-bg p-4">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wider">4 · Verification</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Verification Required"><select className="field" value={verification ? "yes" : "no"} onChange={(event) => setVerification(event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></Field>
        {verification ? <Field label="Verifier *"><select className="field" required value={verifier} onChange={(event) => setVerifier(event.target.value)}><option value="">Select verifier</option>{data.users.map((candidate) => candidate.id ? <option key={candidate.id} value={candidate.id}>{candidate.employee_name}</option> : null)}</select></Field> : null}
      </div>
      {verification ? <p className="mt-3 text-sm text-task-text-muted">A rejected task returns to the doer to redo.</p> : null}
    </section>

    {mode === "checklist" ? (
      <section className="rounded-2xl border border-task-border bg-task-bg p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider">5 · Checklist</p>
          <Button onClick={addItem} type="button" variant="secondary">Add item</Button>
        </div>
        {checklist.length === 0 ? <Notice tone="task">Every occurrence of this schedule generates these checklist items.</Notice> : null}
        <div className="space-y-2">
          {checklist.map((row, index) => (
            <div className="flex flex-wrap items-center gap-2" key={row.key}>
              <span className="w-6 text-sm text-task-text-muted">{index + 1}.</span>
              <input aria-label={`Checklist item ${index + 1}`} className="field min-w-48 flex-1" placeholder="Checklist item" value={row.text} onChange={(event) => setItem(row.key, { text: event.target.value })} />
              <label className="flex items-center gap-2 text-xs text-task-text-muted">
                <input checked={row.required} onChange={(event) => setItem(row.key, { required: event.target.checked })} type="checkbox" />
                Mandatory
              </label>
              <Button aria-label={`Remove checklist item ${index + 1}`} onClick={() => removeItem(row.key)} type="button" variant="danger">Remove</Button>
            </div>
          ))}
        </div>
      </section>
    ) : null}

    <div className="flex justify-end"><Button disabled={saving} type="submit">{saving ? "Saving…" : template ? "Update Task" : "Save Task"}</Button></div>
  </form>;
}

export function DelegationTaskForm() { return null; }
export function UseTemplateForm() { return null; }
