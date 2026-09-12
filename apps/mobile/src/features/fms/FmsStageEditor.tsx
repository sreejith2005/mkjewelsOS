import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react-native";
import {
  FMS_BRANCH_OPERATORS,
  fmsFieldOptions,
  hasFmsStageFallback,
  hasFmsStageRouting,
  type FmsBranchOperator,
  type FmsBranchRule,
  type FmsFormFieldRef,
  type FmsSlaRule,
  type FmsStageDefinition,
  type FmsTimingMethod,
} from "@jewelos/core";
import type { FmsData } from "@jewelos/data/fms/api";
import { newerFormVersion } from "@jewelos/data/fms/definition";
import { newRequestKey } from "@jewelos/data/runtime";
import { DateField } from "@/forms/DateField";
import { ToggleField } from "@/forms/ToggleField";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { OptionPicker } from "@/ui/OptionPicker";
import { Pressable } from "@/ui/Pressable";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** The web `FmsStageEditor`, section for section, with touch controls. */

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

const COMPLETE_HERE = "";
const timingMethod = (sla: FmsSlaRule): FmsTimingMethod => sla.timingMethod ?? "completion_date";

function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text tone="primary" variant="caption" weight="semibold">{title.toUpperCase()}</Text>
      {help ? <Text tone="muted" variant="caption">{help}</Text> : null}
      {children}
    </View>
  );
}

function Choice({ title, help, selected, disabled, onPress }: { title: string; help: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text weight="semibold" variant="small">{title}</Text>
      <Text tone="muted" variant="caption">{help}</Text>
    </Pressable>
  );
}

