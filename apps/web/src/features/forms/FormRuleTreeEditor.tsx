import { describeFormRule, formAnswerOptions, FORM_LIST_OPERATORS, FORM_OPERATOR_LABELS, FORM_RULE_MAX_DEPTH, FORM_RULE_MAX_PREDICATES, FORM_VALUELESS_OPERATORS, operatorsForFieldType, type FormAnswer, type FormFieldDefinition, type FormOption, type FormRule, type FormRuleOperator, type FormRulePredicate } from "@jewelos/core";
import { Button, Field } from "@/components/ui";
import { toFormMasterOptions, type MasterOption } from "@/features/dropdowns/api";
import type { DynamicOptions } from "./FormRenderer";

export type FormRuleTreeEditorProps = { rule: FormRule | undefined; sources: readonly FormFieldDefinition[]; dynamicOptions: DynamicOptions; masterOptions: MasterOption[]; hideNegation?: boolean; onChange: (rule: FormRule | undefined) => void };
const NUMBER_TYPES = new Set(["number", "currency", "rating"]);

function countPredicates(rule: FormRule | undefined): number {
  return !rule ? 0 : rule.kind === "predicate" ? 1 : rule.rules.reduce((total, child) => total + countPredicates(child), 0);
}
function optionsFor(source: FormFieldDefinition, props: FormRuleTreeEditorProps): readonly FormOption[] | null {
  return formAnswerOptions(source, { ...props.dynamicOptions, masters: toFormMasterOptions(props.masterOptions) });
}
export function defaultFormRulePredicate(source: FormFieldDefinition, options: readonly FormOption[] | null): FormRulePredicate {
  const operator = operatorsForFieldType(source.type)[0] ?? "equals";
  if (FORM_VALUELESS_OPERATORS.has(operator)) return { kind: "predicate", fieldKey: source.key, operator };
  if (FORM_LIST_OPERATORS.has(operator)) return { kind: "predicate", fieldKey: source.key, operator, value: options?.[0] ? [options[0].value] : [] };
  if (source.type === "checkbox" && !source.options?.length && !source.optionSource) return { kind: "predicate", fieldKey: source.key, operator, value: true };
  return { kind: "predicate", fieldKey: source.key, operator, value: options?.[0]?.value ?? "" };
}
function withOperator(predicate: FormRulePredicate, operator: FormRuleOperator): FormRulePredicate {
  if (FORM_VALUELESS_OPERATORS.has(operator)) return { ...predicate, operator, value: undefined };
  const value = predicate.value;
  if (FORM_LIST_OPERATORS.has(operator)) return { ...predicate, operator, value: Array.isArray(value) ? value : value === undefined || value === "" ? [] : [value] };
  return { ...predicate, operator, value: Array.isArray(value) ? value[0] ?? "" : value ?? "" };
}

