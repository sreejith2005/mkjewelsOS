import { useState } from "react";
import { KIARA_VISIBILITIES, type KiaraDepartmentOption, type KiaraVisibility } from "@jewelos/data/assistant/knowledge";
import { VISIBILITY_HELP, VISIBILITY_LABELS } from "./labels";

/**
 * Department tags as names: choosing "Sales" covers Sales in every branch,
 * including branches added later. The database checks every name.
 */
export function DepartmentPicker({ departments, disabled, label = "Departments", onChange, value }: {
  departments: readonly KiaraDepartmentOption[];
  disabled?: boolean | undefined;
  label?: string | undefined;
  onChange: (next: string[]) => void;
  value: readonly string[];
}) {
  const [filter, setFilter] = useState("");
  const chosen = new Set(value.map((name) => name.toLowerCase()));
  // Tags that no longer name a department stay visible so they can be removed.
  const unknown = value.filter((name) => !departments.some((option) => option.name.toLowerCase() === name.toLowerCase()));
  const shown = departments.filter((option) => !filter.trim() || option.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (name: string) => onChange(chosen.has(name.toLowerCase())
    ? value.filter((entry) => entry.toLowerCase() !== name.toLowerCase())
    : [...value, name]);

  return <fieldset className="min-w-0" disabled={disabled}>
    <legend className="text-xs font-semibold text-task-text-muted">{label}{value.length ? ` (${value.length})` : ""}</legend>
    {departments.length > 8 ? <input aria-label="Find a department" className="task-field mt-1 w-full" onChange={(event) => setFilter(event.target.value)} placeholder="Find a department" value={filter} /> : null}
    <div className="mt-1 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-task-border p-2">
      {departments.length === 0 ? <span className="text-xs text-task-text-muted">No departments are set up yet.</span> : null}
      {shown.map((option) => {
        const on = chosen.has(option.name.toLowerCase());
        return <label className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm ${on ? "border-task-accent bg-task-accent-soft text-task-text" : "border-task-border text-task-text hover:bg-task-muted"}`} key={option.key}>
          <input checked={on} className="size-3.5" onChange={() => toggle(option.name)} type="checkbox" />
          {option.name}
          {option.branches > 1 ? <span className="text-xs text-task-text-muted">· {option.branches} branches</span> : null}
        </label>;
      })}
      {unknown.map((name) => <label className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-danger/40 px-3 text-sm text-danger" key={`unknown-${name}`} title="No department has this name any more">
        <input checked className="size-3.5" onChange={() => toggle(name)} type="checkbox" />{name} (not found)
      </label>)}
    </div>
  </fieldset>;
}

export function VisibilitySelect({ id, onChange, value }: { id: string; onChange: (next: KiaraVisibility) => void; value: KiaraVisibility }) {
  return <label className="block" htmlFor={id}>
    <span className="text-xs font-semibold text-task-text-muted">Who can get answers from it</span>
    <select className="task-field mt-1 w-full sm:w-72" id={id} onChange={(event) => onChange(event.target.value as KiaraVisibility)} value={value}>
      {KIARA_VISIBILITIES.map((visibility) => <option key={visibility} value={visibility}>{VISIBILITY_LABELS[visibility]}</option>)}
    </select>
    <span className="mt-1 block text-xs text-task-text-muted">{VISIBILITY_HELP[value]}</span>
  </label>;
}

/** The visibility and department fields together, with the "needs a department" rule. */
export function AccessFields({ departments, idPrefix, onChange, value }: {
  departments: readonly KiaraDepartmentOption[];
  idPrefix: string;
  onChange: (next: Readonly<{ visibility: KiaraVisibility; departmentTags: string[] }>) => void;
  value: Readonly<{ visibility: KiaraVisibility; departmentTags: readonly string[] }>;
}) {
  return <div className="grid gap-3 sm:grid-cols-[18rem_1fr]">
    <VisibilitySelect id={`${idPrefix}-visibility`} onChange={(visibility) => onChange({ visibility, departmentTags: [...value.departmentTags] })} value={value.visibility} />
    <div>
      <DepartmentPicker departments={departments} onChange={(departmentTags) => onChange({ visibility: value.visibility, departmentTags })} value={value.departmentTags} />
      {value.visibility === "departments" && value.departmentTags.length === 0 ? <p className="mt-1 text-xs font-semibold text-danger">Choose at least one department.</p> : null}
    </div>
  </div>;
}

/** The client-side form check matching the database rule. */
export function accessProblem(value: Readonly<{ visibility: KiaraVisibility; departmentTags: readonly string[] }>): string | null {
  return value.visibility === "departments" && value.departmentTags.length === 0 ? "Choose at least one department for a department-only document." : null;
}
