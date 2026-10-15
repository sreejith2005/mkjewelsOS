import { FMS_ASSIGNMENT_LABELS, FMS_ASSIGNMENT_MODES, fmsSourceQuestions, type FmsAssignmentConfig, type FmsStageDefinition } from "@jewelos/core";
import type { FmsData } from "@jewelos/data/fms/api";
import { Card } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { ToggleField } from "@/forms/ToggleField";

export function FmsAssignmentEditor({ stage, stages, data, onChange }: { stage: FmsStageDefinition; stages: readonly FmsStageDefinition[]; data: FmsData; onChange: (value: FmsStageDefinition) => void }) {
  const config = stage.sla.assignment ?? { mode: "manual_handoff", sources: [], allowHandoff: true };
  const update = (patch: Partial<FmsAssignmentConfig>) => onChange({ ...stage, sla: { ...stage.sla, assignment: { ...config, ...patch } } });
  const questions = fmsSourceQuestions(stages, data.formFields, stage.key);
  const received = fmsSourceQuestions(stages, data.formFields, stage.key, false);
  const people = data.users.filter(user => user.working_status === "active" && user.is_login_enabled).map(user => ({ value: user.id, label: user.employee_name }));
  const display = stage.sla.taskDisplay ?? { fields: [] };
  const updateDisplay = (patch: Partial<typeof display>) => onChange({ ...stage, sla: { ...stage.sla, taskDisplay: { ...display, ...patch } } });
  return <Card>
    <Text variant="subtitle" weight="semibold">Assignment strategy</Text>
    <OptionPicker label="How this step receives its employee" options={FMS_ASSIGNMENT_MODES.map(mode => ({ value: mode, label: FMS_ASSIGNMENT_LABELS[mode] }))} selected={[config.mode]} onChange={values => { const mode = FMS_ASSIGNMENT_MODES.find(mode => mode === values[0]); if (mode) update({ mode, allowHandoff: mode !== "fixed_employee" }); }} />
    {config.mode === "previous_form" ? <><OptionPicker multiple label="Source User questions" options={questions.map(item => ({value: item.key, label: item.label}))} selected={questions.filter(item => config.sources.some(source => source.sourceStageKey === item.source.sourceStageKey && source.fieldKey === item.source.fieldKey)).map(item => item.key)} onChange={values => update({ sources: questions.filter(item => values.includes(item.key)).map(item => item.source) })} /><Text tone="muted">Uses the nearest matching form visit on the route taken. A named default does not replace the answer.</Text></> : null}
    {config.mode === "fixed_employee" ? <><OptionPicker label="Locked employee" options={people} selected={[stage.assigneeRules.find(rule => rule.type === "specific_user")?.userProfileId ?? ""]} onChange={values => onChange({ ...stage, assigneeRules: values[0] ? [{ type: "specific_user", userProfileId: values[0] }] : [] })} /><Text tone="muted">This owner cannot be replaced by form answers or handoffs.</Text></> : <ToggleField label="Allow an eligible replacement at handoff" value={config.allowHandoff} onChange={value => update({ allowHandoff: value })} />}
    {config.mode === "hierarchy" ? <OptionPicker label="Hierarchy rule" options={[{value:"manager",label:"Branch manager"},{value:"department_head",label:"Department head"},...(stage.assigneeRules[0]?.type === "role" ? [{value:"role",label:`Existing role (${stage.assigneeRules[0].role})`}] : [])]} selected={[stage.assigneeRules[0]?.type ?? ""]} onChange={values => { const type=values[0]; if(type === "manager" || type === "department_head") onChange({ ...stage, assigneeRules: [{ type }] }); }} /> : null}
    <OptionPicker label="Explicit fallback" options={[{value:"",label:"No fallback"},{value:"specific_user",label:"Named employee"},{value:"reporter",label:"Workflow starter"},{value:"previous_step_doer",label:"Previous employee"}]} selected={[config.fallbackRule?.type ?? ""]} onChange={values => {const type=values[0];update({fallbackRule:type === "reporter" || type === "previous_step_doer" ? {type} : type === "specific_user" ? {type,userProfileId:""}:undefined});}} />
    {config.fallbackRule?.type === "specific_user" ? <OptionPicker label="Fallback employee" options={people} selected={[config.fallbackRule.userProfileId ?? ""]} onChange={values => update({ fallbackRule: {type:"specific_user",userProfileId:values[0] ?? ""} })} /> : null}
    <ToggleField label="Completion form required" disabled={!stage.formTemplateId} value={stage.sla.completionFormRequired === true} onChange={value=>onChange({...stage,sla:{...stage.sla,completionFormRequired:value}})} />
    <Text weight="semibold">Employee work information</Text>
    <TextField label="Task title template" value={display.titleTemplate ?? ""} onChangeText={value=>updateDisplay({titleTemplate:value})} />
    <TextField label="Short description" value={display.shortDescription ?? ""} onChangeText={value=>updateDisplay({shortDescription:value})} />
    <TextField label="What the employee needs to do" multiline value={display.instructions ?? stage.method ?? ""} onChangeText={value=>updateDisplay({instructions:value})} />
    <TextField label="Expected result" value={display.expectedResult ?? ""} onChangeText={value=>updateDisplay({expectedResult:value})} />
    <TextField label="Due-date label" value={display.dueLabel ?? "Due"} onChangeText={value=>updateDisplay({dueLabel:value})} />
    <OptionPicker label="Information received (up to 12 questions)" multiple options={received.map(item=>({value:item.key,label:item.label}))} selected={received.filter(item=>display.fields?.some(source=>source.sourceStageKey===item.source.sourceStageKey && source.fieldKey===item.source.fieldKey)).map(item=>item.key)} onChange={values=>updateDisplay({fields:received.filter(item=>values.includes(item.key)).slice(0,12).map(item=>item.source)})} />
    <TextField label="Optional maximum visits" keyboardType="number-pad" value={stage.sla.followUp?.maxVisits.toString() ?? ""} onChangeText={value=>onChange({...stage,sla:{...stage.sla,followUp:value ? {maxVisits:Number(value),onLimit:stage.sla.followUp?.onLimit ?? "hold"}:undefined}})} />
    {stage.sla.followUp ? <OptionPicker label="When follow-up limit is reached" options={[{value:"hold",label:"Hold for review"},{value:"escalate",label:"Escalate and hold for review"}]} selected={[stage.sla.followUp.onLimit]} onChange={values=>onChange({...stage,sla:{...stage.sla,followUp:{maxVisits:stage.sla.followUp!.maxVisits,onLimit:values[0]==="escalate"?"escalate":"hold"}}})} /> : null}
  </Card>;
}