function IconButton({ label, disabled, onPress, children }: { label: string; disabled?: boolean; onPress: () => void; children: ReactNode }) {
  const styles = useStyles();
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} hitSlop={6} onPress={onPress} style={({ pressed }) => [styles.iconButton, disabled && styles.disabled, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

function StageSelect({ others, value, label, onChange }: { others: readonly FmsStageDefinition[]; value?: string | undefined; label: string; onChange: (value: string | undefined) => void }) {
  return (
    <OptionPicker
      label={label}
      onChange={(values) => onChange(values[0] || undefined)}
      options={[{ value: COMPLETE_HERE, label: "Complete workflow here" }, ...others.map((item) => ({ value: item.key, label: item.name }))]}
      selected={[value ?? COMPLETE_HERE]}
    />
  );
}

export function FmsStageEditor({ stage, stages, data, onChange, onDelete }: { stage: FmsStageDefinition; stages: readonly FmsStageDefinition[]; data: FmsData; onChange: (value: FmsStageDefinition) => void; onDelete: () => void }) {
  const styles = useStyles();
  const theme = useAppTheme();
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setShowConditional(!!stage.sla.conditional && "decisionStageKey" in stage.sla.conditional); }, [stage.key]);

  const changeBranchRule = (index: number, patch: Partial<FmsBranchRule>) => update({ branchRules: stage.branchRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule).map((rule, order) => ({ ...rule, order })) });
  const moveBranchRule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stage.branchRules.length) return;
    const rules = [...stage.branchRules];
    [rules[index], rules[target]] = [rules[target]!, rules[index]!];
    update({ branchRules: rules.map((rule, order) => ({ ...rule, order })) });
  };

  return (
    <View style={styles.editor}>
      <Section title="Step details">
        <TextField label="Step name" maxLength={150} onChangeText={(name) => update({ name })} placeholder="e.g. Issue PO to supplier" value={stage.name} />
      </Section>

      {human ? (
        <Section help="A normal step is completed once. A decision step records one configured outcome." title="Step type">
          <Choice help="Complete and continue" onPress={() => updateSla({ decisionMode: "normal", decisionOptions: undefined })} selected={!decision} title="Normal step (Done)" />
          <Choice disabled={firstStage} help="Choose a configured path when completing" onPress={() => updateSla({ decisionMode: "decision", decisionOptions: stage.sla.decisionOptions?.length ? stage.sla.decisionOptions : [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }] })} selected={decision} title="Decision step" />
          {decision ? <DecisionOptions options={stage.sla.decisionOptions ?? [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }]} update={(decisionOptions) => updateSla({ decisionMode: "decision", decisionOptions })} /> : null}
          {firstStage ? <Text tone="muted" variant="caption">The first step collects the initial form, so it remains a normal step.</Text> : null}
        </Section>
      ) : null}

      {human ? (
        <Section help={firstStage ? "The first step uses this form to collect the workflow’s initial details." : "Attach a Form the doer fills in when completing this step. Its answers can also drive the routing below."} title="Linked form">
          <LinkedForm data={data} firstStage={firstStage} stage={stage} update={update} />
        </Section>
      ) : null}

      {canChooseNext ? <StageRouting changeRule={changeBranchRule} decision={decision} fields={formFields} moveRule={moveBranchRule} others={others} stage={stage} update={update} /> : null}

      <Section help="Choose how this step’s deadline is calculated." title="When">
        {timingOptions.map((option) => <Choice help={option.help} key={option.value} onPress={() => updateSla({ timingMethod: option.value })} selected={timingMethod(stage.sla) === option.value} title={option.label} />)}
        <ToggleField disabled={false} label={`Set Deadline: ${stage.sla.deadlineEnabled !== false ? "ON" : "OFF"}`} onChange={(value) => updateSla({ deadlineEnabled: value })} required={false} value={stage.sla.deadlineEnabled !== false} />
        <TimingFields earlierStages={earlierStages} sla={stage.sla} updateSla={updateSla} />
      </Section>

      {human ? (
        <Section title="Instructions and controls">
          <TextField label={`How / instructions${stage.method ? "" : " (optional)"}`} multiline onChangeText={(method) => update({ method })} placeholder="e.g. Get WhatsApp PO confirmation" value={stage.method ?? ""} />
          <Text tone="muted" variant="label">Completion controls</Text>
          {optionCheckboxes.map(({ key, label }) => <ToggleField disabled={false} key={key} label={label} onChange={(value) => update({ [key]: value })} required={false} value={stage[key]} />)}
          <TextField autoCapitalize="none" label="Stable key (technical)" onChangeText={(value) => update({ key: value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} value={stage.key} />
        </Section>
      ) : null}

      {!firstStage && human ? (
        <Section title="Conditional step">
          <ToggleField
            disabled={!earlierDecisions.length}
            helperText={earlierDecisions.length ? "Run this step only for a selected outcome from an earlier Decision Step." : "Add an earlier Decision Step to define this condition."}
            label="Skip unless an earlier decision matches (optional)"
            onChange={(checked) => {
              const target = earlierDecisions.at(-1);
              setShowConditional(checked);
              updateSla({ conditional: checked && target ? { decisionStageKey: target.key, decisionOptionKey: target.sla.decisionOptions?.[0]?.key ?? "" } : undefined });
            }}
            required={false}
            value={showConditional && !!decisionCondition}
          />
          {showConditional && decisionCondition ? <DynamicDecisionCondition condition={decisionCondition} decisions={earlierDecisions} updateSla={updateSla} /> : null}
        </Section>
      ) : null}

      {stage.type === "branch" ? <BranchEditor changeRule={changeBranchRule} moveRule={moveBranchRule} others={others} stage={stage} update={update} /> : null}
      {stage.type === "parallel_start" ? (
        <Section title="Parallel paths">
          {others.map((item) => <ToggleField disabled={false} key={item.key} label={item.name} onChange={(checked) => update({ parallelTargetStageKeys: checked ? [...stage.parallelTargetStageKeys, item.key] : stage.parallelTargetStageKeys.filter((key) => key !== item.key) })} required={false} value={stage.parallelTargetStageKeys.includes(item.key)} />)}
        </Section>
      ) : null}
      {stage.type === "parallel_join" ? (
        <Section title="Join">
          <OptionPicker label="Join when" onChange={(values) => update({ joinRule: (values[0] ?? "all") as "all" | "any" | "specific" })} options={[{ value: "all", label: "All paths complete" }, { value: "any", label: "Any path completes" }, { value: "specific", label: "Specific paths complete" }]} selected={[stage.joinRule ?? "all"]} />
          {stage.joinRule === "specific" ? others.map((item) => <ToggleField disabled={false} key={item.key} label={item.name} onChange={(checked) => update({ joinRequiredStageKeys: checked ? [...stage.joinRequiredStageKeys, item.key] : stage.joinRequiredStageKeys.filter((key) => key !== item.key) })} required={false} value={stage.joinRequiredStageKeys.includes(item.key)} />) : null}
        </Section>
      ) : null}
      {!firstStage ? (
        <Button icon={<Trash2 color={theme.colors.danger} size={16} />} label="Delete step" onPress={onDelete} variant="danger" />
      ) : (
        <View style={styles.note}><Text tone="muted" variant="caption">This Form is the workflow trigger. It can be reconfigured but not removed.</Text></View>
      )}
    </View>
  );
}

