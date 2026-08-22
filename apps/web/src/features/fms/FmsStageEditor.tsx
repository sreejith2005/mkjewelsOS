import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  FMS_BRANCH_OPERATORS,
  FMS_STATUS_CONDITION_OPERATORS,
  type FmsBranchRule,
  type FmsSlaRule,
  type FmsStageDefinition,
  type FmsTimingMethod,
} from "@jewelos/core";
import { Button, Field } from "@/components/ui";
import type { FmsData } from "./api";

const humanTypes: readonly FmsStageDefinition["type"][] = ["form", "task", "approval"];
const timingOptions: readonly { value: FmsTimingMethod; label: string; help: string }[] = [
  { value: "completion_date", label: "Completion date", help: "Complete by the selected calendar date." },
  { value: "tat_hours", label: "TAT (hours)", help: "Working target measured from an earlier step." },
  { value: "days_before_date", label: "Days before date", help: "Due a fixed number of days before a future date." },
  { value: "specific_time", label: "Specific clock time", help: "Due on a selected date at a selected time." },
];
const defaultStatusOptions = ["Busy", "DND", "Follow Up", "Interested", "Not Interested", "Proposal", "Ringing", "demo call done", "required follow up", "yes"] as const;
const statusOperatorLabel: Record<typeof FMS_STATUS_CONDITION_OPERATORS[number], string> = { equals: "equals", not_equals: "not equals", greater_than: "greater than", less_than: "less than", greater_than_or_equal: "greater than & equals", less_than_or_equal: "less than and equals", contains: "contains", not_contains: "not contains" };

