import { useMemo, useState, type FormEvent } from "react";
import {
  buildRecurringTemplatePayload,
  recurringTemplateFrequency,
  validateRecurringTemplateDraft,
  RECURRING_FREQUENCIES as FREQUENCIES,
  type Json,
} from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import type { TaskReferenceData, TaskTemplate } from "./api";

export function TaskTemplateForm({ data, template, onCancel, onSave }: { data: TaskReferenceData; template: TaskTemplate | null; onCancel: () => void; onSave: (id: string | null, payload: Json) => Promise<void> }) {
  void onCancel;
  const [user, setUser] = useState(template?.default_assignee_user_id ?? "");
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [frequency, setFrequency] = useState(() => recurringTemplateFrequency(template));
  const [start, setStart] = useState(template?.starts_on ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const [startTime, setStartTime] = useState(template?.planned_time?.slice(0, 5) ?? "");
  const [dueTime, setDueTime] = useState(template?.due_time?.slice(0, 5) ?? template?.planned_time?.slice(0, 5) ?? "");
  const [mode, setMode] = useState<"task" | "checklist">(template?.task_type === "delegation" ? "task" : "checklist");
  const [buddy, setBuddy] = useState(template?.buddy_assignment_allowed ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const assignee = useMemo(() => data.users.find((candidate) => candidate.id === user), [data.users, user]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const draft = { title, description, frequency, start, startTime, dueTime, mode, buddy };
    const invalid = validateRecurringTemplateDraft(draft, assignee ?? null);
    if (invalid || !assignee) { setError(invalid); return; }
    setSaving(true);
    try {
      await onSave(template?.id ?? null, buildRecurringTemplatePayload(draft, assignee) as Json);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save task"); } finally { setSaving(false); }
  };

  return <form className="space-y-3" onSubmit={(event) => void submit(event)}>{error ? <Notice tone="danger">{error}</Notice> : null}
    <section className="rounded-2xl border border-task-border bg-task-bg p-4"><p className="mb-4 text-xs font-semibold uppercase tracking-wider">1 · Assignment</p>
      <Field label="Assign To User *"><select className="field" required value={user} onChange={(event) => setUser(event.target.value)}><option value="">Select user</option>{data.users.map((candidate) => candidate.id ? <option key={candidate.id} value={candidate.id}>{candidate.employee_name}</option> : null)}</select></Field>
      {assignee ? <p className="mt-3 text-sm text-task-text-muted">Branch and department are automatically taken from this user’s profile.</p> : null}
      <div className="mt-4"><Field label="Core Task *"><input className="field" required placeholder="Enter the responsibility / task name" value={title} onChange={(event) => setTitle(event.target.value)} /></Field></div><div className="mt-4"><Field label="Description"><textarea className="field min-h-24" placeholder="What should be completed?" value={description} onChange={(event) => setDescription(event.target.value)} /></Field></div></section>
    <section className="rounded-2xl border border-task-border bg-task-bg p-4"><p className="mb-4 text-xs font-semibold uppercase tracking-wider">2 · Schedule</p><div className="grid gap-4 sm:grid-cols-2">
      <Field label="Frequency *"><select className="field" value={frequency} onChange={(event) => setFrequency(event.target.value)}>{FREQUENCIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Task Start Date *"><input className="field" required type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field><Field label="Scheduled Start Time"><input className="field" required type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></Field><Field label="Due Time"><input className="field" required type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} /></Field>
    </div>{!start ? <Notice tone="task">Select a start date.</Notice> : null}</section>
    <section className="rounded-2xl border border-task-border bg-task-bg p-4"><p className="mb-4 text-xs font-semibold uppercase tracking-wider">3 · Task Controls</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Task Type *"><select className="field" value={mode} onChange={(event) => setMode(event.target.value as "task" | "checklist")}><option value="checklist">CHECKBOX — Tap to complete</option><option value="task">TASK — Upload image to complete</option></select></Field><Field label="Buddy Assignment Allowed"><select className="field" value={buddy ? "yes" : "no"} onChange={(event) => setBuddy(event.target.value === "yes")}><option value="yes">Yes</option><option value="no">No</option></select></Field></div></section>
    <div className="flex justify-end"><Button disabled={saving} type="submit">{saving ? "Saving…" : template ? "Update Task" : "Save Task"}</Button></div>
  </form>;
}

export function DelegationTaskForm() { return null; }
export function UseTemplateForm() { return null; }