/** Edits the canonical FormRule tree. Limits mirror the existing server/core contract. */
export function FormRuleTreeEditor(props: FormRuleTreeEditorProps) {
  const { rule, sources, onChange } = props;
  const count = countPredicates(rule);
  const canAdd = sources.length > 0 && count < FORM_RULE_MAX_PREDICATES;
  const newPredicate = () => sources[0] ? defaultFormRulePredicate(sources[0], optionsFor(sources[0], props)) : undefined;
  const update = (node: FormRule, path: readonly number[], next: FormRule | undefined): FormRule | undefined => {
    if (!path.length) return next;
    if (node.kind === "predicate") return node;
    const rules = node.rules.flatMap((child, index) => { const result = index === path[0] ? update(child, path.slice(1), next) : child; return result ? [result] : []; });
    return rules.length ? { ...node, rules } : undefined;
  };
  const write = (path: readonly number[], next: FormRule | undefined) => onChange(rule ? update(rule, path, next) : next);
  const renderNode = (node: FormRule, path: readonly number[], depth: number) => {
    const group = node.kind !== "predicate";
    const addGroup = (kind: "all" | "any") => {
      const fresh = newPredicate();
      if (!fresh) return;
      write(path, node.kind === "predicate" ? { kind, rules: [node, fresh] } : { ...node, rules: [...node.rules, { kind, rules: [fresh] }] });
    };
    return <div className="min-w-0 space-y-2 rounded-lg border border-gold/20 bg-obsidian/30 p-2 sm:p-3" key={path.join(".") || "root"}>
      {node.kind === "predicate" ? <PredicateRow {...props} predicate={node} onPatch={next => write(path, next)} /> : <>
        <label className="flex flex-wrap items-center gap-2 text-xs text-champagne">Match<select aria-label="Match all or any condition" className="field min-h-11 w-auto" value={node.kind} onChange={event => write(path, { ...node, kind: event.target.value === "any" ? "any" : "all" })}><option value="all">All conditions (AND)</option><option value="any">Any condition (OR)</option></select></label>
        {node.rules.map((child, index) => <div className="min-w-0 space-y-2" key={index}>
          {renderNode(child, [...path, index], depth + 1)}
          <div className="flex flex-wrap gap-2">
            <Button aria-label="Move condition up" className="min-h-11" disabled={index === 0} type="button" variant="secondary" onClick={() => { const rules = [...node.rules]; [rules[index - 1], rules[index]] = [rules[index]!, rules[index - 1]!]; write(path, { ...node, rules }); }}>Up</Button>
            <Button aria-label="Move condition down" className="min-h-11" disabled={index === node.rules.length - 1} type="button" variant="secondary" onClick={() => { const rules = [...node.rules]; [rules[index], rules[index + 1]] = [rules[index + 1]!, rules[index]!]; write(path, { ...node, rules }); }}>Down</Button>
            <Button aria-label="Duplicate condition" className="min-h-11" disabled={count + countPredicates(child) > FORM_RULE_MAX_PREDICATES} type="button" variant="secondary" onClick={() => write(path, { ...node, rules: [...node.rules.slice(0, index + 1), child, ...node.rules.slice(index + 1)] })}>Duplicate</Button>
            <Button aria-label="Remove condition" className="min-h-11" type="button" variant="danger" onClick={() => write([...path, index], undefined)}>Remove</Button>
          </div>
        </div>)}
      </>}
      {(group || path.length === 0) && depth < FORM_RULE_MAX_DEPTH ? <div className="flex flex-wrap gap-2">
        {node.kind === "predicate" && path.length === 0 ? <Button aria-label="Duplicate condition" className="min-h-11" disabled={!canAdd} type="button" variant="secondary" onClick={() => write(path, { kind: "all", rules: [node, node] })}>Duplicate condition</Button> : null}
        <Button className="min-h-11" disabled={!canAdd} type="button" variant="secondary" onClick={() => { const fresh = newPredicate(); if (fresh) write(path, node.kind === "predicate" ? { kind: "all", rules: [node, fresh] } : { ...node, rules: [...node.rules, fresh] }); }}>Add condition</Button>
        <Button className="min-h-11" disabled={!canAdd || (group && depth + 2 > FORM_RULE_MAX_DEPTH)} type="button" variant="secondary" onClick={() => addGroup("all")}>Add AND group</Button>
        <Button className="min-h-11" disabled={!canAdd || (group && depth + 2 > FORM_RULE_MAX_DEPTH)} type="button" variant="secondary" onClick={() => addGroup("any")}>Add OR group</Button>
      </div> : null}
    </div>;
  };
  const description = describeFormRule(rule, key => sources.find(source => source.key === key)?.label || key);
  return <div className="min-w-0 space-y-2">
    {rule ? <>{renderNode(rule, [], 1)}{!props.hideNegation ? <label className="flex min-h-11 items-center gap-2 text-sm text-champagne"><input checked={rule.negate === true} onChange={event => onChange({ ...rule, negate: event.target.checked || undefined })} type="checkbox" />Invert this condition</label> : null}<p className="break-words text-xs text-soft-grey">{rule.negate ? "Unless: " : "When: "}{description}</p><Button className="min-h-11" onClick={() => onChange(undefined)} type="button" variant="secondary">Clear conditions</Button></> : <Button className="min-h-11" disabled={!canAdd} onClick={() => onChange(newPredicate())} type="button" variant="secondary">Add condition</Button>}
    {!sources.length ? <p className="text-xs text-soft-grey">No available questions to use in a condition.</p> : null}
    {count >= FORM_RULE_MAX_PREDICATES ? <p className="text-xs text-soft-grey">Maximum {FORM_RULE_MAX_PREDICATES} conditions reached.</p> : null}
  </div>;
}

