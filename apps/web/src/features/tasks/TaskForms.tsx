import { useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Enums, Json } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import type { TaskReferenceData, TaskTemplate } from "./api";

type ChecklistDraft = { item_text: string; is_required: boolean; sort_order: number };

const TASK_ROLES: Array<Enums<"user_role">> = [
  "super_admin", "admin", "manager", "hr", "crm", "staff", "doer", "housekeeping",
];
const WEEKDAYS = [
  { code: "MO", label: "Mon" }, { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" }, { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" }, { code: "SA", label: "Sat" },
  { code: "SU", label: "Sun" },
] as const;

function readChecklist(value: Json): ChecklistDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || Array.isArray(item) || typeof item !== "object") return [];
    const text = typeof item.item_text === "string" ? item.item_text : "";
    return text ? [{
      item_text: text,
      is_required: typeof item.is_required === "boolean" ? item.is_required : true,
      sort_order: typeof item.sort_order === "number" ? item.sort_order : index,
    }] : [];
  });
}

function ChecklistEditor({ items, onChange }: { items: ChecklistDraft[]; onChange: (items: ChecklistDraft[]) => void }) {
  const [text, setText] = useState("");
  const [required, setRequired] = useState(true);
  const add = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onChange([...items, { item_text: trimmed, is_required: required, sort_order: items.length }]);
    setText("");
    setRequired(true);
  };
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-gold/20 p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-champagne">Checklist items</legend>
      {items.map((item, index) => (
        <div className="flex items-center gap-2 rounded-lg bg-obsidian p-3" key={`${item.item_text}-${index}`}>
          <span className="flex-1 text-sm text-white">{item.item_text}</span>
          <span className="text-xs text-soft-grey">{item.is_required ? "Required" : "Optional"}</span>
          <Button aria-label="Remove item" className="size-9 p-0" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} type="button" variant="ghost">
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="field flex-1" onChange={(event) => setText(event.target.value)} placeholder="Add a checklist item" value={text} />
        <label className="flex items-center gap-2 text-sm text-champagne">
          <input checked={required} onChange={(event) => setRequired(event.target.checked)} type="checkbox" /> Required
        </label>
        <Button onClick={add} type="button" variant="secondary"><Plus />Add</Button>
      </div>
    </fieldset>
  );
}

