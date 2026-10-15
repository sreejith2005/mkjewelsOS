import type { TaskAdminEdit } from "@jewelos/core";
import { Button, Field } from "@/components/ui";
import { AssigneePicker } from "@/components/assignees/AssigneePicker";
import type { TaskAdminEditData } from "./api";

function ReferenceSelect({ label, value, options, onChange }: Readonly<{
  label: string; value: string; options: readonly Readonly<{ id: string; label: string }>[]; onChange: (value: string) => void;
}>) {
  return <Field label={label}><select className="task-field" value={value} onChange={event => onChange(event.target.value)}>
    <option value="">None</option>
    {value && !options.some(option => option.id === value) ? <option value={value}>Current selection (unavailable)</option> : null}
    {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
  </select></Field>;
}

export function TaskAdminEditFields({ edit, onChange, reference }: Readonly<{
  edit: TaskAdminEdit; onChange: (edit: TaskAdminEdit) => void; reference: TaskAdminEditData["reference"];
}>) {
  const toggle = (label: string, key: "requiresUpload" | "requiresRemark" | "requiresForm" | "verificationRequired" | "buddyAssignmentAllowed") =>
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={edit[key] ?? false} onChange={event => onChange({ ...edit, [key]: event.target.checked })} />{label}</label>;
  const people = reference.users.map(user => ({ ...user, employee_name: user.employee_name || user.employee_code || "Unnamed user" }));
  const branchNames = new Map(reference.branches.map(branch => [branch.id, branch.name]));
  const departmentNames = new Map(reference.departments.map(department => [department.id, department.name]));
  return <>
    <Field label="Task type"><select className="task-field" value={edit.taskType ?? "delegation"} onChange={event => {
      if (event.target.value === "delegation" || event.target.value === "checklist") onChange({ ...edit, taskType: event.target.value });
    }}><option value="delegation">Task</option><option value="checklist">Checklist</option></select></Field>
    <fieldset className="grid gap-1 rounded-xl border border-task-border p-3"><legend className="px-1 font-semibold">Completion requirements</legend>
      {toggle("Upload required", "requiresUpload")}
      {toggle("Completion remark required", "requiresRemark")}
      {toggle("Form required", "requiresForm")}
      <ReferenceSelect label="Linked form" value={edit.formTemplateId ?? ""} options={reference.forms.map(form => ({ id: form.id, label: form.name + " (v" + form.version + ")" }))} onChange={formTemplateId => onChange({ ...edit, formTemplateId })} />
      {toggle("Verification required", "verificationRequired")}
      <ReferenceSelect label="Verifier" value={edit.verifierId ?? ""} options={people.map(user => ({ id: user.id, label: user.employee_name }))} onChange={verifierId => onChange({ ...edit, verifierId })} />
      {toggle("Buddy assignment allowed", "buddyAssignmentAllowed")}
    </fieldset>
    <fieldset className="grid min-w-0 gap-3 rounded-xl border border-task-border p-3"><legend className="px-1 font-semibold">Assignment</legend>
      <AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label="Assignees" multiple people={people} selectedIds={edit.doerIds ?? []} disabledIds={edit.watcherIds ?? []} onChange={doerIds => onChange({ ...edit, doerIds })} />
      <AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label="In Loop" multiple people={people} selectedIds={edit.watcherIds ?? []} disabledIds={edit.doerIds ?? []} onChange={watcherIds => onChange({ ...edit, watcherIds })} />
      {(["doerIds", "watcherIds"] as const).flatMap(key => (edit[key] ?? []).filter(id => !people.some(person => person.id === id)).map(id =>
        <div className="flex flex-wrap items-center gap-2" key={key + id}><span>Current {key === "doerIds" ? "assignee" : "In Loop user"} (unavailable)</span><Button type="button" variant="secondary" onClick={() => onChange({ ...edit, [key]: (edit[key] ?? []).filter(value => value !== id) })}>Remove</Button></div>))}
    </fieldset>
    <fieldset className="grid gap-3 rounded-xl border border-task-border p-3"><legend className="px-1 font-semibold">Task details</legend>
      <ReferenceSelect label="Branch" value={edit.branchId ?? ""} options={reference.branches.map(branch => ({ id: branch.id, label: branch.name }))} onChange={branchId => onChange({ ...edit, branchId, departmentId: "" })} />
      <ReferenceSelect label="Department" value={edit.departmentId ?? ""} options={reference.departments.filter(department => !department.branch_id || department.branch_id === edit.branchId).map(department => ({ id: department.id, label: department.name }))} onChange={departmentId => onChange({ ...edit, departmentId })} />
      <ReferenceSelect label="Category" value={edit.categoryId ?? ""} options={reference.categories.map(category => ({ id: category.id, label: category.label }))} onChange={categoryId => onChange({ ...edit, categoryId })} />
      <Field label="Task group"><input className="task-field" maxLength={300} value={edit.coreTaskLabel ?? ""} onChange={event => onChange({ ...edit, coreTaskLabel: event.target.value })} /></Field>
    </fieldset>
    <fieldset className="grid min-w-0 gap-3 rounded-xl border border-task-border p-3"><legend className="px-1 font-semibold">Checklist items</legend>
      {(edit.checklist ?? []).map((item, index) => <div className="grid min-w-0 gap-2 border-b border-task-border pb-3" key={item.id ?? index}>
        <Field label={"Checklist item " + (index + 1)}><input required maxLength={500} className="task-field" value={item.itemText} onChange={event => onChange({ ...edit, checklist: (edit.checklist ?? []).map((entry, i) => i === index ? { ...entry, itemText: event.target.value } : entry) })} /></Field>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={item.required} onChange={event => onChange({ ...edit, checklist: (edit.checklist ?? []).map((entry, i) => i === index ? { ...entry, required: event.target.checked } : entry) })} />Required item</label>
        {item.completed ? <p className="text-sm text-task-text-muted">Completed progress is retained.</p> : null}
        <Button type="button" variant="secondary" onClick={() => onChange({ ...edit, checklist: (edit.checklist ?? []).filter((_, i) => i !== index) })}>{"Remove checklist item " + (index + 1)}</Button>
      </div>)}
      <Button type="button" variant="secondary" disabled={(edit.checklist?.length ?? 0) >= 100} onClick={() => onChange({ ...edit, checklist: [...(edit.checklist ?? []), { itemText: "", required: true }] })}>Add checklist item</Button>
      <p className="text-sm text-task-text-muted">Removed items are archived. Changing task type keeps existing items and completion history.</p>
    </fieldset>
  </>;
}