/**
 * Outgoing routing for an ordinary step. With no rules the step keeps the
 * historical single successor; adding rules turns it into an ordered switch
 * whose fallback stays `defaultNextStageKey`, so published flows are unaffected.
 */
function StageRouting({ stage, others, fields, decision, update, changeRule, moveRule }: { stage: FmsStageDefinition; others: readonly FmsStageDefinition[]; fields: readonly FmsFormFieldRef[]; decision: boolean; update: (patch: Partial<FmsStageDefinition>) => void; changeRule: (index: number, patch: Partial<FmsBranchRule>) => void; moveRule: (index: number, direction: -1 | 1) => void }) {
  const styles = useStyles();
  const routed = hasFmsStageRouting(stage);
  const addRoute = () => {
    const source = stage.formTemplateId && fields.length ? "form_answer" as const : decision ? "outcome" as const : "context" as const;
    const route: FmsBranchRule = { id: newRequestKey(), source, operator: "equals", ...(source === "form_answer" ? { sourceKey: fields[0]?.key } : {}), value: source === "outcome" ? stage.sla.decisionOptions?.[0]?.key ?? "" : "", order: stage.branchRules.length, nextStageKey: undefined };
    update({ branchRules: [...stage.branchRules, route].map((rule, order) => ({ ...rule, order })) });
  };
  return (
    <Section help={routed ? "Routes are checked top to bottom. The first match wins; anything else takes the fallback." : "This step continues to one next step. Add a condition to send different answers down different paths."} title="On completion">
      <Button label="Add route" onPress={addRoute} variant="secondary" />
      {stage.branchRules.map((rule, index) => (
        <RouteRow changeRule={changeRule} decision={decision} fields={fields} index={index} key={rule.id} moveRule={moveRule} others={others} remove={() => update({ branchRules: stage.branchRules.filter((_, ruleIndex) => ruleIndex !== index).map((item, order) => ({ ...item, order })) })} rule={rule} stage={stage} />
      ))}
      <StageSelect label={routed ? "Otherwise (fallback) go to" : "Continue to"} onChange={(value) => update({ defaultNextStageKey: value })} others={others} value={stage.defaultNextStageKey} />
      {routed && !hasFmsStageFallback(stage) ? <View style={styles.warn}><Text tone="danger" variant="caption">Choose an Otherwise destination. An answer that matches no route must still have somewhere to go.</Text></View> : null}
      {routed && !stage.formTemplateId && stage.branchRules.some((rule) => rule.source === "form_answer") ? <View style={styles.warn}><Text tone="danger" variant="caption">Link a Form above so these answers exist at run time.</Text></View> : null}
      {stage.formTemplateId && !fields.length ? <View style={styles.note}><Text tone="warm" variant="caption">No branchable fields available in this form.</Text></View> : null}
    </Section>
  );
}

