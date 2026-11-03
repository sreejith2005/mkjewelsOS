import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FlaskConical, Plus, Trash2 } from "lucide-react";
import {
  FMS_TRIGGER_OPERATOR_LABELS, FMS_TRIGGER_SOURCES, fmsTriggerFieldTypeForQuestion, fmsTriggerOperatorsFor, fmsTriggerSource,
  newFmsStartTrigger, validateFmsStartTrigger,
  type FmsFlowDefinition, type FmsStartMode, type FmsStartTrigger, type FmsTriggerField, type FmsTriggerGroup, type FmsTriggerNode,
  type FmsTriggerOperator, type FmsTriggerRule, type FmsTriggerSourceType,
} from "@jewelos/core";
import { Button, Modal, Notice } from "@/components/ui";
import type { FmsData } from "./api";
import { listFmsTriggerSamples, testFmsStartTrigger, type FmsTriggerSample, type FmsTriggerTestResult } from "./triggerApi";

const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);

/** Newest published version of each Form family, for the source picker. */
export function latestFormVersions(forms: FmsData["forms"]): FmsData["forms"] {
  const best = new Map<string, FmsData["forms"][number]>();
  for (const form of forms) if (form.lifecycle === "published" && (!best.get(form.family_id) || best.get(form.family_id)!.version < form.version)) best.set(form.family_id, form);
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every field a trigger can read: the source's fixed fields plus, for form sources, the questions of
 * the newest published version (phone numbers and files are never offered).
 */
export function fmsTriggerFields(trigger: FmsStartTrigger | undefined, data: FmsData): readonly FmsTriggerField[] {
  if (!trigger) return [];
  const source = fmsTriggerSource(trigger.source.type);
  const fixed = source?.fields ?? [];
  if (trigger.source.type !== "jewelos_form" && trigger.source.type !== "crm_linked_form") return fixed;
  const form = latestFormVersions(data.forms).find((item) => item.family_id === trigger.source.formFamilyId);
  const questions = form ? data.formFields[form.id] ?? [] : [];
  const taken = new Set(fixed.map((field) => field.key));
  return [...questions.flatMap((question): FmsTriggerField[] => {
    const options = question.options ?? (question.optionValues ?? []).map((value) => ({ value, label: value }));
    const type = fmsTriggerFieldTypeForQuestion(question.type, options.length > 0);
    return type && !taken.has(question.key) ? [{ key: question.key, label: question.label, type, ...(options.length ? { options } : {}) }] : [];
  }), ...fixed];
}

const MODES: ReadonlyArray<Readonly<{ mode: FmsStartMode; title: string; body: string }>> = [
  { mode: "form", title: "Start with Form", body: "Someone fills the starting form; submitting it starts the workflow. This is how existing workflows work." },
  { mode: "automatic", title: "Automatic Trigger", body: "A saved form or CRM entry starts the workflow when your conditions match. No starting form." },
  { mode: "manual", title: "Manual Start Without Form", body: "An authorized person starts it from the FMS list with a title and a short note." },
];

type Props = Readonly<{
  definition: FmsFlowDefinition;
  data: FmsData;
  flowId: string | null;
  onApply: (next: Readonly<{ startMode: FmsStartMode; startTrigger: FmsStartTrigger | undefined }>) => void;
  onClose: () => void;
}>;

export function FmsStartTriggerPanel({ definition, data, flowId, onApply, onClose }: Props) {
  const [mode, setMode] = useState<FmsStartMode>(definition.startMode ?? "form");
  const [trigger, setTrigger] = useState<FmsStartTrigger>(() => definition.startTrigger ?? newFmsStartTrigger("crm_walkin", newId));
  const fields = useMemo(() => fmsTriggerFields(trigger, data), [trigger, data]);
  const issues = mode === "automatic" ? validateFmsStartTrigger(trigger, fields, definition.stages[0]?.type) : [];
  const forms = useMemo(() => latestFormVersions(data.forms), [data.forms]);
  const changeSource = (type: FmsTriggerSourceType) => setTrigger(newFmsStartTrigger(type, newId));
  const firstIsStartForm = (definition.startMode ?? "form") === "form" && definition.stages[0]?.type === "form";
  return <Modal mobileFullscreen onClose={onClose} title="Start trigger" wide>
    <div className="space-y-5" data-testid="fms-start-trigger">
      <fieldset className="space-y-2">
        <legend className="label">How does this workflow start?</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {MODES.map((item) => <label className={`flex min-h-11 cursor-pointer gap-3 rounded-xl border p-3 text-sm ${mode === item.mode ? "border-gold bg-gold/10" : "border-gold/20"}`} key={item.mode}>
            <input checked={mode === item.mode} className="mt-1" name="fms-start-mode" onChange={() => setMode(item.mode)} type="radio" />
            <span><b className="block text-white">{item.title}</b><span className="text-xs text-soft-grey">{item.body}</span></span>
          </label>)}
        </div>
        {mode !== "form" && firstIsStartForm ? <Notice>The current first step is a Form. Without a starting form it becomes an ordinary step that someone is assigned to fill. Give it an assignee in its settings.</Notice> : null}
      </fieldset>

      {mode === "automatic" ? <>
        <section className="space-y-3 rounded-2xl border border-gold/20 p-4">
          <h4 className="font-semibold text-white">When</h4>
          <label className="block"><span className="label">Source</span>
            <select aria-label="Trigger source" className="field" onChange={(event) => changeSource(event.target.value as FmsTriggerSourceType)} value={trigger.source.type}>
              {FMS_TRIGGER_SOURCES.map((source) => <option key={source.type} value={source.type}>{source.label}</option>)}
            </select>
          </label>
          {trigger.source.type === "jewelos_form" || trigger.source.type === "crm_linked_form" ? <label className="block"><span className="label">Form</span>
            <select aria-label="Trigger form" className="field" onChange={(event) => { const form = forms.find((item) => item.family_id === event.target.value); setTrigger({ ...trigger, source: { ...trigger.source, formFamilyId: event.target.value || undefined, formTemplateId: form?.id } }); }} value={trigger.source.formFamilyId ?? ""}>
              <option value="">Choose a published form</option>
              {forms.map((form) => <option key={form.family_id} value={form.family_id}>{form.name} (v{form.version})</option>)}
            </select>
          </label> : null}
          {trigger.source.type === "crm_linked_form" ? <label className="block"><span className="label">Linked to</span>
            <select aria-label="CRM form purpose" className="field" onChange={(event) => setTrigger({ ...trigger, source: { ...trigger.source, purpose: event.target.value === "lead" ? "lead" : event.target.value === "queue" ? "queue" : undefined } })} value={trigger.source.purpose ?? ""}>
              <option value="">Choose</option><option value="queue">Client queue registration</option><option value="lead">Lead registration</option>
            </select>
          </label> : null}
          <p className="text-xs text-soft-grey">{fmsTriggerSource(trigger.source.type)?.event}. Only submissions saved after you publish can start this workflow.</p>
        </section>

        <section className="space-y-3 rounded-2xl border border-gold/20 p-4">
          <h4 className="font-semibold text-white">If</h4>
          <GroupEditor data={data} depth={0} fields={fields} group={trigger.conditions} onChange={(conditions) => setTrigger({ ...trigger, conditions })} />
        </section>

        <section className="space-y-3 rounded-2xl border border-gold/20 p-4">
          <h4 className="font-semibold text-white">Then start this workflow</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block"><span className="label">Run title</span><input aria-label="Run title prefix" className="field" maxLength={120} onChange={(event) => setTrigger({ ...trigger, title: { ...trigger.title, prefix: event.target.value || undefined } })} placeholder={definition.name || "Workflow name"} value={trigger.title?.prefix ?? ""} /></label>
            <label className="block"><span className="label">Add to the title</span><FieldSelect ariaLabel="Run title field" fields={fields} onChange={(field) => setTrigger({ ...trigger, title: { ...trigger.title, field } })} value={trigger.title?.field} /></label>
            <label className="block"><span className="label">First step goes to</span>
              <select aria-label="First step assignee" className="field" onChange={(event) => setTrigger({ ...trigger, assignment: { ...trigger.assignment, mode: event.target.value === "source_staff" ? "source_staff" : "stage_rules" } })} value={trigger.assignment.mode}>
                <option value="stage_rules">The first step's own assignee</option>
                <option value="source_staff">{trigger.source.type === "jewelos_form" ? "The person who submitted the form" : "The CRM salesperson of this entry"}</option>
              </select>
            </label>
            {trigger.assignment.mode === "source_staff" ? <label className="block"><span className="label">If that person is not an active JewelOS user</span>
              <select aria-label="When the person is not found" className="field" onChange={(event) => setTrigger({ ...trigger, assignment: { ...trigger.assignment, onUnresolved: event.target.value === "stage_rules" ? "stage_rules" : "review" } })} value={trigger.assignment.onUnresolved}>
                <option value="review">Hold it for review in Trigger history</option><option value="stage_rules">Use the first step's own assignee</option>
              </select>
            </label> : null}
            <label className="block"><span className="label">First deadline from</span><FieldSelect ariaLabel="Deadline field" emptyLabel="The first step's own timing" fields={fields.filter((field) => field.type === "date")} onChange={(dueField) => setTrigger({ ...trigger, dueField })} value={trigger.dueField} /></label>
            <label className="block"><span className="label">Repeat submissions</span>
              <select aria-label="Repeat submissions" className="field" onChange={(event) => setTrigger({ ...trigger, reentry: event.target.value === "one_per_event" ? "one_per_event" : "one_active_per_case" })} value={trigger.reentry}>
                <option value="one_active_per_case">{fmsTriggerSource(trigger.source.type)?.supportsCase ? "One open run per Not Bought case (or client)" : "One open run per client or record"}</option>
                <option value="one_per_event">A new run for every matching submission</option>
              </select>
            </label>
            {trigger.source.type === "crm_walkin" ? <label className="block"><span className="label">When the CRM closes the follow-up case</span>
              <select aria-label="When the case closes" className="field" onChange={(event) => setTrigger({ ...trigger, onCaseClosed: event.target.value === "cancel_run" ? "cancel_run" : "record_only" })} value={trigger.onCaseClosed}>
                <option value="record_only">Note it on the open run (work continues)</option><option value="cancel_run">Cancel the open run</option>
              </select>
            </label> : null}
          </div>
          <MappingEditor fields={fields} onChange={(mapping) => setTrigger({ ...trigger, mapping })} trigger={trigger} />
        </section>

        <TriggerTest definition={definition} fields={fields} flowId={flowId} trigger={trigger} />
        {issues.length ? <Notice tone="danger"><ul className="list-disc space-y-1 pl-4">{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></Notice> : null}
      </> : null}

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gold/15 bg-obsidian pt-3">
        <Button onClick={onClose} variant="ghost">Cancel</Button>
        <Button onClick={() => { onApply({ startMode: mode, startTrigger: mode === "automatic" ? trigger : undefined }); onClose(); }}>Use these start settings</Button>
      </div>
    </div>
  </Modal>;
}

function FieldSelect({ fields, value, onChange, ariaLabel, emptyLabel = "Nothing" }: Readonly<{ fields: readonly FmsTriggerField[]; value: string | undefined; onChange: (value: string | undefined) => void; ariaLabel: string; emptyLabel?: string }>) {
  return <select aria-label={ariaLabel} className="field" onChange={(event) => onChange(event.target.value || undefined)} value={value ?? ""}>
    <option value="">{emptyLabel}</option>
    {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
    {value && !fields.some((field) => field.key === value) ? <option value={value}>{value} (no longer available)</option> : null}
  </select>;
}

function GroupEditor({ group, fields, data, depth, onChange, onRemove, onMove }: Readonly<{ group: FmsTriggerGroup; fields: readonly FmsTriggerField[]; data: FmsData; depth: number; onChange: (group: FmsTriggerGroup) => void; onRemove?: (() => void) | undefined; onMove?: ((by: -1 | 1) => void) | undefined }>) {
  const setChild = (index: number, child: FmsTriggerNode) => onChange({ ...group, children: group.children.map((item, at) => at === index ? child : item) });
  const removeChild = (index: number) => onChange({ ...group, children: group.children.filter((_, at) => at !== index) });
  const moveChild = (index: number, by: -1 | 1) => { const target = index + by; if (target < 0 || target >= group.children.length) return; const children = [...group.children]; [children[index], children[target]] = [children[target]!, children[index]!]; onChange({ ...group, children }); };
  const first = fields[0];
  const addRule = () => onChange({ ...group, children: [...group.children, { id: newId(), kind: "rule", field: first?.key ?? "", operator: first ? fmsTriggerOperatorsFor(first.type)[0]! : "equals", enabled: true }] });
  const addGroup = () => onChange({ ...group, children: [...group.children, { id: newId(), kind: "group", combinator: group.combinator === "and" ? "or" : "and", enabled: true, children: [] }] });
  return <div className={`space-y-2 ${depth ? "rounded-xl border border-gold/15 bg-charcoal/50 p-3" : ""}`} data-testid="trigger-group">
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Match" className="field w-auto" onChange={(event) => onChange({ ...group, combinator: event.target.value === "or" ? "or" : "and" })} value={group.combinator}>
        <option value="and">All of these (AND)</option><option value="or">Any of these (OR)</option>
      </select>
      {depth ? <label className="flex min-h-11 items-center gap-2 text-xs text-soft-grey"><input checked={group.enabled} onChange={(event) => onChange({ ...group, enabled: event.target.checked })} type="checkbox" />On</label> : null}
      {onMove ? <><Button aria-label="Move group up" className="px-2" onClick={() => onMove(-1)} variant="ghost"><ArrowUp className="size-4" /></Button><Button aria-label="Move group down" className="px-2" onClick={() => onMove(1)} variant="ghost"><ArrowDown className="size-4" /></Button></> : null}
      {onRemove ? <Button aria-label="Remove group" className="ml-auto px-2" onClick={onRemove} variant="ghost"><Trash2 className="size-4" /></Button> : null}
    </div>
    {group.children.map((child, index) => child.kind === "group"
      ? <GroupEditor data={data} depth={depth + 1} fields={fields} group={child} key={child.id} onChange={(next) => setChild(index, next)} onMove={(by) => moveChild(index, by)} onRemove={() => removeChild(index)} />
      : <RuleEditor data={data} fields={fields} key={child.id} onChange={(next) => setChild(index, next)} onMove={(by) => moveChild(index, by)} onRemove={() => removeChild(index)} rule={child} />)}
    {!group.children.length ? <p className="text-xs text-soft-grey">No conditions in this group yet.</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button onClick={addRule} variant="secondary"><Plus className="size-4" />Add condition</Button>
      {depth < 3 ? <Button onClick={addGroup} variant="ghost"><Plus className="size-4" />Add group</Button> : null}
    </div>
  </div>;
}

function RuleEditor({ rule, fields, data, onChange, onRemove, onMove }: Readonly<{ rule: FmsTriggerRule; fields: readonly FmsTriggerField[]; data: FmsData; onChange: (rule: FmsTriggerRule) => void; onRemove: () => void; onMove: (by: -1 | 1) => void }>) {
  const field = fields.find((item) => item.key === rule.field);
  const operators = field ? fmsTriggerOperatorsFor(field.type) : [rule.operator];
  const valueless = rule.operator === "is_empty" || rule.operator === "not_empty";
  return <div className={`grid gap-2 rounded-xl border p-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] ${rule.enabled ? "border-gold/20" : "border-gold/10 opacity-60"}`} data-testid="trigger-rule">
    <select aria-label="Condition field" className="field" onChange={(event) => { const next = fields.find((item) => item.key === event.target.value); onChange({ ...rule, field: event.target.value, operator: next ? fmsTriggerOperatorsFor(next.type)[0]! : rule.operator, value: undefined }); }} value={rule.field}>
      {!field ? <option value={rule.field}>{rule.field || "Choose a field"} (not available)</option> : null}
      {fields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
    </select>
    <select aria-label="Condition operator" className="field" onChange={(event) => onChange({ ...rule, operator: event.target.value as FmsTriggerOperator, value: event.target.value === "in" ? [] : undefined })} value={rule.operator}>
      {operators.map((operator) => <option key={operator} value={operator}>{FMS_TRIGGER_OPERATOR_LABELS[operator]}</option>)}
    </select>
    {valueless ? <span className="hidden md:block" /> : <ValueInput data={data} field={field} onChange={(value) => onChange({ ...rule, value })} operator={rule.operator} value={rule.value} />}
    <div className="flex items-center gap-1">
      <label className="flex min-h-11 items-center gap-1 px-1 text-xs text-soft-grey"><input checked={rule.enabled} onChange={(event) => onChange({ ...rule, enabled: event.target.checked })} type="checkbox" />On</label>
      <Button aria-label="Move condition up" className="px-2" onClick={() => onMove(-1)} variant="ghost"><ArrowUp className="size-4" /></Button>
      <Button aria-label="Move condition down" className="px-2" onClick={() => onMove(1)} variant="ghost"><ArrowDown className="size-4" /></Button>
      <Button aria-label="Remove condition" className="px-2" onClick={onRemove} variant="ghost"><Trash2 className="size-4" /></Button>
    </div>
  </div>;
}

function ValueInput({ field, operator, value, data, onChange }: Readonly<{ field: FmsTriggerField | undefined; operator: FmsTriggerOperator; value: FmsTriggerRule["value"]; data: FmsData; onChange: (value: FmsTriggerRule["value"]) => void }>) {
  const options = field?.type === "branch" ? data.branches.map((branch) => ({ value: branch.id, label: branch.name }))
    : field?.type === "user" ? data.users.filter((user) => user.working_status === "active").map((user) => ({ value: user.id, label: user.employee_name }))
    : field?.options ?? [];
  if (operator === "in" && options.length) {
    const chosen = Array.isArray(value) ? value.map(String) : [];
    return <div aria-label="Condition values" className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-gold/15 p-2" role="group">
      {options.map((option) => <label className="flex items-center gap-2 text-xs text-white" key={option.value}><input checked={chosen.includes(option.value)} onChange={(event) => onChange(event.target.checked ? [...chosen, option.value] : chosen.filter((item) => item !== option.value))} type="checkbox" />{option.label}</label>)}
    </div>;
  }
  if (options.length && field?.type !== "multi_choice") return <select aria-label="Condition value" className="field" onChange={(event) => onChange(event.target.value || undefined)} value={typeof value === "string" ? value : ""}>
    <option value="">Choose</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
  if (field?.type === "boolean") return <select aria-label="Condition value" className="field" onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")} value={value === undefined ? "" : String(value)}>
    <option value="">Choose</option><option value="true">Yes</option><option value="false">No</option>
  </select>;
  if (field?.type === "date") return <div className="flex items-center gap-2">
    <input aria-label="Condition value" className="field" disabled={value === "today"} onChange={(event) => onChange(event.target.value || undefined)} type="date" value={typeof value === "string" && value !== "today" ? value : ""} />
    <label className="flex shrink-0 items-center gap-1 text-xs text-soft-grey"><input checked={value === "today"} onChange={(event) => onChange(event.target.checked ? "today" : undefined)} type="checkbox" />Today</label>
  </div>;
  if (operator === "in") return <input aria-label="Condition values" className="field" onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="Comma-separated values" value={Array.isArray(value) ? value.join(", ") : ""} />;
  return <input aria-label="Condition value" className="field" inputMode={field?.type === "number" ? "decimal" : undefined} onChange={(event) => onChange(event.target.value === "" ? undefined : field?.type === "number" ? Number(event.target.value) : event.target.value)} type={field?.type === "number" ? "number" : "text"} value={value === undefined || Array.isArray(value) ? "" : String(value)} />;
}

function MappingEditor({ trigger, fields, onChange }: Readonly<{ trigger: FmsStartTrigger; fields: readonly FmsTriggerField[]; onChange: (mapping: FmsStartTrigger["mapping"]) => void }>) {
  const keyFor = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "v_$1").slice(0, 40) || "value";
  const set = (index: number, change: Partial<FmsStartTrigger["mapping"][number]>) => onChange(trigger.mapping.map((item, at) => at === index ? { ...item, ...change } : item));
  return <div className="space-y-2">
    <p className="label">Copy into the workflow</p>
    <p className="text-xs text-soft-grey">These values appear on the work page for everyone who works on the run. Phone numbers are never copied; CRM users open the client profile for contact details.</p>
    {trigger.mapping.map((item, index) => <div className="grid gap-2 rounded-xl border border-gold/15 p-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" key={`${item.key}-${index}`}>
      <input aria-label="Copied value label" className="field" maxLength={80} onChange={(event) => set(index, { label: event.target.value, key: keyFor(event.target.value) })} placeholder="Label" value={item.label} />
      <select aria-label="Copied value source" className="field" onChange={(event) => set(index, event.target.value === "__fixed" ? { field: undefined, fixed: item.fixed ?? "" } : { field: event.target.value, fixed: undefined })} value={item.field ?? "__fixed"}>
        {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
        <option value="__fixed">A fixed value</option>
      </select>
      {item.field ? <input aria-label="Copied value fallback" className="field" maxLength={200} onChange={(event) => set(index, { fallback: event.target.value || undefined })} placeholder="If blank, use…" value={item.fallback ?? ""} />
        : <input aria-label="Copied fixed value" className="field" maxLength={200} onChange={(event) => set(index, { fixed: event.target.value })} placeholder="Fixed value" value={item.fixed ?? ""} />}
      <Button aria-label="Remove copied value" className="px-2" onClick={() => onChange(trigger.mapping.filter((_, at) => at !== index))} variant="ghost"><Trash2 className="size-4" /></Button>
    </div>)}
    <Button disabled={trigger.mapping.length >= 20 || !fields.length} onClick={() => { const field = fields[0]!; onChange([...trigger.mapping, { key: keyFor(field.label), label: field.label, field: field.key }]); }} variant="secondary"><Plus className="size-4" />Copy a value</Button>
  </div>;
}

function usedFields(node: FmsTriggerNode, out = new Set<string>()): Set<string> {
  if (node.kind === "rule") out.add(node.field); else node.children.forEach((child) => usedFields(child, out));
  return out;
}

function TriggerTest({ trigger, fields, definition, flowId }: Readonly<{ trigger: FmsStartTrigger; fields: readonly FmsTriggerField[]; definition: FmsFlowDefinition; flowId: string | null }>) {
  const [answers, setAnswersState] = useState<Record<string, unknown>>({});
  // The latest answers, so "Test conditions" never sends a value one keystroke behind.
  const answersRef = useRef(answers);
  const setAnswers = (update: (current: Record<string, unknown>) => Record<string, unknown>) => setAnswersState((current) => { const next = update(current); answersRef.current = next; return next; });
  const [samples, setSamples] = useState<readonly FmsTriggerSample[] | null>(null);
  const [result, setResult] = useState<FmsTriggerTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = [...usedFields(trigger.conditions, new Set(trigger.mapping.flatMap((item) => item.field ? [item.field] : [])))];
  if (trigger.dueField) keys.push(trigger.dueField);
  const shown = fields.filter((field) => keys.includes(field.key));
  const run = async () => {
    if (!flowId) { setError("Save the draft once before testing."); return; }
    setBusy(true); setError(null);
    try { setResult(await testFmsStartTrigger(flowId, trigger, answersRef.current)); } catch (caught) { setError(caught instanceof Error ? caught.message : "The test could not run"); } finally { setBusy(false); }
  };
  const loadSamples = async () => { setError(null); try { setSamples(await listFmsTriggerSamples(trigger.source)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load recent submissions"); } };
  const fieldLabel = (key: string) => fields.find((field) => field.key === key)?.label ?? key;
  return <section className="space-y-3 rounded-2xl border border-gold/20 p-4" data-testid="trigger-test">
    <div className="flex flex-wrap items-center gap-2"><h4 className="mr-auto font-semibold text-white">Test without creating work</h4><Button onClick={() => void loadSamples()} variant="ghost">Load a recent submission</Button></div>
    {samples ? samples.length ? <select aria-label="Recent submission" className="field" onChange={(event) => { const sample = samples.find((item) => item.id === event.target.value); if (sample) setAnswers(() => sample.answers); }} defaultValue="">
      <option value="">Choose a recent submission</option>{samples.map((sample) => <option key={sample.id} value={sample.id}>{sample.label} · {new Date(sample.at).toLocaleString()}</option>)}
    </select> : <p className="text-xs text-soft-grey">No recent submissions you can open. Enter sample values instead.</p> : null}
    <div className="grid gap-2 md:grid-cols-2">{shown.map((field) => <label className="block" key={field.key}><span className="label">{field.label}</span>
      <input aria-label={`Sample ${field.label}`} className="field" onChange={(event) => { const value = event.target.value; setAnswers((current) => ({ ...current, [field.key]: field.type === "multi_choice" ? value.split(",").map((item) => item.trim()).filter(Boolean) : field.type === "number" && value !== "" ? Number(value) : value })); }} placeholder={field.options?.length ? field.options.slice(0, 3).map((option) => option.value).join(" / ") : field.type === "date" ? "YYYY-MM-DD" : ""} value={Array.isArray(answers[field.key]) ? (answers[field.key] as unknown[]).join(", ") : String(answers[field.key] ?? "")} />
    </label>)}</div>
    <Button disabled={busy} onClick={() => void run()} variant="secondary"><FlaskConical className="size-4" />{busy ? "Testing..." : "Test conditions"}</Button>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {result ? <div className="space-y-2 rounded-xl border border-gold/20 bg-charcoal/60 p-3 text-sm" data-testid="trigger-test-result">
      <p className={result.matched ? "font-semibold text-success" : "font-semibold text-danger"}>{result.matched ? "Matched: this submission would start the workflow" : "Not matched: nothing would start"}</p>
      <ul className="space-y-1 text-xs">{result.rules.map((rule) => <li key={rule.id} className={rule.skipped ? "text-soft-grey" : rule.passed ? "text-success" : "text-danger"}>{rule.skipped ? "Off" : rule.passed ? "Passed" : "Failed"}: {fieldLabel(rule.field)} {FMS_TRIGGER_OPERATOR_LABELS[rule.operator]}</li>)}</ul>
      {result.matched ? <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-soft-grey">
        <dt>Run title</dt><dd className="text-white">{result.title}</dd>
        <dt>First step</dt><dd className="text-white">{result.firstStage?.name ?? definition.stages[0]?.name ?? "-"}</dd>
        <dt>Assigned to</dt><dd className="text-white">{result.assignee.method === "source_staff" ? result.assignee.name : result.assignee.method === "review" ? "Held for review (no active JewelOS user)" : "The first step's own assignee"}</dd>
        <dt>First deadline</dt><dd className="text-white">{result.dueAt ? new Date(result.dueAt).toLocaleString() : "The first step's own timing"}</dd>
        {Object.entries(result.context).map(([key, value]) => [<dt key={`${key}-k`}>{trigger.mapping.find((item) => item.key === key)?.label ?? key}</dt>, <dd className="text-white" key={`${key}-v`}>{value}</dd>])}
      </dl> : null}
    </div> : null}
  </section>;
}
