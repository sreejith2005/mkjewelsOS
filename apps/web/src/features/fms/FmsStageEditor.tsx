import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GitBranch, Plus, Trash2 } from "lucide-react";
import {
  FMS_BRANCH_OPERATORS,
  hasFmsStageRouting,
  type FmsBranchOperator,
  type FmsBranchRule,
  type FmsFormFieldRef,
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
/** Route conditions offered on an ordinary step. `default` stays reserved for the fallback. */
const routeOperators: readonly { value: FmsBranchOperator; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "in", label: "is one of" },
  { value: "contains", label: "contains" },
  { value: "not_empty", label: "is answered" },
];
const VALUE_FREE_OPERATORS: ReadonlySet<string> = new Set(["not_empty", "default"]);

const optionCheckboxes = [
  { key: "requiresUpload", label: "Require evidence" },
  { key: "requiresRemark", label: "Require remark" },
  { key: "requiresNextDoerHandoff", label: "Choose next assignee" },
  { key: "canReject", label: "Can reject" },
  { key: "canRequestRevision", label: "Can request revision" },
  { key: "canEscalate", label: "Can escalate" },
] as const;

export function FmsStageEditor({ stage, stages, data, onChange, onDelete }: { stage: FmsStageDefinition; stages: readonly FmsStageDefinition[]; data: FmsData; onChange: (value: FmsStageDefinition) => void; onDelete: () => void }) {
  const update = (patch: Partial<FmsStageDefinition>) => onChange({ ...stage, ...patch });
  const updateSla = (patch: Partial<FmsSlaRule>) => update({ sla: { ...stage.sla, ...patch } });
  const stageIndex = stages.findIndex((item) => item.key === stage.key);
  const firstStage = stageIndex === 0;
  const earlierStages = stages.slice(0, Math.max(0, stageIndex));
  const earlierDecisions = earlierStages.filter((item) => item.sla.decisionMode === "decision" || item.sla.decisionMode === "yes_no");
  const others = stages.filter((item) => item.key !== stage.key);
  const human = humanTypes.includes(stage.type);
  const canChooseNext = !["branch", "parallel_start", "end"].includes(stage.type);
  const decision = stage.sla.decisionMode === "decision" || stage.sla.decisionMode === "yes_no";
  const formFields = stage.formTemplateId ? data.formFields[stage.formTemplateId] ?? [] : [];
  const [showConditional, setShowConditional] = useState(!!stage.sla.conditional && "decisionStageKey" in stage.sla.conditional);
  const decisionCondition = stage.sla.conditional && "decisionStageKey" in stage.sla.conditional ? stage.sla.conditional : undefined;

  useEffect(() => { setShowConditional(!!stage.sla.conditional && "decisionStageKey" in stage.sla.conditional); }, [stage.key]);

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
      <div><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">Step type</h4><p className="mt-1 text-xs text-soft-grey">A normal step is completed once. A decision step records one configured outcome.</p></div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button className={`rounded-xl border p-3 text-left ${!decision ? "border-gold bg-gold/10 text-white" : "border-gold/20 text-soft-grey"}`} onClick={() => updateSla({ decisionMode: "normal", decisionOptions: undefined })} type="button"><b className="block text-sm">Normal step (Done)</b><span className="text-xs">Complete and continue</span></button>
        <button className={`rounded-xl border p-3 text-left ${decision ? "border-gold bg-gold/10 text-white" : "border-gold/20 text-soft-grey"} disabled:cursor-not-allowed disabled:opacity-50`} disabled={firstStage} onClick={() => updateSla({ decisionMode: "decision", decisionOptions: stage.sla.decisionOptions?.length ? stage.sla.decisionOptions : [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }] })} type="button"><b className="block text-sm">Decision step</b><span className="text-xs">Choose a configured path when completing</span></button>
      </div>
      {decision ? <DecisionOptions options={stage.sla.decisionOptions ?? [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }]} update={(decisionOptions) => updateSla({ decisionMode: "decision", decisionOptions })} /> : null}
      {firstStage ? <p className="text-xs text-soft-grey">The first step collects the initial form, so it remains a normal step.</p> : null}
    </section> : null}

    {human ? <section className="space-y-3 border-t border-gold/15 pt-4">
      <div><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">Linked form</h4><p className="mt-1 text-xs text-soft-grey">{firstStage ? "The first step uses this form to collect the workflow’s initial details." : "Attach a Form the doer fills in when completing this step. Its answers can also drive the routing below."}</p></div>
      <LinkedForm data={data} firstStage={firstStage} stage={stage} update={update} />
    </section> : null}

    {canChooseNext ? <StageRouting decision={decision} fields={formFields} others={others} stage={stage} changeRule={changeBranchRule} moveRule={moveBranchRule} update={update} /> : null}

    <section className="space-y-3 border-t border-gold/15 pt-4">
      <div><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">When</h4><p className="mt-1 text-xs text-soft-grey">Choose how this step’s deadline is calculated.</p></div>
      <div className="grid gap-2 sm:grid-cols-2">{timingOptions.map((option) => <button className={`rounded-xl border p-3 text-left ${timingMethod(stage.sla) === option.value ? "border-gold bg-gold/10 text-white" : "border-gold/20 text-soft-grey"}`} key={option.value} onClick={() => updateSla({ timingMethod: option.value })} type="button"><b className="block text-sm">{option.label}</b><span className="text-xs">{option.help}</span></button>)}</div>
      <label className="flex items-center gap-2 rounded-xl border border-gold/20 p-3 text-sm"><input aria-label="Set deadline" checked={stage.sla.deadlineEnabled !== false} onChange={(event) => updateSla({ deadlineEnabled: event.target.checked })} type="checkbox" /><b className="text-white">Set Deadline: {stage.sla.deadlineEnabled !== false ? "ON" : "OFF"}</b></label>
      <TimingFields earlierStages={earlierStages} sla={stage.sla} updateSla={updateSla} />
    </section>

    {human ? <section className="space-y-2 border-t border-gold/15 pt-4">
      <details className="group rounded-xl border border-gold/15" open={!!stage.method}>
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-champagne">How / instructions{stage.method ? "" : " (optional)"}</summary>
        <div className="px-3 pb-3"><textarea aria-label="How / instructions" className="field min-h-16 text-sm" onChange={(event) => update({ method: event.target.value })} placeholder="e.g. Get WhatsApp PO confirmation" value={stage.method ?? ""} /></div>
      </details>
      <details className="rounded-xl border border-gold/15" open={optionCheckboxes.some(({ key }) => stage[key])}>
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-champagne">Completion controls</summary>
        <div className="grid gap-2 px-3 pb-3 text-sm sm:grid-cols-2">{optionCheckboxes.map(({ key, label }) => <label className="rounded-lg border border-gold/15 p-2" key={key}><input checked={stage[key]} onChange={(event) => update({ [key]: event.target.checked })} type="checkbox" /> {label}</label>)}</div>
      </details>
      <details className="rounded-xl border border-gold/15">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-soft-grey">Technical details</summary>
        <div className="px-3 pb-3"><Field label="Stable key"><input className="field" onChange={(event) => update({ key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} value={stage.key} /></Field></div>
      </details>
    </section> : null}

    {!firstStage && human ? <section className="space-y-3 border-t border-gold/15 pt-4">
      <label className="flex items-start gap-2 rounded-xl border border-gold/20 p-3 text-sm"><input aria-label="Enable conditional step" checked={showConditional && !!decisionCondition} disabled={!earlierDecisions.length} onChange={(event) => { const target = earlierDecisions.at(-1); setShowConditional(event.target.checked); updateSla({ conditional: event.target.checked && target ? { decisionStageKey: target.key, decisionOptionKey: target.sla.decisionOptions?.[0]?.key ?? "" } : undefined }); }} type="checkbox" /><span><b className="block text-white">Skip unless an earlier decision matches (optional)</b><span className="text-xs text-soft-grey">{earlierDecisions.length ? "Run this step only for a selected outcome from an earlier Decision Step." : "Add an earlier Decision Step to define this condition."}</span></span></label>
      {showConditional && decisionCondition ? <div className="grid gap-3 rounded-xl border border-gold/15 bg-white/[0.02] p-3 sm:grid-cols-2"><DynamicDecisionCondition condition={decisionCondition} decisions={earlierDecisions} updateSla={updateSla} /></div> : null}
    </section> : null}

    {stage.type === "branch" ? <BranchEditor stage={stage} others={others} update={update} changeRule={changeBranchRule} moveRule={moveBranchRule} /> : null}
    {stage.type === "parallel_start" ? <section className="space-y-2"><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">Parallel paths</h4>{others.map((item) => <label className="block rounded-lg border border-gold/15 p-2 text-sm" key={item.key}><input checked={stage.parallelTargetStageKeys.includes(item.key)} onChange={(event) => update({ parallelTargetStageKeys: event.target.checked ? [...stage.parallelTargetStageKeys, item.key] : stage.parallelTargetStageKeys.filter((key) => key !== item.key) })} type="checkbox" /> {item.name}</label>)}</section> : null}
    {stage.type === "parallel_join" ? <section className="space-y-3"><Field label="Join when"><select className="field" onChange={(event) => update({ joinRule: event.target.value as "all" | "any" | "specific" })} value={stage.joinRule ?? "all"}><option value="all">All paths complete</option><option value="any">Any path completes</option><option value="specific">Specific paths complete</option></select></Field>{stage.joinRule === "specific" ? others.map((item) => <label className="block text-sm" key={item.key}><input checked={stage.joinRequiredStageKeys.includes(item.key)} onChange={(event) => update({ joinRequiredStageKeys: event.target.checked ? [...stage.joinRequiredStageKeys, item.key] : stage.joinRequiredStageKeys.filter((key) => key !== item.key) })} type="checkbox" /> {item.name}</label>) : null}</section> : null}
    {!firstStage ? <Button onClick={onDelete} type="button" variant="danger"><Trash2 className="size-4" />Delete step</Button> : <p className="rounded-lg border border-gold/20 bg-gold/5 p-3 text-xs text-soft-grey">This Form is the workflow trigger. It can be reconfigured but not removed.</p>}
  </div>;
}

/**
 * Outgoing routing for an ordinary step. With no rules the step keeps the
 * historical single successor; adding rules turns it into an ordered switch
 * whose fallback stays `defaultNextStageKey`, so published flows are unaffected.
 */
function StageRouting({ stage, others, fields, decision, update, changeRule, moveRule }: { stage: FmsStageDefinition; others: readonly FmsStageDefinition[]; fields: readonly FmsFormFieldRef[]; decision: boolean; update: (patch: Partial<FmsStageDefinition>) => void; changeRule: (index: number, patch: Partial<FmsBranchRule>) => void; moveRule: (index: number, direction: -1 | 1) => void }) {
  const routed = hasFmsStageRouting(stage);
  const addRoute = () => {
    const source = stage.formTemplateId && fields.length ? "form_answer" as const : decision ? "outcome" as const : "context" as const;
    const route: FmsBranchRule = { id: crypto.randomUUID(), source, operator: "equals", ...(source === "form_answer" ? { sourceKey: fields[0]?.key } : {}), value: source === "outcome" ? stage.sla.decisionOptions?.[0]?.key ?? "" : "", order: stage.branchRules.length, nextStageKey: undefined };
    update({ branchRules: [...stage.branchRules, route].map((rule, order) => ({ ...rule, order })) });
  };
  return <section className="space-y-3 border-t border-gold/15 pt-4">
    <div className="flex items-start justify-between gap-3">
      <div><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">On completion</h4><p className="mt-1 text-xs text-soft-grey">{routed ? "Routes are checked top to bottom. The first match wins; anything else takes the fallback." : "This step continues to one next step. Add a condition to send different answers down different paths."}</p></div>
      <Button aria-label="Add conditional route" className="shrink-0" onClick={addRoute} type="button" variant="secondary"><GitBranch className="size-4" />Add route</Button>
    </div>

    {stage.branchRules.map((rule, index) => <RouteRow decision={decision} fields={fields} index={index} key={rule.id} others={others} rule={rule} stage={stage} changeRule={changeRule} moveRule={moveRule} remove={() => update({ branchRules: stage.branchRules.filter((_, ruleIndex) => ruleIndex !== index).map((item, order) => ({ ...item, order })) })} />)}

    <Field label={routed ? "Otherwise (fallback) go to" : "Continue to"}><StageSelect others={others} value={stage.defaultNextStageKey} onChange={(value) => update({ defaultNextStageKey: value })} /></Field>
    {routed && !stage.formTemplateId && stage.branchRules.some((rule) => rule.source === "form_answer") ? <p className="rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">Link a Form above so these answers exist at run time.</p> : null}
  </section>;
}

function RouteRow({ rule, index, stage, others, fields, decision, changeRule, moveRule, remove }: { rule: FmsBranchRule; index: number; stage: FmsStageDefinition; others: readonly FmsStageDefinition[]; fields: readonly FmsFormFieldRef[]; decision: boolean; changeRule: (index: number, patch: Partial<FmsBranchRule>) => void; moveRule: (index: number, direction: -1 | 1) => void; remove: () => void }) {
  const field = rule.source === "form_answer" ? fields.find((item) => item.key === rule.sourceKey) : undefined;
  const options = rule.source === "outcome" ? (stage.sla.decisionOptions ?? []).map((option) => ({ value: option.key, label: option.label })) : (field?.optionValues ?? []).map((value) => ({ value, label: value }));
  const selected = Array.isArray(rule.value) ? rule.value.map(String) : [String(rule.value ?? "")].filter(Boolean);
  return <article className="space-y-2 rounded-xl border border-gold/20 bg-white/[0.02] p-3" key={rule.id}>
    <div className="flex items-center gap-2">
      <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">Route {index + 1}</span>
      <input aria-label={`Route ${index + 1} label`} className="field h-9 flex-1 text-xs" maxLength={60} onChange={(event) => changeRule(index, { label: event.target.value })} placeholder="Label shown on the connection" value={rule.label ?? ""} />
      <button aria-label={`Move route ${index + 1} up`} className="rounded p-1 text-soft-grey hover:text-gold disabled:opacity-40" disabled={index === 0} onClick={() => moveRule(index, -1)} type="button"><ArrowUp className="size-4" /></button>
      <button aria-label={`Move route ${index + 1} down`} className="rounded p-1 text-soft-grey hover:text-gold disabled:opacity-40" disabled={index === stage.branchRules.length - 1} onClick={() => moveRule(index, 1)} type="button"><ArrowDown className="size-4" /></button>
      <button aria-label={`Delete route ${index + 1}`} className="rounded p-1 text-soft-grey hover:text-danger" onClick={remove} type="button"><Trash2 className="size-4" /></button>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block"><span className="label">When</span><select aria-label={`Route ${index + 1} source`} className="field" onChange={(event) => { const source = event.target.value as FmsBranchRule["source"]; changeRule(index, { source, sourceKey: source === "form_answer" ? fields[0]?.key : source === "outcome" ? undefined : rule.sourceKey, value: "" }); }} value={rule.source}>
        <option disabled={!fields.length} value="form_answer">Answer in the linked form</option>
        <option disabled={!decision} value="outcome">This step’s decision outcome</option>
        <option value="context">Process data field</option>
      </select></label>
      {rule.source === "form_answer" ? <label className="block"><span className="label">Question</span><select aria-label={`Route ${index + 1} question`} className="field" onChange={(event) => changeRule(index, { sourceKey: event.target.value, value: "" })} value={rule.sourceKey ?? ""}><option value="">Select a question</option>{fields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}{rule.sourceKey && !fields.some((item) => item.key === rule.sourceKey) ? <option value={rule.sourceKey}>{rule.sourceKey} (removed)</option> : null}</select></label>
        : rule.source === "context" ? <label className="block"><span className="label">Field key</span><input aria-label={`Route ${index + 1} field key`} className="field" onChange={(event) => changeRule(index, { sourceKey: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} placeholder="e.g. status" value={rule.sourceKey ?? ""} /></label>
        : <p className="self-end text-xs text-soft-grey">Uses the outcome the doer selects on this step.</p>}
      <label className="block"><span className="label">Condition</span><select aria-label={`Route ${index + 1} condition`} className="field" onChange={(event) => changeRule(index, { operator: event.target.value as FmsBranchOperator, value: event.target.value === "in" ? [] : "" })} value={rule.operator}>{routeOperators.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}</select></label>
      {VALUE_FREE_OPERATORS.has(rule.operator) ? null
        : options.length ? <label className="block"><span className="label">Answer</span><select aria-label={`Route ${index + 1} answer`} className="field" multiple={rule.operator === "in"} onChange={(event) => changeRule(index, { value: rule.operator === "in" ? [...event.target.selectedOptions].map((option) => option.value) : event.target.value })} value={rule.operator === "in" ? selected : selected[0] ?? ""}>{rule.operator === "in" ? null : <option value="">Select an answer</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}{selected.filter((value) => !options.some((option) => option.value === value)).map((value) => <option key={value} value={value}>{value} (removed)</option>)}</select></label>
        : <label className="block"><span className="label">Answer</span><input aria-label={`Route ${index + 1} answer`} className="field" onChange={(event) => changeRule(index, { value: rule.operator === "in" ? event.target.value.split(",").map((item) => item.trim()).filter(Boolean) : event.target.value })} placeholder={rule.operator === "in" ? "value_a, value_b" : "Expected value"} value={selected.join(", ")} /></label>}
    </div>
    <label className="block"><span className="label">Then go to</span><StageSelect label={`Route ${index + 1} then go to`} others={others} value={rule.nextStageKey} onChange={(value) => changeRule(index, { nextStageKey: value, nextFlowId: undefined })} /></label>
  </article>;
}

function TimingFields({ sla, earlierStages, updateSla }: { sla: FmsSlaRule; earlierStages: readonly FmsStageDefinition[]; updateSla: (patch: Partial<FmsSlaRule>) => void }) {
  if (sla.deadlineEnabled === false) return <p className="rounded-lg border border-gold/15 p-3 text-xs text-soft-grey">No deadline will be created for this step.</p>;
  const method = timingMethod(sla);
  if (method === "tat_hours") { const unit = sla.tatUnit ?? "hours"; const display = sla.tatMinutes === undefined ? sla.tatHours ?? "" : unit === "hours" ? sla.tatMinutes / 60 : sla.tatMinutes; return <div className="grid gap-3 sm:grid-cols-3"><Field label="TAT"><input aria-label="TAT value" className="field" min="1" onChange={(event) => { const value = event.target.value ? Number(event.target.value) : undefined; updateSla({ tatMinutes: value === undefined ? undefined : Math.round(unit === "hours" ? value * 60 : value), tatHours: undefined }); }} step={unit === "hours" ? "0.25" : "1"} type="number" value={display} /></Field><Field label="TAT unit"><select aria-label="TAT unit" className="field" onChange={(event) => { const next = event.target.value as "hours" | "minutes"; const minutes = sla.tatMinutes ?? (sla.tatHours ?? 0) * 60; updateSla({ tatUnit: next, tatMinutes: minutes || undefined, tatHours: undefined }); }} value={unit}><option value="hours">Hours</option><option value="minutes">Minutes</option></select></Field><Field label="Trigger from"><select className="field" onChange={(event) => updateSla({ triggerStageKey: event.target.value || undefined })} value={sla.triggerStageKey ?? ""}><option value="">Auto (previous step’s completion)</option>{earlierStages.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></Field></div>; }
  if (method === "days_before_date") return <div className="grid gap-3 sm:grid-cols-2"><Field label="Future date"><input className="field" min={localCalendarDate()} onChange={(event) => updateSla({ futureDate: event.target.value })} type="date" value={sla.futureDate ?? ""} /></Field><Field label="Days before"><input className="field" min="0" onChange={(event) => updateSla({ daysBefore: event.target.value ? Number(event.target.value) : undefined })} step="1" type="number" value={sla.daysBefore ?? ""} /></Field></div>;
  if (method === "specific_time") return <div className="grid gap-3 sm:grid-cols-2"><Field label="Date"><input className="field" min={localCalendarDate()} onChange={(event) => updateSla({ dueDate: event.target.value })} type="date" value={sla.dueDate ?? ""} /></Field><Field label="Clock time"><input className="field" onChange={(event) => updateSla({ clockTime: event.target.value })} type="time" value={sla.clockTime ?? ""} /></Field></div>;
  return <Field label="Completion due date"><input className="field" min={localCalendarDate()} onChange={(event) => updateSla({ dueDate: event.target.value })} required type="date" value={sla.dueDate ?? ""} /></Field>;
}

function LinkedForm({ data, firstStage, stage, update }: { data: FmsData; firstStage: boolean; stage: FmsStageDefinition; update: (patch: Partial<FmsStageDefinition>) => void }) {
  const missing = !!stage.formTemplateId && !data.forms.some((form) => form.id === stage.formTemplateId);
  const options = <>{data.forms.map((form) => <option key={form.id} value={form.id}>{form.name} · v{form.version}</option>)}{missing ? <option value={stage.formTemplateId}>Unavailable form (removed or unpublished)</option> : null}</>;
  if (firstStage) return <div className="space-y-2">
    <select aria-label="Initial details form" className="field" onChange={(event) => update({ formTemplateId: event.target.value || undefined })} value={stage.formTemplateId ?? ""}><option value="">Select the initial Form</option>{options}</select>
    {missing ? <p className="rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">This Form is no longer an available published version. Choose another before publishing.</p> : null}
  </div>;
  return <div className="space-y-2">
    <select aria-label="Linked form" className="field" onChange={(event) => update({ formTemplateId: event.target.value || undefined })} value={stage.formTemplateId ?? ""}><option value="">No form — complete this step without one</option>{options}</select>
    {missing ? <p className="rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">This Form is no longer an available published version. Choose another before publishing.</p> : null}
  </div>;
}

function BranchEditor({ stage, others, update, changeRule, moveRule }: { stage: FmsStageDefinition; others: readonly FmsStageDefinition[]; update: (patch: Partial<FmsStageDefinition>) => void; changeRule: (index: number, patch: Partial<FmsBranchRule>) => void; moveRule: (index: number, direction: -1 | 1) => void }) {
  return <section className="space-y-3 border-t border-gold/15 pt-4"><div><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">Ordered decision routes</h4><p className="mt-1 text-xs text-soft-grey">Advanced routes run top to bottom. Keep one fallback route last.</p></div>{stage.branchRules.map((rule, index) => <article className="space-y-2 rounded-xl border border-gold/20 p-3" key={rule.id}><div className="flex items-center gap-2"><input className="field" onChange={(event) => changeRule(index, { label: event.target.value })} placeholder={`Route ${index + 1} label`} value={rule.label ?? ""} /><button aria-label="Move route up" disabled={index === 0} onClick={() => moveRule(index, -1)} type="button"><ArrowUp className="size-4" /></button><button aria-label="Move route down" disabled={index === stage.branchRules.length - 1} onClick={() => moveRule(index, 1)} type="button"><ArrowDown className="size-4" /></button><button aria-label="Delete route" disabled={stage.branchRules.length === 1} onClick={() => update({ branchRules: stage.branchRules.filter((_, ruleIndex) => ruleIndex !== index).map((item, order) => ({ ...item, order })) })} type="button"><Trash2 className="size-4 text-danger" /></button></div><div className="grid gap-2 sm:grid-cols-2"><select className="field" onChange={(event) => changeRule(index, { source: event.target.value as FmsBranchRule["source"] })} value={rule.source}><option value="outcome">Previous outcome</option><option value="context">Process data</option><option value="form_answer">Form answer</option></select><input className="field" disabled={rule.source === "outcome"} onChange={(event) => changeRule(index, { sourceKey: event.target.value })} placeholder="Stable field key" value={rule.sourceKey ?? ""} /><select className="field" onChange={(event) => changeRule(index, { operator: event.target.value as FmsBranchRule["operator"] })} value={rule.operator}>{FMS_BRANCH_OPERATORS.map((operator) => <option key={operator} value={operator}>{operator === "default" ? "Fallback" : operator.replaceAll("_", " ")}</option>)}</select><input className="field" disabled={["default", "not_empty"].includes(rule.operator)} onChange={(event) => changeRule(index, { value: event.target.value })} placeholder="Expected value" value={String(rule.value ?? "")} /></div><StageSelect others={others} value={rule.nextStageKey} onChange={(value) => changeRule(index, { nextStageKey: value, nextFlowId: undefined })} /></article>)}<Button onClick={() => { const route: FmsBranchRule = { id: crypto.randomUUID(), source: "outcome", operator: "equals", value: "", order: Math.max(0, stage.branchRules.length - 1), label: "New route" }; update({ branchRules: [...stage.branchRules.filter((rule) => rule.operator !== "default"), route, ...stage.branchRules.filter((rule) => rule.operator === "default")].map((rule, order) => ({ ...rule, order })) }); }} type="button" variant="secondary"><Plus className="size-4" />Add route</Button></section>;
}

function timingMethod(sla: FmsSlaRule): FmsTimingMethod { return sla.timingMethod ?? "completion_date"; }
function StageSelect({ others, value, label, onChange }: { others: readonly FmsStageDefinition[]; value?: string | undefined; label?: string | undefined; onChange: (value: string | undefined) => void }) { return <select aria-label={label} className="field" onChange={(event) => onChange(event.target.value || undefined)} value={value ?? ""}><option value="">Complete workflow here</option>{others.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select>; }
function localCalendarDate(now = new Date()): string { const year = now.getFullYear(); const month = String(now.getMonth() + 1).padStart(2, "0"); const day = String(now.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }

function DecisionOptions({ options, update }: { options: readonly { key: string; label: string }[]; update: (options: readonly { key: string; label: string }[]) => void }) {
  const move = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= options.length) return; const next = [...options]; [next[index], next[target]] = [next[target]!, next[index]!]; update(next); };
  return <section className="space-y-2 rounded-xl border border-gold/15 p-3"><h5 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">Decision options</h5>{options.map((option, index) => <div className="flex gap-2" key={option.key}><input aria-label={`Decision option ${index + 1}`} className="field" onChange={(event) => update(options.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} value={option.label} /><button aria-label="Move decision option up" disabled={index === 0} onClick={() => move(index, -1)} type="button"><ArrowUp className="size-4" /></button><button aria-label="Move decision option down" disabled={index === options.length - 1} onClick={() => move(index, 1)} type="button"><ArrowDown className="size-4" /></button><button aria-label="Delete decision option" disabled={options.length <= 2} onClick={() => update(options.filter((_, itemIndex) => itemIndex !== index))} type="button"><Trash2 className="size-4 text-danger" /></button></div>)}<Button onClick={() => { let index = options.length + 1; let key = `option_${index}`; while (options.some((option) => option.key === key)) key = `option_${++index}`; update([...options, { key, label: "New option" }]); }} type="button" variant="secondary"><Plus className="size-4" />Add decision option</Button></section>;
}

function DynamicDecisionCondition({ condition, decisions, updateSla }: { condition: Extract<FmsSlaRule["conditional"], { decisionStageKey: string }>; decisions: readonly FmsStageDefinition[]; updateSla: (patch: Partial<FmsSlaRule>) => void }) {
  const selected = decisions.find((item) => item.key === condition.decisionStageKey) ?? decisions[0];
  const optionKey = "decisionOptionKey" in condition ? condition.decisionOptionKey : condition.outcome;
  return <><Field label="Earlier decision"><select aria-label="Earlier decision" className="field" onChange={(event) => { const next = decisions.find((item) => item.key === event.target.value); updateSla({ conditional: { decisionStageKey: event.target.value, decisionOptionKey: next?.sla.decisionOptions?.[0]?.key ?? "" } }); }} value={selected?.key ?? ""}>{decisions.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></Field><Field label="Run when answer is"><select aria-label="Run when answer is" className="field" onChange={(event) => updateSla({ conditional: { decisionStageKey: selected?.key ?? "", decisionOptionKey: event.target.value } })} value={optionKey}>{selected?.sla.decisionOptions?.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></Field></>;
}
