import { Plus, Trash2 } from "lucide-react";
import {
  FORM_USER_FILTER_ATTRIBUTES, FORM_USER_FILTER_LABELS, FORM_USER_FILTER_OPERATOR_LABELS, FORM_USER_FILTER_ROLES, formUserFilterOperators, formUserFilterProblem, formUserMatchesFilter,
  type FormUserFilter, type FormUserFilterAttribute, type FormUserFilterOperator, type FormUserFilterRule,
} from "@jewelos/core";
import { Button } from "@/components/ui";
import type { DynamicOptions } from "./FormRenderer";

const ROLE_LABELS: Record<(typeof FORM_USER_FILTER_ROLES)[number], string> = { super_admin: "Super Admin", admin: "Admin", manager: "Manager", hr: "HR", crm: "CRM", staff: "Staff" };
const MULTI: ReadonlySet<FormUserFilterOperator> = new Set(["in", "not_in"]);
const NO_VALUE: ReadonlySet<FormUserFilterOperator> = new Set(["is_empty", "is_not_empty"]);

function choicesFor(attribute: FormUserFilterAttribute, options: DynamicOptions): Array<{ id: string; label: string }> {
  switch (attribute) {
    // One choice per department name: every store has its own Sales, CRM, ... and a rule
    // matches the name in all of them (migration 0403).
    case "department": {
      const byName = new Map<string, { id: string; label: string }>();
      for (const { id, label } of options.departments) { const key = label.trim().toLowerCase(); if (!byName.has(key)) byName.set(key, { id, label: label.trim() }); }
      return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label));
    }
    case "designation": return options.designations ?? [];
    case "store": return options.branches.map(({ id, label }) => ({ id, label }));
    case "franchise": return options.franchises ?? [];
    case "role": return FORM_USER_FILTER_ROLES.map((role) => ({ id: role, label: ROLE_LABELS[role] }));
    case "name": return [];
  }
}

/**
 * "Who can be chosen" on a Users question (migration 0391): rules on department, designation,
 * store, franchise, role or name, matched all or any. The form lists only matching people and
 * the server refuses anyone else on submit.
 */
export function UserFilterEditor({ value, options, onChange }: { value: FormUserFilter | undefined; options: DynamicOptions; onChange: (next: FormUserFilter | undefined) => void }) {
  const filter: FormUserFilter = value ?? { match: "all", rules: [] };
  const set = (rules: readonly FormUserFilterRule[], match = filter.match) => onChange(rules.length ? { match, rules } : undefined);
  const update = (index: number, patch: Partial<FormUserFilterRule>) => set(filter.rules.map((rule, at) => at === index ? { ...rule, ...patch } : rule));
  const problem = formUserFilterProblem(value);
  const departmentNames = new Map(options.departments.map((item) => [item.id, item.label]));
  const matching = value ? options.users.filter((person) => formUserMatchesFilter(value, person, departmentNames)).length : options.users.length;
  // A saved department id stands for its name, so tick the one choice listed for that name.
  const chosen = (rule: FormUserFilterRule, id: string) => rule.attribute !== "department" ? rule.values.includes(id)
    : rule.values.some((value) => (departmentNames.get(value) ?? value).trim().toLowerCase() === (departmentNames.get(id) ?? id).trim().toLowerCase());

  return <details className="rounded-lg border border-gold/15 bg-obsidian/30 p-3 sm:col-span-2" open={!!value}>
    <summary className="cursor-pointer text-sm font-semibold text-champagne">Who can be chosen{value ? ` (${filter.rules.length} rule${filter.rules.length === 1 ? "" : "s"})` : ": everyone"}</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-soft-grey">Only active employees the person filling the form can see are ever listed. Rules narrow that list, for example Department is equal to Sales.</p>
      {filter.rules.length > 1 ? <label className="block text-sm text-champagne">People must match
        <select aria-label="People must match" className="field mt-1" onChange={(event) => set(filter.rules, event.target.value === "any" ? "any" : "all")} value={filter.match}>
          <option value="all">All rules (AND)</option><option value="any">Any rule (OR)</option>
        </select></label> : null}
      {filter.rules.map((rule, index) => {
        const choices = choicesFor(rule.attribute, options);
        return <fieldset className="grid gap-2 rounded-lg border border-task-border p-2 sm:grid-cols-[1fr_1fr_2fr_auto]" key={index}>
          <legend className="sr-only">Rule {index + 1}</legend>
          <select aria-label={`Rule ${index + 1} field`} className="field" onChange={(event) => {
            const attribute = event.target.value as FormUserFilterAttribute;
            update(index, { attribute, operator: formUserFilterOperators(attribute)[0]!, values: [] });
          }} value={rule.attribute}>{FORM_USER_FILTER_ATTRIBUTES.map((attribute) => <option key={attribute} value={attribute}>{FORM_USER_FILTER_LABELS[attribute]}</option>)}</select>
          <select aria-label={`Rule ${index + 1} condition`} className="field" onChange={(event) => {
            const operator = event.target.value as FormUserFilterOperator;
            update(index, { operator, values: NO_VALUE.has(operator) ? [] : MULTI.has(operator) ? rule.values : rule.values.slice(0, 1) });
          }} value={rule.operator}>{formUserFilterOperators(rule.attribute).map((operator) => <option key={operator} value={operator}>{FORM_USER_FILTER_OPERATOR_LABELS[operator]}</option>)}</select>
          {NO_VALUE.has(rule.operator) ? <span className="self-center text-xs text-soft-grey">No value needed</span>
            : rule.attribute === "name" ? <input aria-label={`Rule ${index + 1} value`} className="field" maxLength={100} onChange={(event) => update(index, { values: event.target.value ? [event.target.value] : [] })} placeholder="Part of a name" value={rule.values[0] ?? ""} />
            : MULTI.has(rule.operator) ? <div aria-label={`Rule ${index + 1} values`} className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-task-border p-2" role="group">
              {choices.length ? choices.map((choice) => <label className="flex items-center gap-2 text-sm text-champagne" key={choice.id}><input checked={chosen(rule, choice.id)} onChange={(event) => update(index, { values: event.target.checked ? [...rule.values, choice.id] : rule.values.filter((item) => !chosen({ ...rule, values: [item] }, choice.id)) })} type="checkbox" />{choice.label}</label>) : <p className="text-xs text-soft-grey">Nothing to choose from.</p>}
            </div>
            : <select aria-label={`Rule ${index + 1} value`} className="field" onChange={(event) => update(index, { values: event.target.value ? [event.target.value] : [] })} value={rule.attribute === "department" ? choices.find((choice) => chosen(rule, choice.id))?.id ?? "" : rule.values[0] ?? ""}>
              <option value="">Choose</option>{choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
            </select>}
          <Button aria-label={`Remove rule ${index + 1}`} className="px-2" onClick={() => set(filter.rules.filter((_, at) => at !== index))} type="button" variant="ghost"><Trash2 className="size-4" /></Button>
        </fieldset>;
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => set([...filter.rules, { attribute: "department", operator: "equals", values: [] }])} type="button" variant="secondary"><Plus className="size-4" />Add rule</Button>
        {value ? <span className="text-xs text-soft-grey">{matching} of {options.users.length} people you can see match.</span> : null}
      </div>
      {problem ? <p className="text-xs text-danger" role="alert">{problem}</p> : null}
    </div>
  </details>;
}