export function DelegationTaskForm({ data, onCancel, onSave }: {
  data: TaskReferenceData;
  onCancel: () => void;
  onSave: (payload: Json, doers: string[], watchers: string[], checklist: Json) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [planned, setPlanned] = useState("");
  const [priority, setPriority] = useState<Enums<"task_priority">>("medium");
  const [doers, setDoers] = useState<string[]>([]);
  const [watchers, setWatchers] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<ChecklistDraft[]>([]);
  const [requiresUpload, setRequiresUpload] = useState(false);
  const [requiresRemark, setRequiresRemark] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!planned || doers.length === 0) return setError("Choose a due date and at least one doer.");
    setSaving(true);
    try {
      await onSave({ title: title.trim(), description: description.trim(), planned_datetime: new Date(planned).toISOString(), priority, requires_upload: requiresUpload, requires_remark: requiresRemark }, doers, watchers, checklist);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create task");
    } finally { setSaving(false); }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="Title"><input className="field" maxLength={200} onChange={(event) => setTitle(event.target.value)} required value={title} /></Field>
      <Field label="Description"><textarea className="field min-h-20 resize-y" onChange={(event) => setDescription(event.target.value)} value={description} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Planned date and time"><input className="field" onChange={(event) => setPlanned(event.target.value)} required type="datetime-local" value={planned} /></Field>
        <Field label="Priority"><select className="field" onChange={(event) => setPriority(event.target.value as Enums<"task_priority">)} value={priority}>{data.priorities.map((item) => <option key={item.id} value={item.value}>{item.label}</option>)}</select></Field>
      </div>
      <fieldset className="grid max-h-48 gap-2 overflow-y-auto rounded-xl border border-gold/20 p-4 sm:grid-cols-2">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-champagne">Doers</legend>
        {data.users.map((user) => user.id ? (
          <label className="flex items-center gap-2 text-sm text-white" key={user.id}>
            <input checked={doers.includes(user.id)} disabled={watchers.includes(user.id)} onChange={(event) => setDoers((current) => event.target.checked ? [...current, user.id as string] : current.filter((id) => id !== user.id))} type="checkbox" />
            {user.employee_name} <span className="text-xs text-soft-grey">{user.user_role}</span>
          </label>
        ) : null)}
      </fieldset>
      <fieldset className="grid max-h-48 gap-2 overflow-y-auto rounded-xl border border-gold/20 p-4 sm:grid-cols-2">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-champagne">In Loop (read only)</legend>
        {data.users.map((user) => user.id ? <label className="flex items-center gap-2 text-sm text-white" key={user.id}><input checked={watchers.includes(user.id)} disabled={doers.includes(user.id)} onChange={(event) => setWatchers((current) => event.target.checked ? [...current, user.id as string] : current.filter((id) => id !== user.id))} type="checkbox" />{user.employee_name} <span className="text-xs text-soft-grey">{user.user_role}</span></label> : null)}
      </fieldset>
      <ChecklistEditor items={checklist} onChange={setChecklist} />
      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm text-champagne"><input checked={requiresUpload} onChange={(event) => setRequiresUpload(event.target.checked)} type="checkbox" />Require upload</label>
        <label className="flex items-center gap-2 text-sm text-champagne"><input checked={requiresRemark} onChange={(event) => setRequiresRemark(event.target.checked)} type="checkbox" />Require remark</label>
      </div>
      <div className="flex justify-end gap-3"><Button onClick={onCancel} type="button" variant="secondary">Cancel</Button><Button disabled={saving} type="submit">{saving ? "Creating…" : "Create task"}</Button></div>
    </form>
  );
}

type RecurrenceKind = "daily" | "weekly" | "monthly" | "nth_weekday" | "quarterly" | "yearly" | "one_time" | "as_required";

function inferRecurrence(rule: string | null, scheduleKind?: string): RecurrenceKind {
  if (scheduleKind === "quarterly" || scheduleKind === "yearly" || scheduleKind === "one_time" || scheduleKind === "as_required") return scheduleKind;
  if (rule?.includes("BYSETPOS")) return "nth_weekday";
  if (rule?.includes("BYMONTHDAY")) return "monthly";
  if (rule?.includes("FREQ=WEEKLY")) return "weekly";
  return "daily";
}

