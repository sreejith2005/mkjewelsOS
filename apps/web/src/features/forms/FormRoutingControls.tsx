import { FORM_CONTINUE_TARGET, FORM_QUESTION_TARGET_PREFIX, FORM_STAGE_END_TARGET, FORM_SUBMIT_TARGET, type FormBranch, type FormFieldDefinition, type FormSectionDefinition } from "@jewelos/core";
import { Button, Field } from "@/components/ui";
import type { MasterOption } from "@/features/dropdowns/api";
import type { DynamicOptions } from "./FormRenderer";
import { FormRuleTreeEditor } from "./FormRuleTreeEditor";

export function FormDestinationSelect({ value, onChange, fields, sections, source, sectionKey, label = "Destination" }: {
  value: string; onChange: (value: string) => void; fields: readonly FormFieldDefinition[]; sections: readonly FormSectionDefinition[];
  source?: FormFieldDefinition; sectionKey?: string; label?: string;
}) {
  const sourceSection = sections.findIndex(s => s.key === (source?.sectionKey ?? sectionKey ?? sections[0]?.key));
  return <Field label={label}><select className="field" value={value} onChange={event => onChange(event.target.value)}>
    <option value={FORM_CONTINUE_TARGET}>Continue to next applicable question or section</option>
    {sections.map((section, index) => <optgroup key={section.key} label={section.title}>
      {index > sourceSection ? <option value={section.key}>Go to / Skip to {section.title}</option> : null}
      {index >= sourceSection ? fields.filter(f => (f.sectionKey ?? sections[0]?.key) === section.key && f.type !== "section_header" && f.type !== "divider" && (index > sourceSection || !!source && f.sortOrder > source.sortOrder)).map(f => <option key={f.key} value={FORM_QUESTION_TARGET_PREFIX + f.key}>Go to question: {f.label || f.key}</option>) : null}
    </optgroup>)}
    <option value={FORM_SUBMIT_TARGET}>Submit form</option>
    <option value={FORM_STAGE_END_TARGET}>End current form stage</option>
  </select></Field>;
}

export function FormSectionConditions({ section, fields, sections, dynamicOptions, masterOptions, onChange }: {
  section: FormSectionDefinition; fields: readonly FormFieldDefinition[]; sections: readonly FormSectionDefinition[]; dynamicOptions: DynamicOptions; masterOptions: MasterOption[];
  onChange: (patch: Partial<FormSectionDefinition>) => void;
}) {
  const index = sections.findIndex(s => s.key === section.key);
  const sources = fields.filter(f => sections.findIndex(s => s.key === (f.sectionKey ?? sections[0]?.key)) < index && f.type !== "section_header" && f.type !== "divider");
  return <details className="min-w-0 rounded-lg border border-gold/15 p-3 sm:col-span-3"><summary className="cursor-pointer text-sm font-semibold text-champagne">Section Visibility</summary>
    <div className="mt-3 space-y-3"><Field label="When should this section appear?"><select className="field" value={section.visibility ?? "always"} onChange={event => onChange({ visibility: event.target.value as NonNullable<FormSectionDefinition["visibility"]>, ...(event.target.value === "always" || event.target.value === "routed" ? { rule: undefined } : {}) })}>
      <option value="always">Always</option><option value="when">Only when conditions match</option><option value="unless">Hide when conditions match</option><option value="routed">Only when reached through routing</option>
    </select></Field>{section.visibility === "when" || section.visibility === "unless" ? <FormRuleTreeEditor rule={section.rule} sources={sources} dynamicOptions={dynamicOptions} masterOptions={masterOptions} onChange={rule => onChange({ rule })} /> : null}</div>
  </details>;
}

export function FormAdvancedRoutes({ field, fields, sections, dynamicOptions, masterOptions, onChange }: {
  field: FormFieldDefinition; fields: readonly FormFieldDefinition[]; sections: readonly FormSectionDefinition[]; dynamicOptions: DynamicOptions; masterOptions: MasterOption[];
  onChange: (branches: readonly FormBranch[] | undefined) => void;
}) {
  const routes = field.branches ?? [];
  const write = (next: readonly FormBranch[]) => onChange(next.length ? next : undefined);
  const patch = (index: number, next: Partial<FormBranch>) => write(routes.map((r, i) => i === index ? { ...r, ...next } : r));
  const move = (index: number, delta: number) => { const next = [...routes]; const to = index + delta; if (to < 0 || to >= next.length || next[index]?.operator === "default" || next[to]?.operator === "default") return; [next[index], next[to]] = [next[to]!, next[index]!]; write(next); };
  const sources = fields.filter(f => f.sortOrder <= field.sortOrder && f.type !== "section_header" && f.type !== "divider");
  const add = () => write([...routes.filter(r => r.operator !== "default"), { name: "", operator: "not_empty", rule: { kind: "predicate", fieldKey: field.key, operator: "not_empty" }, targetSectionKey: FORM_CONTINUE_TARGET }, ...routes.filter(r => r.operator === "default")]);
  return <section className="min-w-0 space-y-3 rounded-lg border border-gold/20 p-3">
    <h4 className="font-semibold text-champagne">Ordered IF routes</h4><p className="text-xs text-soft-grey">First matching rule wins. A matching route takes priority over After this section. Continue asks the next applicable question.</p>
    {routes.map((route, index) => <details className="min-w-0 rounded-lg border border-gold/15 p-3" key={index} open>
      <summary className="cursor-pointer text-sm font-medium text-champagne">{route.operator === "default" ? "OTHERWISE" : `IF ${index + 1}`} {route.name}</summary>
      <div className="mt-3 space-y-3"><Field label="Rule name"><input className="field" value={route.name ?? ""} maxLength={150} onChange={event => patch(index, { name: event.target.value })} /></Field>
        {route.operator !== "default" ? <FormRuleTreeEditor rule={route.rule ?? { kind: "predicate", fieldKey: field.key, operator: route.operator, ...(route.value !== undefined ? { value: route.value } : {}) }} sources={sources} dynamicOptions={dynamicOptions} masterOptions={masterOptions} onChange={rule => patch(index, { rule: rule ?? { kind: "all", rules: [] } })} /> : null}
        <FormDestinationSelect value={route.targetSectionKey} onChange={targetSectionKey => patch(index, { targetSectionKey })} fields={fields} sections={sections} source={field} label="THEN GO TO" />
        <div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" disabled={index === 0 || route.operator === "default"} onClick={() => move(index, -1)}>Move rule up</Button><Button type="button" variant="ghost" disabled={index === routes.length - 1 || route.operator === "default" || routes[index + 1]?.operator === "default"} onClick={() => move(index, 1)}>Move rule down</Button><Button type="button" variant="secondary" disabled={route.operator === "default"} onClick={() => write([...routes.slice(0, index + 1), { ...route, name: `${route.name || "Rule"} copy` }, ...routes.slice(index + 1)])}>Duplicate rule</Button><Button type="button" variant="danger" onClick={() => write(routes.filter((_, i) => i !== index))}>Delete rule</Button></div>
      </div>
    </details>)}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={add}>Add IF / ELSE IF</Button>{!routes.some(r => r.operator === "default") ? <Button type="button" variant="secondary" onClick={() => write([...routes, { operator: "default", targetSectionKey: FORM_CONTINUE_TARGET }])}>Set OTHERWISE</Button> : null}</div>
  </section>;
}
