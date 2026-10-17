import { useEffect, useState } from "react";
import { isFormFieldActive, simulateFmsDefinition, type FormAnswer, type FormFieldDefinition, type FormTemplateDefinition, type FmsFlowDefinition, type FmsStageDefinition } from "@jewelos/core";
import { loadFmsSimulationForms } from "@jewelos/data/fms/formAuthoring";
import { Button, Field, Modal, Notice } from "@/components/ui";
import type { FmsData } from "./api";

function SampleAnswer({ field, value, onChange, data }: { field: FormFieldDefinition; value: FormAnswer | undefined; onChange: (answer: FormAnswer) => void; data: FmsData }) {
  const options = field.type === "user_dropdown" ? data.users.map(user => ({ value: user.id, label: user.employee_name }))
    : field.type === "branch_dropdown" ? data.branches.map(branch => ({ value: branch.id, label: branch.name }))
    : field.type === "department_dropdown" ? data.departments.map(department => ({ value: department.id, label: department.name }))
    : field.options ?? [];
  if (field.type === "file") return <Notice>{field.label}: simulation does not upload files. A required file pauses this sample route.</Notice>;
  if (field.type === "checkbox" && !options.length) return <Field label={field.label}><input type="checkbox" className="size-4 accent-gold" checked={value === true} onChange={event => onChange(event.target.checked)} /></Field>;
  if (field.type === "multiselect" || field.type === "checkbox" && options.length) return <Field label={field.label}><select className="field" multiple value={Array.isArray(value) ? [...value] : []} onChange={event => onChange(Array.from(event.target.selectedOptions, option => option.value))}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>;
  const text = typeof value === "string" || typeof value === "number" ? value : "";
  if (options.length || ["select", "radio", "user_dropdown", "branch_dropdown", "department_dropdown"].includes(field.type)) return <Field label={field.label}><select className="field" value={text} onChange={event => onChange(event.target.value)}><option value="">Choose answer</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>;
  if (field.type === "textarea") return <Field label={field.label}><textarea className="field" value={text} onChange={event => onChange(event.target.value)} /></Field>;
  const numeric = ["number", "currency", "rating"].includes(field.type);
  const type = numeric ? "number" : field.type === "datetime" ? "datetime-local" : ["date", "email"].includes(field.type) ? field.type : "text";
  return <Field label={field.label}><input className="field" type={type} value={text} onChange={event => onChange(numeric && event.target.value !== "" ? event.target.valueAsNumber : event.target.value)} /></Field>;
}