export function TaskTemplateForm({ data, template, onCancel, onSave }: {
  data: TaskReferenceData;
  template: TaskTemplate | null;
  onCancel: () => void;
  onSave: (id: string | null, payload: Json) => Promise<void>;
}) {
  const initialRule = template?.recurrence_rule ?? "FREQ=DAILY";
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [kind, setKind] = useState<RecurrenceKind>(inferRecurrence(initialRule, template?.schedule_kind));
  const [weekdays, setWeekdays] = useState<string[]>(WEEKDAYS.filter((day) => initialRule.includes(day.code)).map((day) => day.code));
  const [monthDay, setMonthDay] = useState(Number(initialRule.match(/BYMONTHDAY=(\d+)/)?.[1] ?? 1));
  const [nth, setNth] = useState(Number(initialRule.match(/BYSETPOS=(-?\d+)/)?.[1] ?? 1));
  const [nthDay, setNthDay] = useState(initialRule.match(/BYDAY=([A-Z]{2})/)?.[1] ?? "MO");
  const [startsOn, setStartsOn] = useState(template?.starts_on ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const [plannedTime, setPlannedTime] = useState(template?.planned_time?.slice(0, 5) ?? "09:00");
  const [dueTime, setDueTime] = useState(template?.due_time?.slice(0, 5) ?? "17:00");
  const [completionType, setCompletionType] = useState<"checkbox" | "upload">(template?.requires_upload ? "upload" : "checkbox");
  const [priority, setPriority] = useState<Enums<"task_priority">>(template?.priority ?? "medium");
  const [branchId, setBranchId] = useState(template?.branch_id ?? "");
  const [departmentId, setDepartmentId] = useState(template?.department_id ?? "");
  const [assigneeType, setAssigneeType] = useState(template?.default_assignee_type ?? "specific_user");
  const [assigneeUser, setAssigneeUser] = useState(template?.default_assignee_user_id ?? "");
  const [assigneeRole, setAssigneeRole] = useState<Enums<"user_role">>(template?.default_assignee_role ?? "staff");
  const [checklist, setChecklist] = useState<ChecklistDraft[]>(readChecklist(template?.checklist_items ?? []));
  const [requiresRemark, setRequiresRemark] = useState(template?.requires_remark ?? false);
  const [requiresForm, setRequiresForm] = useState(template?.requires_form ?? false);
  const [formId, setFormId] = useState(template?.form_template_id ?? "");
  const [active, setActive] = useState(template?.is_active ?? true);
  const [verificationRequired, setVerificationRequired] = useState(template?.verification_required ?? false);
  const [followupEnabled, setFollowupEnabled] = useState(template?.followup_enabled ?? false);
  const [personalPerformanceEnabled, setPersonalPerformanceEnabled] = useState(template?.personal_performance_enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const selectedUser = useMemo(() => data.users.find((user) => user.id === assigneeUser) ?? null, [assigneeUser, data.users]);

  const recurrenceRule = kind === "daily" ? "FREQ=DAILY"
    : kind === "weekly" ? `FREQ=WEEKLY;BYDAY=${weekdays.join(",")}`
      : kind === "monthly" ? `FREQ=MONTHLY;BYMONTHDAY=${monthDay}`
        : kind === "nth_weekday" ? `FREQ=MONTHLY;BYDAY=${nthDay};BYSETPOS=${nth}`
          : kind === "quarterly" ? "FREQ=MONTHLY;INTERVAL=3"
            : kind === "yearly" ? "FREQ=YEARLY"
              : "FREQ=YEARLY;COUNT=1";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((kind === "weekly" && weekdays.length === 0) || (assigneeType === "specific_user" && !assigneeUser) || (requiresForm && !formId) || !startsOn || !plannedTime || !dueTime) {
      setError("Complete the assignee, schedule, and required form selections."); return;
    }
    if (dueTime <= plannedTime) {
      setError("Due time must be after the scheduled start time."); return;
    }
    setSaving(true); setError(null);
    try {
      await onSave(template?.id ?? null, {
        title: title.trim(), description: description.trim(), recurrence_rule: recurrenceRule, schedule_kind: kind,
        starts_on: startsOn, planned_time: plannedTime, due_time: dueTime, priority, branch_id: branchId, department_id: departmentId,
        default_assignee_type: assigneeType, default_assignee_user_id: assigneeType === "specific_user" ? assigneeUser : "", default_assignee_role: assigneeType === "role" ? assigneeRole : "",
        checklist_items: checklist, requires_upload: completionType === "upload", requires_remark: requiresRemark,
        requires_form: requiresForm, form_template_id: requiresForm ? formId : "", is_active: active,
        verification_required: verificationRequired, followup_enabled: followupEnabled,
        personal_performance_enabled: personalPerformanceEnabled, coverage_enabled: true,
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save template"); }
    finally { setSaving(false); }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <fieldset className="rounded-2xl border border-gold/20 p-4"><legend className="px-1 text-xs font-semibold uppercase tracking-wider text-champagne">1 · Assignment</legend><div className="grid gap-4 sm:grid-cols-2"><Field label="Assign to user"><select className="field" disabled={assigneeType === "role"} onChange={(event) => { const user = data.users.find((item) => item.id === event.target.value); setAssigneeUser(event.target.value); setBranchId(user?.branch_id ?? ""); setDepartmentId(user?.department_id ?? ""); }} required={assigneeType === "specific_user"} value={assigneeUser}><option value="">Select user</option>{data.users.map((user) => user.id ? <option key={user.id} value={user.id}>{user.employee_name}</option> : null)}</select></Field><Field label="Department"><input className="field" disabled value={data.departments.find((department) => department.id === (selectedUser?.department_id ?? departmentId))?.name ?? ""} /></Field><Field label="Branch"><input className="field" disabled value={data.branches.find((branch) => branch.id === (selectedUser?.branch_id ?? branchId))?.name ?? ""} /></Field></div><details className="mt-4 rounded-xl border border-gold/15 p-3"><summary className="cursor-pointer text-sm font-semibold text-champagne">Advanced assignment rule</summary><div className="mt-3 grid gap-4 sm:grid-cols-2"><Field label="Assignment mode"><select className="field" onChange={(event) => setAssigneeType(event.target.value)} value={assigneeType}><option value="specific_user">Specific user</option><option value="role">Role</option></select></Field>{assigneeType === "role" ? <Field label="Role"><select className="field" onChange={(event) => setAssigneeRole(event.target.value as Enums<"user_role">)} value={assigneeRole}>{TASK_ROLES.map((role) => <option key={role} value={role}>{role.replace("_", " ")}</option>)}</select></Field> : null}</div></details><div className="mt-4"><Field label="Core task"><input className="field" maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Enter the responsibility / task name" required value={title} /></Field></div><div className="mt-4"><Field label="Description"><textarea className="field min-h-24" onChange={(event) => setDescription(event.target.value)} placeholder="What should be completed?" value={description} /></Field></div></fieldset>
      <fieldset className="rounded-2xl border border-gold/20 p-4"><legend className="px-1 text-xs font-semibold uppercase tracking-wider text-champagne">2 · Schedule</legend><div className="grid gap-4 sm:grid-cols-2"><Field label="Frequency"><select className="field" onChange={(event) => setKind(event.target.value as RecurrenceKind)} value={kind}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly day</option><option value="nth_weekday">Nth weekday of month</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option><option value="one_time">One time</option><option value="as_required">As required</option></select></Field><Field label="Task start date"><input className="field" onChange={(event) => setStartsOn(event.target.value)} required type="date" value={startsOn} /></Field><Field label="Scheduled start time"><input className="field" onChange={(event) => setPlannedTime(event.target.value)} required type="time" value={plannedTime} /></Field><Field label="Due time"><input className="field" onChange={(event) => setDueTime(event.target.value)} required type="time" value={dueTime} /></Field></div></fieldset>
      {kind === "weekly" ? <fieldset className="flex flex-wrap gap-3 rounded-xl border border-gold/20 p-4"><legend className="px-1 text-xs text-champagne">Repeat on</legend>{WEEKDAYS.map((day) => <label className="flex items-center gap-1 text-sm text-white" key={day.code}><input checked={weekdays.includes(day.code)} onChange={(event) => setWeekdays((current) => event.target.checked ? [...current, day.code] : current.filter((code) => code !== day.code))} type="checkbox" />{day.label}</label>)}</fieldset> : null}
      {kind === "monthly" ? <Field label="Day of month"><input className="field" max={31} min={1} onChange={(event) => setMonthDay(event.target.valueAsNumber)} type="number" value={monthDay} /></Field> : null}
      {kind === "nth_weekday" ? <div className="grid grid-cols-2 gap-4"><Field label="Occurrence"><select className="field" onChange={(event) => setNth(Number(event.target.value))} value={nth}><option value={1}>First</option><option value={2}>Second</option><option value={3}>Third</option><option value={4}>Fourth</option><option value={-1}>Last</option></select></Field><Field label="Weekday"><select className="field" onChange={(event) => setNthDay(event.target.value)} value={nthDay}>{WEEKDAYS.map((day) => <option key={day.code} value={day.code}>{day.label}</option>)}</select></Field></div> : null}
      <fieldset className="rounded-2xl border border-gold/20 p-4"><legend className="px-1 text-xs font-semibold uppercase tracking-wider text-champagne">3 · Task controls</legend><div className="grid gap-4 sm:grid-cols-3"><Field label="Task type"><select className="field" onChange={(event) => setCompletionType(event.target.value as "checkbox" | "upload")} value={completionType}><option value="checkbox">Checkbox — tap to complete</option><option value="upload">Upload — attachment required</option></select></Field><Field label="Buddy assignment allowed"><input className="field" disabled value="Yes — Primary Buddy → Secondary Buddy → Manager" /></Field><Field label="Priority"><select className="field" onChange={(event) => setPriority(event.target.value as Enums<"task_priority">)} value={priority}>{data.priorities.map((item) => <option key={item.id} value={item.value}>{item.label}</option>)}</select></Field></div></fieldset>
      <ChecklistEditor items={checklist} onChange={setChecklist} />
      <div className="flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm text-champagne"><input checked={requiresRemark} onChange={(event) => setRequiresRemark(event.target.checked)} type="checkbox" />Require remark</label><label className="flex items-center gap-2 text-sm text-champagne"><input checked={requiresForm} onChange={(event) => setRequiresForm(event.target.checked)} type="checkbox" />Require form</label><label className="flex items-center gap-2 text-sm text-champagne"><input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" />Active</label></div>
      <div className="grid gap-3 rounded-xl border border-gold/15 p-4 sm:grid-cols-3"><label className="flex items-center gap-2 text-sm text-champagne"><input checked={verificationRequired} onChange={(event) => setVerificationRequired(event.target.checked)} type="checkbox" />Manager verification</label><label className="flex items-center gap-2 text-sm text-champagne"><input checked={followupEnabled} onChange={(event) => setFollowupEnabled(event.target.checked)} type="checkbox" />Follow-up enabled</label><label className="flex items-center gap-2 text-sm text-champagne"><input checked={personalPerformanceEnabled} onChange={(event) => setPersonalPerformanceEnabled(event.target.checked)} type="checkbox" />Personal performance</label></div>
      {requiresForm ? <Field label="Required form"><select className="field" onChange={(event) => setFormId(event.target.value)} value={formId}><option value="">Select form</option>{data.forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></Field> : null}
      <div className="flex justify-end gap-3"><Button onClick={onCancel} type="button" variant="secondary">Cancel</Button><Button disabled={saving} type="submit">{saving ? "Saving…" : "Save template"}</Button></div>
    </form>
  );
}

export function UseTemplateForm({ data, onCancel, onSave }: {
  data: TaskReferenceData;
  onCancel: () => void;
  onSave: (templateId: string, planned: string) => Promise<void>;
}) {
  const [templateId, setTemplateId] = useState("");
  const [planned, setPlanned] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!templateId || !planned) return setError("Choose a template and planned time.");
    setSaving(true); setError(null);
    try { await onSave(templateId, new Date(planned).toISOString()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create task"); }
    finally { setSaving(false); }
  };
  return <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>{error ? <Notice tone="danger">{error}</Notice> : null}<Field label="Template"><select className="field" onChange={(event) => setTemplateId(event.target.value)} value={templateId}><option value="">Select template</option>{data.templates.filter((template) => template.is_active).map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}</select></Field><Field label="Planned date and time"><input className="field" onChange={(event) => setPlanned(event.target.value)} type="datetime-local" value={planned} /></Field><div className="flex justify-end gap-3"><Button onClick={onCancel} type="button" variant="secondary">Cancel</Button><Button disabled={saving} type="submit">{saving ? "Creating…" : "Create from template"}</Button></div></form>;
}