function PredicateRow(props: FormRuleTreeEditorProps & { predicate: FormRulePredicate; onPatch: (rule: FormRulePredicate) => void }) {
  const { predicate, sources, onPatch } = props;
  const source = sources.find(item => item.key === predicate.fieldKey);
  const options = source ? optionsFor(source, props) : null;
  const operators = source ? operatorsForFieldType(source.type) : [predicate.operator];
  return <div className="grid min-w-0 gap-2 sm:grid-cols-2">
    <Field label="Question"><select aria-label="Condition question" className="field min-w-0" value={predicate.fieldKey} onChange={event => { const next = sources.find(item => item.key === event.target.value); if (next) onPatch(defaultFormRulePredicate(next, optionsFor(next, props))); }}>{!source ? <option value={predicate.fieldKey}>Unavailable question: {predicate.fieldKey}</option> : null}{sources.map(item => <option key={item.key} value={item.key}>{item.label || item.key}</option>)}</select></Field>
    <Field label="Condition"><select aria-label="Condition operator" className="field min-w-0" value={predicate.operator} onChange={event => { const operator = operators.find(item => item === event.target.value); if (operator) onPatch(withOperator(predicate, operator)); }}>{operators.map(operator => <option key={operator} value={operator}>{FORM_OPERATOR_LABELS[operator]}</option>)}</select></Field>
    {!FORM_VALUELESS_OPERATORS.has(predicate.operator) ? <div className="min-w-0 sm:col-span-2"><PredicateValue predicate={predicate} source={source} options={options} onChange={value => onPatch({ ...predicate, value })} /></div> : null}
  </div>;
}

function PredicateValue({ predicate, source, options, onChange }: { predicate: FormRulePredicate; source: FormFieldDefinition | undefined; options: readonly FormOption[] | null; onChange: (value: FormAnswer | readonly FormAnswer[]) => void }) {
  const list = FORM_LIST_OPERATORS.has(predicate.operator);
  const selected = (Array.isArray(predicate.value) ? predicate.value : []).map(String);
  const current = predicate.value === undefined || Array.isArray(predicate.value) ? "" : String(predicate.value);
  const legacyCheckbox = source?.type === "checkbox" && !source.options?.length && !source.optionSource;
  if (list && options) {
    const removed = selected.filter(value => !options.some(option => option.value === value)).map(value => ({ value, label: `${value} (removed)` }));
    return <fieldset className="grid gap-2"><legend className="mb-2 text-xs text-soft-grey">Selected answers</legend>{[...options, ...removed].map(option => <label className="flex min-h-11 min-w-0 items-center gap-2 break-words text-sm text-champagne" key={option.value}><input checked={selected.includes(option.value)} onChange={event => onChange(event.target.checked ? [...selected, option.value] : selected.filter(value => value !== option.value))} type="checkbox" />{option.label}</label>)}</fieldset>;
  }
  if (list) return <Field label="Answers"><input className="field" onChange={event => onChange(event.target.value.split(",").map(value => value.trim()).filter(Boolean))} placeholder="Comma separated answers" value={selected.join(", ")} /></Field>;
  if (options) return <Field label="Answer"><select aria-label="Condition answer" className="field" value={current} onChange={event => onChange(legacyCheckbox ? event.target.value === "true" : event.target.value)}><option value="">Choose an answer</option>{current && !options.some(option => option.value === current) ? <option value={current}>{current} (removed)</option> : null}{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></Field>;
  const numeric = source && NUMBER_TYPES.has(source.type);
  return <Field label="Answer"><input aria-label="Condition answer" className="field" type={numeric ? "number" : source?.type === "datetime" ? "datetime-local" : source?.type === "date" ? "date" : "text"} step={numeric ? "any" : undefined} value={current} onChange={event => onChange(numeric && event.target.value !== "" ? Number(event.target.value) : event.target.value)} /></Field>;
}