export function FmsStageEditor({ stage, stages, data, onChange, onDelete }: { stage: FmsStageDefinition; stages: readonly FmsStageDefinition[]; data: FmsData; onChange: (value: FmsStageDefinition) => void; onDelete: () => void }) {
  const update = (patch: Partial<FmsStageDefinition>) => onChange({ ...stage, ...patch });
  const updateSla = (patch: Partial<FmsSlaRule>) => update({ sla: { ...stage.sla, ...patch } });
  const stageIndex = stages.findIndex((item) => item.key === stage.key);
  const firstStage = stageIndex === 0;
  const earlierStages = stages.slice(0, Math.max(0, stageIndex));
  const earlierDecisions = earlierStages.filter((item) => item.sla.decisionMode === "yes_no");
  const others = stages.filter((item) => item.key !== stage.key);
  const human = humanTypes.includes(stage.type);
  const canChooseNext = !["branch", "parallel_start", "end"].includes(stage.type);
  const [showAdditional, setShowAdditional] = useState(!!stage.method || !!stage.formTemplateId || stage.requiresUpload || stage.requiresRemark || stage.requiresNextDoerHandoff || stage.canReject || stage.canRequestRevision || stage.canEscalate);
  const [showConditional, setShowConditional] = useState(!!stage.sla.conditional);
  const statusCondition = stage.sla.conditional && "field" in stage.sla.conditional ? stage.sla.conditional : undefined;
  const decisionCondition = stage.sla.conditional && !("field" in stage.sla.conditional) ? stage.sla.conditional : undefined;
  const statusOptions = [...new Map([...(data.statusOptions ?? []), ...defaultStatusOptions.map((label) => ({ label, value: label }))].map((option) => [option.value.toLowerCase(), option])).values()];

  useEffect(() => {
    setShowAdditional(!!stage.method || !!stage.formTemplateId || stage.requiresUpload || stage.requiresRemark || stage.requiresNextDoerHandoff || stage.canReject || stage.canRequestRevision || stage.canEscalate);
    setShowConditional(!!stage.sla.conditional);
  }, [stage.key]);

  const changeBranchRule = (index: number, patch: Partial<FmsBranchRule>) => update({ branchRules: stage.branchRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule).map((rule, order) => ({ ...rule, order })) });
  const moveBranchRule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stage.branchRules.length) return;
    const rules = [...stage.branchRules];
    [rules[index], rules[target]] = [rules[target]!, rules[index]!];
    update({ branchRules: rules.map((rule, order) => ({ ...rule, order })) });
  };

  return <div className="space-y-5 pb-8">
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">Step details</h4>
      <Field label="Step name"><input autoFocus className="field" maxLength={150} onChange={(event) => update({ name: event.target.value })} placeholder="e.g. Issue PO to supplier" value={stage.name} /></Field>
    </section>


    {human ? <section className="space-y-3 border-t border-gold/15 pt-4">
      <div><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">Step type</h4><p className="mt-1 text-xs text-soft-grey">A normal step is completed once. A decision step records a required Yes or No.</p></div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button className={`rounded-xl border p-3 text-left ${stage.sla.decisionMode !== "yes_no" ? "border-gold bg-gold/10 text-white" : "border-gold/20 text-soft-grey"}`} onClick={() => updateSla({ decisionMode: "normal", conditional: stage.sla.conditional })} type="button"><b className="block text-sm">Normal step (Done)</b><span className="text-xs">Complete and continue</span></button>
        <button className={`rounded-xl border p-3 text-left ${stage.sla.decisionMode === "yes_no" ? "border-gold bg-gold/10 text-white" : "border-gold/20 text-soft-grey"} disabled:cursor-not-allowed disabled:opacity-50`} disabled={firstStage} onClick={() => updateSla({ decisionMode: "yes_no" })} type="button"><b className="block text-sm">Decision step (Yes/No)</b><span className="text-xs">Choose a path when completing</span></button>
      </div>
      {firstStage ? <p className="text-xs text-soft-grey">The first step collects the initial form, so it remains a normal step.</p> : null}
    </section> : null}

    {human ? <section className="space-y-3 border-t border-gold/15 pt-4">
      <label className="flex items-start gap-2 rounded-xl border border-gold/20 p-3 text-sm"><input aria-label="Add additional information" checked={showAdditional} onChange={(event) => setShowAdditional(event.target.checked)} type="checkbox" /><span><b className="block text-white">Additional information (optional)</b><span className="text-xs text-soft-grey">Add instructions, a linked form, or completion controls.</span></span></label>
      {showAdditional ? <div className="space-y-3 rounded-xl border border-gold/15 bg-white/[0.02] p-3">
        <Field label="How / instructions"><textarea className="field min-h-20" onChange={(event) => update({ method: event.target.value })} placeholder="e.g. Get WhatsApp PO confirmation" value={stage.method ?? ""} /></Field>
        <LinkedForm data={data} firstStage={firstStage} stage={stage} update={update} />
        <div className="grid gap-2 text-sm sm:grid-cols-2">{([{ key: "requiresUpload", label: "Require evidence" }, { key: "requiresRemark", label: "Require remark" }, { key: "requiresNextDoerHandoff", label: "Choose next assignee" }, { key: "canReject", label: "Can reject" }, { key: "canRequestRevision", label: "Can request revision" }, { key: "canEscalate", label: "Can escalate" }] as const).map(({ key, label }) => <label className="rounded-lg border border-gold/15 p-2" key={key}><input checked={stage[key]} onChange={(event) => update({ [key]: event.target.checked })} type="checkbox" /> {label}</label>)}</div>
        <details><summary className="cursor-pointer text-xs text-soft-grey">Technical details</summary><Field label="Stable key"><input className="field mt-2" onChange={(event) => update({ key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} value={stage.key} /></Field></details>
      </div> : null}
    </section> : null}

    <section className="space-y-3 border-t border-gold/15 pt-4">
      <div><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">When</h4><p className="mt-1 text-xs text-soft-grey">Choose how this step’s deadline is calculated.</p></div>
      <div className="grid gap-2 sm:grid-cols-2">{timingOptions.map((option) => <button className={`rounded-xl border p-3 text-left ${timingMethod(stage.sla) === option.value ? "border-gold bg-gold/10 text-white" : "border-gold/20 text-soft-grey"}`} key={option.value} onClick={() => updateSla({ timingMethod: option.value })} type="button"><b className="block text-sm">{option.label}</b><span className="text-xs">{option.help}</span></button>)}</div>
      <TimingFields earlierStages={earlierStages} sla={stage.sla} updateSla={updateSla} />
    </section>

    {!firstStage && human ? <section className="space-y-3 border-t border-gold/15 pt-4">
      <label className="flex items-start gap-2 rounded-xl border border-gold/20 p-3 text-sm"><input aria-label="Enable conditional step" checked={showConditional && !!stage.sla.conditional} onChange={(event) => { setShowConditional(event.target.checked); updateSla({ conditional: event.target.checked ? { field: "status", operator: "equals", value: statusOptions[0]?.value ?? "" } : undefined }); }} type="checkbox" /><span><b className="block text-white">Conditional (optional)</b><span className="text-xs text-soft-grey">Run this step only when the workflow Status matches the selected value.</span></span></label>
      {showConditional && stage.sla.conditional ? <div className="grid gap-3 rounded-xl border border-gold/15 bg-white/[0.02] p-3 sm:grid-cols-2"><Field label="Field"><select aria-label="Condition field" className="field" onChange={(event) => updateSla({ conditional: event.target.value === "decision" && earlierDecisions.length ? { decisionStageKey: earlierDecisions.at(-1)!.key, outcome: "yes" } : { field: "status", operator: "equals", value: statusOptions[0]?.value ?? "" } })} value={statusCondition ? "status" : "decision"}><option value="status">Status</option>{earlierDecisions.length ? <option value="decision">Earlier Yes / No decision</option> : null}</select></Field>{statusCondition ? <><Field label="Operator"><select aria-label="Condition operator" className="field" onChange={(event) => updateSla({ conditional: { ...statusCondition, operator: event.target.value as typeof FMS_STATUS_CONDITION_OPERATORS[number] } })} value={statusCondition.operator}>{FMS_STATUS_CONDITION_OPERATORS.map((operator) => <option key={operator} value={operator}>{statusOperatorLabel[operator]}</option>)}</select></Field><Field label="Status value"><select aria-label="Status value" className="field" onChange={(event) => updateSla({ conditional: { ...statusCondition, value: event.target.value } })} value={statusCondition.value}><option value="">Select value</option>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field></> : decisionCondition ? <><Field label="Earlier decision"><select className="field" onChange={(event) => updateSla({ conditional: { decisionStageKey: event.target.value, outcome: "yes" } })} value={decisionCondition.decisionStageKey}>{earlierDecisions.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></Field><Field label="Run when answer is"><select className="field" onChange={(event) => updateSla({ conditional: { decisionStageKey: decisionCondition.decisionStageKey, outcome: event.target.value as "yes" | "no" }})} value={decisionCondition.outcome}><option value="yes">Yes</option><option value="no">No</option></select></Field></> : null}</div> : null}
    </section> : null}

    {canChooseNext ? <Field label="On completion, go to"><StageSelect others={others} value={stage.defaultNextStageKey} onChange={(value) => update({ defaultNextStageKey: value })} /></Field> : null}
    {stage.type === "branch" ? <BranchEditor stage={stage} others={others} update={update} changeRule={changeBranchRule} moveRule={moveBranchRule} /> : null}
    {stage.type === "parallel_start" ? <section className="space-y-2"><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">Parallel paths</h4>{others.map((item) => <label className="block rounded-lg border border-gold/15 p-2 text-sm" key={item.key}><input checked={stage.parallelTargetStageKeys.includes(item.key)} onChange={(event) => update({ parallelTargetStageKeys: event.target.checked ? [...stage.parallelTargetStageKeys, item.key] : stage.parallelTargetStageKeys.filter((key) => key !== item.key) })} type="checkbox" /> {item.name}</label>)}</section> : null}
    {stage.type === "parallel_join" ? <section className="space-y-3"><Field label="Join when"><select className="field" onChange={(event) => update({ joinRule: event.target.value as "all" | "any" | "specific" })} value={stage.joinRule ?? "all"}><option value="all">All paths complete</option><option value="any">Any path completes</option><option value="specific">Specific paths complete</option></select></Field>{stage.joinRule === "specific" ? others.map((item) => <label className="block text-sm" key={item.key}><input checked={stage.joinRequiredStageKeys.includes(item.key)} onChange={(event) => update({ joinRequiredStageKeys: event.target.checked ? [...stage.joinRequiredStageKeys, item.key] : stage.joinRequiredStageKeys.filter((key) => key !== item.key) })} type="checkbox" /> {item.name}</label>) : null}</section> : null}
    {!firstStage ? <Button onClick={onDelete} type="button" variant="danger"><Trash2 className="size-4" />Delete step</Button> : <p className="rounded-lg border border-gold/20 bg-gold/5 p-3 text-xs text-soft-grey">This Form is the workflow trigger. It can be reconfigured but not removed.</p>}
  </div>;
}

function TimingFields({ sla, earlierStages, updateSla }: { sla: FmsSlaRule; earlierStages: readonly FmsStageDefinition[]; updateSla: (patch: Partial<FmsSlaRule>) => void }) {
  const method = timingMethod(sla);
  if (method === "tat_hours") return <div className="grid gap-3 sm:grid-cols-2"><Field label="TAT (hours)"><input className="field" min="0.25" onChange={(event) => updateSla({ tatHours: event.target.value ? Number(event.target.value) : undefined })} placeholder="e.g. 3" step="0.25" type="number" value={sla.tatHours ?? ""} /></Field><Field label="Trigger from"><select className="field" onChange={(event) => updateSla({ triggerStageKey: event.target.value || undefined })} value={sla.triggerStageKey ?? ""}><option value="">Auto (previous step’s completion)</option>{earlierStages.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></Field></div>;
  if (method === "days_before_date") return <div className="grid gap-3 sm:grid-cols-2"><Field label="Future date"><input className="field" min={localCalendarDate()} onChange={(event) => updateSla({ futureDate: event.target.value })} type="date" value={sla.futureDate ?? ""} /></Field><Field label="Days before"><input className="field" min="0" onChange={(event) => updateSla({ daysBefore: event.target.value ? Number(event.target.value) : undefined })} step="1" type="number" value={sla.daysBefore ?? ""} /></Field></div>;
  if (method === "specific_time") return <div className="grid gap-3 sm:grid-cols-2"><Field label="Date"><input className="field" min={localCalendarDate()} onChange={(event) => updateSla({ dueDate: event.target.value })} type="date" value={sla.dueDate ?? ""} /></Field><Field label="Clock time"><input className="field" onChange={(event) => updateSla({ clockTime: event.target.value })} type="time" value={sla.clockTime ?? ""} /></Field></div>;
  return <Field label="Completion due date"><input className="field" min={localCalendarDate()} onChange={(event) => updateSla({ dueDate: event.target.value })} required type="date" value={sla.dueDate ?? ""} /></Field>;
}

function LinkedForm({ data, firstStage, stage, update }: { data: FmsData; firstStage: boolean; stage: FmsStageDefinition; update: (patch: Partial<FmsStageDefinition>) => void }) {
  if (firstStage) return <div className="space-y-2"><p className="text-xs font-medium text-white">Initial details form</p><p className="text-xs text-soft-grey">The first step uses this form to collect the workflow’s initial details.</p><select aria-label="Initial details form" className="field" onChange={(event) => update({ formTemplateId: event.target.value || undefined })} value={stage.formTemplateId ?? ""}><option value="">Select the initial Form</option>{data.forms.map((form) => <option key={form.id} value={form.id}>{form.name} · v{form.version}</option>)}</select></div>;
  return <div className="space-y-2"><label className="flex items-start gap-2 rounded-lg border border-gold/15 p-3 text-sm"><input aria-label="Attach an optional form" checked={!!stage.formTemplateId} onChange={(event) => update({ formTemplateId: event.target.checked ? data.forms[0]?.id : undefined })} type="checkbox" /><span><b className="block text-white">Attach a form to this step</b><span className="text-xs text-soft-grey">Optional. This step can complete without another form submission.</span></span></label>{stage.formTemplateId ? <select aria-label="Optional linked form" className="field" onChange={(event) => update({ formTemplateId: event.target.value || undefined })} value={stage.formTemplateId}><option value="">Choose a Form</option>{data.forms.map((form) => <option key={form.id} value={form.id}>{form.name} · v{form.version}</option>)}</select> : null}</div>;
}

function BranchEditor({ stage, others, update, changeRule, moveRule }: { stage: FmsStageDefinition; others: readonly FmsStageDefinition[]; update: (patch: Partial<FmsStageDefinition>) => void; changeRule: (index: number, patch: Partial<FmsBranchRule>) => void; moveRule: (index: number, direction: -1 | 1) => void }) {
  return <section className="space-y-3 border-t border-gold/15 pt-4"><div><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">Ordered decision routes</h4><p className="mt-1 text-xs text-soft-grey">Advanced routes run top to bottom. Keep one fallback route last.</p></div>{stage.branchRules.map((rule, index) => <article className="space-y-2 rounded-xl border border-gold/20 p-3" key={rule.id}><div className="flex items-center gap-2"><input className="field" onChange={(event) => changeRule(index, { label: event.target.value })} placeholder={`Route ${index + 1} label`} value={rule.label ?? ""} /><button aria-label="Move route up" disabled={index === 0} onClick={() => moveRule(index, -1)} type="button"><ArrowUp className="size-4" /></button><button aria-label="Move route down" disabled={index === stage.branchRules.length - 1} onClick={() => moveRule(index, 1)} type="button"><ArrowDown className="size-4" /></button><button aria-label="Delete route" disabled={stage.branchRules.length === 1} onClick={() => update({ branchRules: stage.branchRules.filter((_, ruleIndex) => ruleIndex !== index).map((item, order) => ({ ...item, order })) })} type="button"><Trash2 className="size-4 text-danger" /></button></div><div className="grid gap-2 sm:grid-cols-2"><select className="field" onChange={(event) => changeRule(index, { source: event.target.value as FmsBranchRule["source"] })} value={rule.source}><option value="outcome">Previous outcome</option><option value="context">Process data</option><option value="form_answer">Form answer</option></select><input className="field" disabled={rule.source === "outcome"} onChange={(event) => changeRule(index, { sourceKey: event.target.value })} placeholder="Stable field key" value={rule.sourceKey ?? ""} /><select className="field" onChange={(event) => changeRule(index, { operator: event.target.value as FmsBranchRule["operator"] })} value={rule.operator}>{FMS_BRANCH_OPERATORS.map((operator) => <option key={operator} value={operator}>{operator === "default" ? "Fallback" : operator.replaceAll("_", " ")}</option>)}</select><input className="field" disabled={["default", "not_empty"].includes(rule.operator)} onChange={(event) => changeRule(index, { value: event.target.value })} placeholder="Expected value" value={String(rule.value ?? "")} /></div><StageSelect others={others} value={rule.nextStageKey} onChange={(value) => changeRule(index, { nextStageKey: value, nextFlowId: undefined })} /></article>)}<Button onClick={() => { const route: FmsBranchRule = { id: crypto.randomUUID(), source: "outcome", operator: "equals", value: "", order: Math.max(0, stage.branchRules.length - 1), label: "New route" }; update({ branchRules: [...stage.branchRules.filter((rule) => rule.operator !== "default"), route, ...stage.branchRules.filter((rule) => rule.operator === "default")].map((rule, order) => ({ ...rule, order })) }); }} type="button" variant="secondary"><Plus className="size-4" />Add route</Button></section>;
}

function timingMethod(sla: FmsSlaRule): FmsTimingMethod { return sla.timingMethod ?? "completion_date"; }
function StageSelect({ others, value, onChange }: { others: readonly FmsStageDefinition[]; value?: string | undefined; onChange: (value: string | undefined) => void }) { return <select className="field" onChange={(event) => onChange(event.target.value || undefined)} value={value ?? ""}><option value="">Complete workflow here</option>{others.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select>; }
function localCalendarDate(now = new Date()): string { const year = now.getFullYear(); const month = String(now.getMonth() + 1).padStart(2, "0"); const day = String(now.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }
