import { eligibleRecordNameFields, fmsStageFormFields, type FmsStageDefinition, type FmsFormFieldRef, type FmsTaskDisplay } from "@jewelos/core";
import { Field } from "@/components/ui";
export function FmsTaskNaming({ stage, stages, fields, onChange }: { stage: FmsStageDefinition; stages: readonly FmsStageDefinition[]; fields: Readonly<Record<string, readonly FmsFormFieldRef[]>>; onChange: (stage: FmsStageDefinition) => void }) {
 const initial = stages[0]?.key === stage.key; const naming = stage.sla.taskDisplay?.recordNaming;
 const options = (initial ? [stage] : stages).flatMap(source => source.formTemplateId ? eligibleRecordNameFields(fmsStageFormFields(source, fields)).map(field => ({ key: `${source.key}:${field.key}`, label: initial ? field.label : `${source.name} · ${field.label}`, source: { sourceStageKey: source.key, formTemplateId: source.formTemplateId!, fieldKey: field.key } })) : []);
 const value = naming?.mode === "field" && naming.source ? `${naming.source.sourceStageKey}:${naming.source.fieldKey}` : naming?.mode ?? (initial ? "automatic" : "");
 return <section className="space-y-2 rounded-xl border border-gold/15 p-3">
  <h4 className="text-sm font-semibold text-champagne">Task Naming</h4>
  <p className="text-xs text-soft-grey">Which form answer should be used to identify this work? {initial ? "The name follows the record through every stage." : "Leave the original name unless this stage needs a different identifier."}</p>
  <Field label="Task name from"><select className="field" value={value} onChange={event => {
   const selected = event.target.value; const source = options.find(option => option.key === selected)?.source;
   const recordNaming: FmsTaskDisplay["recordNaming"] = source ? { mode: "field", source } : selected === "automatic" || selected === "form_default" ? { mode: selected } : undefined;
   onChange({ ...stage, sla: { ...stage.sla, taskDisplay: { ...stage.sla.taskDisplay, fields: stage.sla.taskDisplay?.fields ?? [], recordNaming } } });
  }}>{!initial ? <option value="">Use the original workflow record name</option> : null}<option value="automatic">{initial ? "Automatic" : "Automatic from the initial form"}</option><option value="form_default">Use the form's selected record-name question</option>{options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></Field>
 </section>;
}