function RouteRow({ rule, index, stage, others, fields, decision, changeRule, moveRule, remove }: { rule: FmsBranchRule; index: number; stage: FmsStageDefinition; others: readonly FmsStageDefinition[]; fields: readonly FmsFormFieldRef[]; decision: boolean; changeRule: (index: number, patch: Partial<FmsBranchRule>) => void; moveRule: (index: number, direction: -1 | 1) => void; remove: () => void }) {
  const styles = useStyles();
  const theme = useAppTheme();
  const field = rule.source === "form_answer" ? fields.find((item) => item.key === rule.sourceKey) : undefined;
  const options = rule.source === "outcome" ? (stage.sla.decisionOptions ?? []).map((option) => ({ value: option.key, label: option.label })) : fmsFieldOptions(field);
  const selected = Array.isArray(rule.value) ? rule.value.map(String) : [String(rule.value ?? "")].filter(Boolean);
  const removed = selected.filter((value) => !options.some((option) => option.value === value)).map((value) => ({ value, label: `${value} (removed)` }));
  const sources = [
    ...(fields.length ? [{ value: "form_answer", label: "Answer in the linked form" }] : []),
    ...(decision ? [{ value: "outcome", label: "This step’s decision outcome" }] : []),
    { value: "context", label: "Process data field" },
  ];
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text tone="primary" variant="caption" weight="semibold">{`ROUTE ${index + 1}`}</Text>
        <View style={styles.flex} />
        <IconButton disabled={index === 0} label={`Move route ${index + 1} up`} onPress={() => moveRule(index, -1)}><ArrowUp color={theme.colors.textMuted} size={16} /></IconButton>
        <IconButton disabled={index === stage.branchRules.length - 1} label={`Move route ${index + 1} down`} onPress={() => moveRule(index, 1)}><ArrowDown color={theme.colors.textMuted} size={16} /></IconButton>
        <IconButton label={`Delete route ${index + 1}`} onPress={remove}><Trash2 color={theme.colors.danger} size={16} /></IconButton>
      </View>
      <TextField label={`Route ${index + 1} label`} maxLength={60} onChangeText={(label) => changeRule(index, { label })} placeholder="Label shown on the connection" value={rule.label ?? ""} />
      <OptionPicker
        label="When"
        onChange={(values) => { const source = (values[0] ?? rule.source) as FmsBranchRule["source"]; changeRule(index, { source, sourceKey: source === "form_answer" ? fields[0]?.key : source === "outcome" ? undefined : rule.sourceKey, value: "" }); }}
        options={sources.some((item) => item.value === rule.source) ? sources : [...sources, { value: rule.source, label: rule.source }]}
        selected={[rule.source]}
      />
      {rule.source === "form_answer" ? (
        <OptionPicker
          label="Question"
          onChange={(values) => changeRule(index, { sourceKey: values[0] ?? "", value: "" })}
          options={[...fields.map((item) => ({ value: item.key, label: item.label })), ...(rule.sourceKey && !fields.some((item) => item.key === rule.sourceKey) ? [{ value: rule.sourceKey, label: `${rule.sourceKey} (removed)` }] : [])]}
          placeholder="Select a question"
          selected={rule.sourceKey ? [rule.sourceKey] : []}
        />
      ) : rule.source === "context" ? (
        <TextField autoCapitalize="none" label="Field key" onChangeText={(value) => changeRule(index, { sourceKey: value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} placeholder="e.g. status" value={rule.sourceKey ?? ""} />
      ) : (
        <Text tone="muted" variant="caption">Uses the outcome the doer selects on this step.</Text>
      )}
      <OptionPicker label="Condition" onChange={(values) => { const operator = (values[0] ?? rule.operator) as FmsBranchOperator; changeRule(index, { operator, value: operator === "in" ? [] : "" }); }} options={routeOperators} selected={[rule.operator]} />
      {VALUE_FREE_OPERATORS.has(rule.operator) ? null
        : options.length ? (
          <OptionPicker
            label="Answer"
            multiple={rule.operator === "in"}
            onChange={(values) => changeRule(index, { value: rule.operator === "in" ? [...values] : values[0] ?? "" })}
            options={[...options, ...removed]}
            placeholder="Select an answer"
            selected={selected}
          />
        ) : (
          <TextField label="Answer" onChangeText={(value) => changeRule(index, { value: rule.operator === "in" ? value.split(",").map((item) => item.trim()).filter(Boolean) : value })} placeholder={rule.operator === "in" ? "value_a, value_b" : "Expected value"} value={selected.join(", ")} />
        )}
      <StageSelect label="Then go to" onChange={(value) => changeRule(index, { nextStageKey: value, nextFlowId: undefined })} others={others} value={rule.nextStageKey} />
    </View>
  );
}

function TimingFields({ sla, earlierStages, updateSla }: { sla: FmsSlaRule; earlierStages: readonly FmsStageDefinition[]; updateSla: (patch: Partial<FmsSlaRule>) => void }) {
  const styles = useStyles();
  if (sla.deadlineEnabled === false) return <View style={styles.note}><Text tone="muted" variant="caption">No deadline will be created for this step.</Text></View>;
  const method = timingMethod(sla);
  if (method === "tat_hours") {
    const unit = sla.tatUnit ?? "hours";
    const display = sla.tatMinutes === undefined ? sla.tatHours ?? "" : unit === "hours" ? sla.tatMinutes / 60 : sla.tatMinutes;
    return (
      <>
        <TextField keyboardType="decimal-pad" label="TAT" onChangeText={(text) => { const value = text ? Number(text) : undefined; updateSla({ tatMinutes: value === undefined || Number.isNaN(value) ? undefined : Math.round(unit === "hours" ? value * 60 : value), tatHours: undefined }); }} value={String(display)} />
        <OptionPicker label="TAT unit" onChange={(values) => { const next = (values[0] ?? "hours") as "hours" | "minutes"; const minutes = sla.tatMinutes ?? (sla.tatHours ?? 0) * 60; updateSla({ tatUnit: next, tatMinutes: minutes || undefined, tatHours: undefined }); }} options={[{ value: "hours", label: "Hours" }, { value: "minutes", label: "Minutes" }]} selected={[unit]} />
        <OptionPicker label="Trigger from" onChange={(values) => updateSla({ triggerStageKey: values[0] || undefined })} options={[{ value: "", label: "Auto (previous step’s completion)" }, ...earlierStages.map((item) => ({ value: item.key, label: item.name }))]} selected={[sla.triggerStageKey ?? ""]} />
      </>
    );
  }
  if (method === "days_before_date") {
    return (
      <>
        <Text tone="muted" variant="label">Future date</Text>
        <DateField disabled={false} invalid={false} label="Future date" mode="date" onChange={(futureDate) => updateSla({ futureDate })} value={sla.futureDate ?? ""} />
        <TextField keyboardType="number-pad" label="Days before" onChangeText={(text) => updateSla({ daysBefore: text ? Number(text) : undefined })} value={sla.daysBefore === undefined ? "" : String(sla.daysBefore)} />
      </>
    );
  }
  if (method === "specific_time") {
    return (
      <>
        <Text tone="muted" variant="label">Date</Text>
        <DateField disabled={false} invalid={false} label="Date" mode="date" onChange={(dueDate) => updateSla({ dueDate })} value={sla.dueDate ?? ""} />
        <Text tone="muted" variant="label">Clock time</Text>
        <DateField disabled={false} invalid={false} label="Clock time" mode="time" onChange={(clockTime) => updateSla({ clockTime })} value={sla.clockTime ?? ""} />
      </>
    );
  }
  return (
    <>
      <Text tone="muted" variant="label">Completion due date</Text>
      <DateField disabled={false} invalid={false} label="Completion due date" mode="date" onChange={(dueDate) => updateSla({ dueDate })} value={sla.dueDate ?? ""} />
    </>
  );
}

function LinkedForm({ data, firstStage, stage, update }: { data: FmsData; firstStage: boolean; stage: FmsStageDefinition; update: (patch: Partial<FmsStageDefinition>) => void }) {
  const styles = useStyles();
  const pinned = data.forms.find((form) => form.id === stage.formTemplateId);
  const missing = !!stage.formTemplateId && !pinned;
  const newer = newerFormVersion(data.forms, stage.formTemplateId);
  const options = [
    { value: "", label: firstStage ? "Select the initial Form" : "No form — complete this step without one" },
    ...data.forms.map((form) => ({ value: form.id, label: `${form.name} · v${form.version}${form.lifecycle === "published" ? "" : " (pinned)"}` })),
    ...(missing && stage.formTemplateId ? [{ value: stage.formTemplateId, label: "Unavailable form (removed or unpublished)" }] : []),
  ];
  return (
    <>
      <OptionPicker label={firstStage ? "Initial details form" : "Linked form"} onChange={(values) => update({ formTemplateId: values[0] || undefined })} options={options} selected={[stage.formTemplateId ?? ""]} />
      {missing ? <View style={styles.warn}><Text tone="danger" variant="caption">This Form is no longer an available published version. Choose another before publishing.</Text></View> : null}
      {/* Revisions copy every question key, so re-pinning keeps the configured routes valid. */}
      {newer ? (
        <View style={styles.note}>
          <Text tone="warm" variant="caption">{`Version ${newer.version} of this Form is published. Use it to pick up its current questions and answers. Routes keep matching because question and answer identities do not change between versions.`}</Text>
          <Button label={`Use v${newer.version}`} onPress={() => update({ formTemplateId: newer.id })} variant="ghost" />
        </View>
      ) : null}
    </>
  );
}

function BranchEditor({ stage, others, update, changeRule, moveRule }: { stage: FmsStageDefinition; others: readonly FmsStageDefinition[]; update: (patch: Partial<FmsStageDefinition>) => void; changeRule: (index: number, patch: Partial<FmsBranchRule>) => void; moveRule: (index: number, direction: -1 | 1) => void }) {
  const styles = useStyles();
  const theme = useAppTheme();
  return (
    <Section help="Advanced routes run top to bottom. Keep one fallback route last." title="Ordered decision routes">
      {stage.branchRules.map((rule, index) => (
        <View key={rule.id} style={styles.card}>
          <View style={styles.row}>
            <View style={styles.flex}><TextField label={`Route ${index + 1} label`} onChangeText={(label) => changeRule(index, { label })} value={rule.label ?? ""} /></View>
            <IconButton disabled={index === 0} label="Move route up" onPress={() => moveRule(index, -1)}><ArrowUp color={theme.colors.textMuted} size={16} /></IconButton>
            <IconButton disabled={index === stage.branchRules.length - 1} label="Move route down" onPress={() => moveRule(index, 1)}><ArrowDown color={theme.colors.textMuted} size={16} /></IconButton>
            <IconButton disabled={stage.branchRules.length === 1} label="Delete route" onPress={() => update({ branchRules: stage.branchRules.filter((_, ruleIndex) => ruleIndex !== index).map((item, order) => ({ ...item, order })) })}><Trash2 color={theme.colors.danger} size={16} /></IconButton>
          </View>
          <OptionPicker label="Source" onChange={(values) => changeRule(index, { source: (values[0] ?? rule.source) as FmsBranchRule["source"] })} options={[{ value: "outcome", label: "Previous outcome" }, { value: "context", label: "Process data" }, { value: "form_answer", label: "Form answer" }]} selected={[rule.source]} />
          <TextField autoCapitalize="none" editable={rule.source !== "outcome"} label="Stable field key" onChangeText={(sourceKey) => changeRule(index, { sourceKey })} value={rule.sourceKey ?? ""} />
          <OptionPicker label="Operator" onChange={(values) => changeRule(index, { operator: (values[0] ?? rule.operator) as FmsBranchRule["operator"] })} options={FMS_BRANCH_OPERATORS.map((operator) => ({ value: operator, label: operator === "default" ? "Fallback" : operator.replaceAll("_", " ") }))} selected={[rule.operator]} />
          <TextField editable={!["default", "not_empty"].includes(rule.operator)} label="Expected value" onChangeText={(value) => changeRule(index, { value })} value={String(rule.value ?? "")} />
          <StageSelect label="Then go to" onChange={(value) => changeRule(index, { nextStageKey: value, nextFlowId: undefined })} others={others} value={rule.nextStageKey} />
        </View>
      ))}
      <Button
        label="Add route"
        onPress={() => {
          const route: FmsBranchRule = { id: newRequestKey(), source: "outcome", operator: "equals", value: "", order: Math.max(0, stage.branchRules.length - 1), label: "New route" };
          update({ branchRules: [...stage.branchRules.filter((rule) => rule.operator !== "default"), route, ...stage.branchRules.filter((rule) => rule.operator === "default")].map((rule, order) => ({ ...rule, order })) });
        }}
        variant="secondary"
      />
    </Section>
  );
}

function DecisionOptions({ options, update }: { options: readonly { key: string; label: string }[]; update: (options: readonly { key: string; label: string }[]) => void }) {
  const styles = useStyles();
  const theme = useAppTheme();
  const move = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= options.length) return; const next = [...options]; [next[index], next[target]] = [next[target]!, next[index]!]; update(next); };
  return (
    <View style={styles.card}>
      <Text tone="primary" variant="caption" weight="semibold">DECISION OPTIONS</Text>
      {options.map((option, index) => (
        <View key={option.key} style={styles.row}>
          <View style={styles.flex}><TextField label={`Decision option ${index + 1}`} onChangeText={(label) => update(options.map((item, itemIndex) => itemIndex === index ? { ...item, label } : item))} value={option.label} /></View>
          <IconButton disabled={index === 0} label="Move decision option up" onPress={() => move(index, -1)}><ArrowUp color={theme.colors.textMuted} size={16} /></IconButton>
          <IconButton disabled={index === options.length - 1} label="Move decision option down" onPress={() => move(index, 1)}><ArrowDown color={theme.colors.textMuted} size={16} /></IconButton>
          <IconButton disabled={options.length <= 2} label="Delete decision option" onPress={() => update(options.filter((_, itemIndex) => itemIndex !== index))}><Trash2 color={theme.colors.danger} size={16} /></IconButton>
        </View>
      ))}
      <Button label="Add decision option" onPress={() => { let index = options.length + 1; let key = `option_${index}`; while (options.some((option) => option.key === key)) key = `option_${++index}`; update([...options, { key, label: "New option" }]); }} variant="secondary" />
    </View>
  );
}