export function FmsSimulation({ definition, data, onClose }: { definition: FmsFlowDefinition; data: FmsData; onClose: () => void }) {
  const [answers, setAnswers] = useState<Record<string, Record<string, FormAnswer>>>({});
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [handoffs, setHandoffs] = useState<Record<string, string>>({});
  const [starter, setStarter] = useState("");
  const [forms, setForms] = useState<Readonly<Record<string, FormTemplateDefinition>> | null>(null);
  const [loadError, setLoadError] = useState("");
  const [simulationError, setSimulationError] = useState("");
  useEffect(() => {
    let active = true;
    setForms(null); setLoadError("");
    void loadFmsSimulationForms(definition).then(value => { if (active) setForms(value); }).catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : "Could not load linked Forms."); });
    return () => { active = false; };
  }, [definition]);
  const fieldsFor = (stage: FmsStageDefinition) => {
    const form = stage.formTemplateId ? forms?.[stage.formTemplateId] : undefined;
    return form?.fields.filter(field => field.type !== "section_header" && field.type !== "divider" && isFormFieldActive(form, field, answers[stage.key] ?? {})) ?? [];
  };
  const [result, setResult] = useState<ReturnType<typeof simulateFmsDefinition> | null>(null);
  const names = new Map(data.users.map(user => [user.id, user.employee_name]));
  const display = new Map(definition.stages.map(stage => [stage.key, stage.sla.taskDisplay]));
  const setAnswer = (stageKey: string, field: string, value: FormAnswer) => setAnswers(current => ({ ...current, [stageKey]: { ...current[stageKey], [field]: value } }));
  const runSimulation = () => {
    setSimulationError("");
    try {
      setResult(simulateFmsDefinition(definition, {
        forms: forms ?? {}, starterId: starter,
        answers: Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, [value]])),
        outcomes: Object.fromEntries(Object.entries(outcomes).map(([key, value]) => [key, [value]])),
        handoffs: Object.fromEntries(Object.entries(handoffs).filter(([, value]) => !!value).map(([key, value]) => [key, [value]])),
      }));
    }
    catch (error: unknown) { setResult(null); setSimulationError(error instanceof Error ? error.message : "Could not simulate this workflow."); }
  };
  return <Modal title="Simulate workflow" onClose={onClose} wide>
    <div className="space-y-4"><Notice>Use sample answers to inspect a route. This preview creates no submissions, assignments or notifications. Employee permissions and availability are checked again by the server.</Notice>
      <Field label="Sample workflow starter"><select className="field" value={starter} onChange={event => setStarter(event.target.value)}><option value="">Choose employee</option>{data.users.map(user => <option key={user.id} value={user.id}>{user.employee_name}</option>)}</select></Field>
      {definition.stages.map(stage => <details className="rounded-xl border border-gold/20 p-3" key={stage.key}><summary className="cursor-pointer font-semibold text-champagne">{stage.name}</summary><div className="mt-3 space-y-3">
        {fieldsFor(stage).map(field => <SampleAnswer key={field.key} field={field} value={answers[stage.key]?.[field.key]} data={data} onChange={value => setAnswer(stage.key, field.key, value)} />)}
        {stage.sla.decisionOptions?.length ? <Field label="Sample decision"><select className="field" value={outcomes[stage.key] ?? ""} onChange={event => setOutcomes(current => ({...current,[stage.key]:event.target.value}))}><option value="">Choose outcome</option>{stage.sla.decisionOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></Field> : null}
        {stage.sla.assignment?.allowHandoff && stage.sla.assignment.mode !== "fixed_employee" ? <Field label="Sample manual handoff"><select className="field" value={handoffs[stage.key] ?? ""} onChange={event => setHandoffs(current => ({...current,[stage.key]:event.target.value}))}><option value="">Use configured source</option>{data.users.map(user => <option key={user.id} value={user.id}>{user.employee_name}</option>)}</select></Field> : null}
      </div></details>)}
      <Notice>{loadError || (forms ? "Linked Forms loaded." : "Loading linked Forms...")}</Notice>
      {simulationError ? <Notice tone="danger">{simulationError}</Notice> : null}
      <Button disabled={!forms || !!loadError} onClick={runSimulation}>Run simulation</Button>
      {result ? <section aria-label="Simulation trace" className="space-y-3"><h3 className="font-semibold text-gold">Route and assignment trace</h3>{result.limitReached ? <Notice>Preview stopped at its event limit. A human loop can continue in the real workflow until an exit is chosen.</Notice> : null}<ol className="space-y-2">{result.events.map((event,index)=><li className="rounded-xl border border-gold/15 p-3 text-sm" key={index}><b>{event.stageName} · visit {event.visit}</b><p>{event.status} · {event.selectedUserIds.map(id => names.get(id) ?? "Historical employee").join(", ") || "No employee selected"}</p><p>{event.formTemplateId ? `Form: ${data.forms.find(form => form.id === event.formTemplateId)?.name ?? "Linked Form"}` : "No linked Form"}</p><p>{display.get(event.stageKey)?.instructions}</p><p>{display.get(event.stageKey)?.expectedResult}</p><p className="text-xs text-soft-grey">{event.assignmentMethod.replaceAll("_"," ")}{event.outcome ? ` · ${event.outcome}` : ""} {event.note}</p></li>)}</ol></section> : null}
    </div>
  </Modal>;
}
