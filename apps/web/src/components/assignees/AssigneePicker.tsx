import { useMemo, useState } from "react";
import { Search } from "lucide-react";

export type AssigneePerson = Readonly<{ branch_id: string | null; department_id: string | null; employee_code: string | null; employee_name: string | null; id: string; user_role: string | null }>;
export type AssigneePickerProps = Readonly<{ branchNames: ReadonlyMap<string, string>; departmentNames: ReadonlyMap<string, string>; disabledIds?: readonly string[]; label: string; multiple: boolean; onChange: (ids: string[]) => void; people: readonly AssigneePerson[]; selectedIds: readonly string[] }>;

function titleCase(value: string | null): string {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Role not assigned";
}

export function assigneeOrganizationLabel(person: AssigneePerson, branchNames: ReadonlyMap<string, string>, departmentNames: ReadonlyMap<string, string>): string {
  return [person.department_id ? departmentNames.get(person.department_id) : undefined, person.branch_id ? branchNames.get(person.branch_id) : undefined, titleCase(person.user_role)].filter((value): value is string => Boolean(value)).join(" · ");
}

export function assigneeSearchText(person: AssigneePerson, branchNames: ReadonlyMap<string, string>, departmentNames: ReadonlyMap<string, string>): string {
  return `${person.employee_name ?? ""} ${person.employee_code ?? ""} ${assigneeOrganizationLabel(person, branchNames, departmentNames)}`.toLocaleLowerCase();
}

export function AssigneePicker({ branchNames, departmentNames, disabledIds = [], label, multiple, onChange, people, selectedIds }: AssigneePickerProps) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const disabled = useMemo(() => new Set(disabledIds), [disabledIds]);
  const visiblePeople = useMemo(() => people.filter((person) => !query || assigneeSearchText(person, branchNames, departmentNames).includes(query)), [branchNames, departmentNames, people, query]);
  const choose = (personId: string, checked: boolean) => onChange(multiple ? (checked ? [...selectedIds, personId] : selectedIds.filter((id) => id !== personId)) : (checked ? [personId] : []));
  return <fieldset className="rounded-xl border border-task-border bg-task-muted p-3"><legend className="px-1 text-xs font-semibold text-task-text">{label}</legend><label className="relative mb-2 block"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-task-text-muted"/><input aria-label={`Search ${label.toLocaleLowerCase()}`} className="task-field pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search people" value={search}/></label><div className="flex max-h-52 flex-col gap-1 overflow-y-auto">{visiblePeople.map((person) => <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm text-task-text hover:bg-task-bg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-task-accent" key={person.id}><input aria-label={person.employee_name ?? "Unnamed user"} checked={selectedIds.includes(person.id)} className="size-4 accent-task-accent" disabled={disabled.has(person.id)} name={multiple ? undefined : label} onChange={(event) => choose(person.id, event.target.checked)} type={multiple ? "checkbox" : "radio"}/><span className="min-w-0 flex-1"><span className="block truncate">{person.employee_name || "Unnamed user"}</span><span className="block truncate text-xs text-task-text-muted">{assigneeOrganizationLabel(person, branchNames, departmentNames) || "Organization details unavailable"}</span></span></label>)}{visiblePeople.length === 0 ? <p className="px-2 py-3 text-sm text-task-text-muted">No matching people.</p> : null}</div></fieldset>;
}