function DynamicDecisionCondition({ condition, decisions, updateSla }: { condition: Extract<FmsSlaRule["conditional"], { decisionStageKey: string }>; decisions: readonly FmsStageDefinition[]; updateSla: (patch: Partial<FmsSlaRule>) => void }) {
  const selected = decisions.find((item) => item.key === condition.decisionStageKey) ?? decisions[0];
  const optionKey = "decisionOptionKey" in condition ? condition.decisionOptionKey : condition.outcome;
  return (
    <>
      <OptionPicker label="Earlier decision" onChange={(values) => { const next = decisions.find((item) => item.key === values[0]); updateSla({ conditional: { decisionStageKey: values[0] ?? "", decisionOptionKey: next?.sla.decisionOptions?.[0]?.key ?? "" } }); }} options={decisions.map((item) => ({ value: item.key, label: item.name }))} selected={selected ? [selected.key] : []} />
      <OptionPicker label="Run when answer is" onChange={(values) => updateSla({ conditional: { decisionStageKey: selected?.key ?? "", decisionOptionKey: values[0] ?? "" } })} options={(selected?.sla.decisionOptions ?? []).map((option) => ({ value: option.key, label: option.label }))} selected={optionKey ? [String(optionKey)] : []} />
    </>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  editor: { gap: theme.space.md, paddingBottom: theme.space.xl },
  section: { gap: theme.space.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.space.sm },
  choice: { gap: 2, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, padding: theme.space.sm },
  choiceSelected: { borderColor: theme.colors.brand, backgroundColor: theme.colors.brandSoft },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  iconButton: { minWidth: 36, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.sm },
  card: { gap: theme.space.sm, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, padding: theme.space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
  flex: { flex: 1, minWidth: 0 },
  warn: { borderWidth: 1, borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft, borderRadius: theme.radius.md, padding: theme.space.sm },
  note: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.space.sm, gap: theme.space.xs },
}));
