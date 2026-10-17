import { useEffect, useState } from "react";
import { isFormFieldActive, simulateFmsDefinition, type FormTemplateDefinition, type FmsFlowDefinition, type FmsStageDefinition } from "@jewelos/core";
import { loadFmsSimulationForms } from "@jewelos/data/fms/formAuthoring";
import type { FmsData } from "@jewelos/data/fms/api";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { OptionPicker } from "@/ui/OptionPicker";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

export function FmsSimulation({ definition, data, onClose }: { definition: FmsFlowDefinition; data: FmsData; onClose: () => void }) {
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({});
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
  const people = data.users.map(user=>({value:user.id,label:user.employee_name}));
  const setAnswer = (key:string,field:string,value:string)=>setAnswers(current=>({...current,[key]:{...current[key],[field]:value}}));
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
  return <Sheet visible title="Simulate workflow" onClose={onClose} tall>
    <Text tone="muted">Sample answers only. This creates no work or notifications. The server revalidates forms, permissions and employee availability when real work is submitted.</Text>
    <OptionPicker label="Sample workflow starter" options={people} selected={[starter]} onChange={values=>setStarter(values[0]??"")} />
    {definition.stages.map(stage=><Card key={stage.key}><Text weight="semibold">{stage.name}</Text>
      {fieldsFor(stage).map(field=>field.type==="user_dropdown" ? <OptionPicker key={field.key} label={field.label} options={people} selected={[answers[stage.key]?.[field.key]??""]} onChange={values=>setAnswer(stage.key,field.key,values[0]??"")} /> : field.options?.length ? <OptionPicker key={field.key} label={field.label} options={field.options.map(option=>({value:option.value,label:option.label}))} selected={[answers[stage.key]?.[field.key]??""]} onChange={values=>setAnswer(stage.key,field.key,values[0]??"")} /> : <TextField key={field.key} label={field.label} value={answers[stage.key]?.[field.key]??""} onChangeText={value=>setAnswer(stage.key,field.key,value)} />)}
      {stage.sla.decisionOptions?.length ? <OptionPicker label="Sample decision" options={stage.sla.decisionOptions.map(option=>({value:option.key,label:option.label}))} selected={[outcomes[stage.key]??""]} onChange={values=>setOutcomes(current=>({...current,[stage.key]:values[0]??""}))} />:null}
      {stage.sla.assignment?.allowHandoff && stage.sla.assignment.mode!=="fixed_employee" ? <OptionPicker label="Sample manual handoff" options={[{value:"",label:"Use configured source"},...people]} selected={[handoffs[stage.key]??""]} onChange={values=>setHandoffs(current=>({...current,[stage.key]:values[0]??""}))} />:null}
    </Card>)}
    <Text tone="muted">{loadError || (forms ? "Linked Forms loaded." : "Loading linked Forms...")}</Text>
    {simulationError ? <Text>{simulationError}</Text> : null}
    <Button disabled={!forms || !!loadError} label="Run simulation" onPress={runSimulation} />
    {result?.limitReached?<Text tone="muted">Preview stopped at its event limit. Choose an exit to finish a repeating route.</Text>:null}
    {result?.events.map((event,index)=><Card key={index}><Text weight="semibold">{`${event.stageName} · visit ${event.visit}`}</Text><Text>{`${event.status} · ${event.selectedUserIds.map(id=>people.find(person=>person.value===id)?.label??"Historical employee").join(", ")||"No employee selected"}`}</Text><Text tone="muted">{`${event.assignmentMethod.replaceAll("_"," ")} ${event.note}`}</Text></Card>)}
  </Sheet>;
}
