import type { ReactNode } from "react";
import {
  FMS_FORM_DUE_MISSING, FMS_FORM_DUE_MISSING_LABELS, fmsAutoDueDateFields, fmsAutoFormDueApplies, fmsDueDateFields, fmsDueTimeFields, fmsFormDueIssues, fmsIncomingFormStages, fmsStageFormFields, suggestFmsDueSource,
  type FmsFormDueMissing, type FmsFormDueRule, type FmsFormDueSource, type FmsSlaRule, type FmsStageDefinition,
} from "@jewelos/core";
import { cn } from "@/lib/utils";
import type { FmsData } from "./api";

export type FmsDueSourceMode = "form" | "fixed" | "tat" | "none";
const MODES: readonly { value: FmsDueSourceMode; label: string; help: string }[] = [
  { value: "form", label: "From form answer", help: "A date the previous step's form records, like Next Follow-up Date." },
  { value: "fixed", label: "Fixed date and time", help: "A calendar date, a clock time, or days before a date." },
  { value: "tat", label: "TAT / relative", help: "Hours or minutes after an earlier step." },
  { value: "none", label: "No due date", help: "The task has no deadline." },
];
const FIXED_METHODS = new Set(["completion_date", "specific_time", "days_before_date"]);

export function fmsDueSourceMode(sla: FmsSlaRule): FmsDueSourceMode {
  if (sla.deadlineEnabled === false) return "none";
  if (sla.formDue) return "form";
  return sla.timingMethod === "tat_hours" ? "tat" : "fixed";
}

/** Suggestions for every earlier form step whose section clearly has one due-date question. */
function suggestedRule(stage: FmsStageDefinition, stages: readonly FmsStageDefinition[], data: FmsData): FmsFormDueRule {
  const sources = fmsIncomingFormStages({ stages }, stage.key).flatMap((source) => { const found = suggestFmsDueSource(source.key, fmsStageFormFields(source, data.formFields)); return found ? [found] : []; });
  return { sources, onMissing: "none" };
}

/**
 * Due Date Source for a person's step. From form answer reads the date (and an
 * optional time) that the step leading here recorded; each earlier step that
 * can lead here gets its own question. The timing rule stays as the fallback.
 */
export function FmsDueDateSource({ stage, stages, data, stageIndex, updateSla, timing }: { stage: FmsStageDefinition; stages: readonly FmsStageDefinition[]; data: FmsData; stageIndex: number; updateSla: (patch: Partial<FmsSlaRule>) => void; timing: (methods: "fixed" | "tat" | "fallback") => ReactNode }) {
  const mode = fmsDueSourceMode(stage.sla);
  const choose = (next: FmsDueSourceMode) => {
    if (next === mode) return;
    if (next === "none") return updateSla({ deadlineEnabled: false, autoFormDue: false });
    if (next === "form") return updateSla({ deadlineEnabled: true, formDue: stage.sla.formDue ?? suggestedRule(stage, stages, data) });
    if (next === "tat") return updateSla({ deadlineEnabled: true, formDue: undefined, timingMethod: "tat_hours" });
    return updateSla({ deadlineEnabled: true, formDue: undefined, timingMethod: FIXED_METHODS.has(stage.sla.timingMethod ?? "completion_date") ? stage.sla.timingMethod ?? "completion_date" : "completion_date" });
  };
  const firstStep = stageIndex === 0;
  return <div className="space-y-3">
    <div aria-label="Due date source" className="grid gap-2 sm:grid-cols-2" role="group">
      {MODES.map((option) => { const disabled = option.value === "form" && firstStep;
        return <button aria-pressed={mode === option.value} className={cn("min-h-11 rounded-xl border p-3 text-left transition disabled:opacity-50", mode === option.value ? "border-gold bg-gold/10 text-white" : "border-gold/20 text-soft-grey hover:border-gold/60")} disabled={disabled} key={option.value} onClick={() => choose(option.value)} title={disabled ? "The first step has no earlier form" : undefined} type="button">
          <span className="block text-sm font-semibold">{option.label}</span><span className="mt-0.5 block text-xs text-soft-grey">{option.help}</span>
        </button>; })}
    </div>
    {mode === "form" && stage.sla.formDue ? <FormAnswerDue data={data} rule={stage.sla.formDue} stage={stage} stageIndex={stageIndex} stages={stages} timing={timing("fallback")} updateSla={updateSla} /> : null}
    {mode === "fixed" ? timing("fixed") : null}
    {mode === "tat" ? timing("tat") : null}
    {mode === "none" ? <p className="text-xs text-soft-grey">No deadline will be created for this step.</p> : null}
  </div>;
}

/**
 * What a step with "Set deadline" off does: the server (fms_auto_form_due, 0361)
 * takes the answered follow-up / next / due date from the previous step's form.
 * The author can turn it off for this step.
 */
export function FmsAutoFormDue({ stage, stages, data, stageIndex, updateSla }: { stage: FmsStageDefinition; stages: readonly FmsStageDefinition[]; data: FmsData; stageIndex: number; updateSla: (patch: Partial<FmsSlaRule>) => void }) {
  if (stageIndex === 0) return <p className="text-xs text-soft-grey">No deadline. Switch it on to set one.</p>;
  const on = fmsAutoFormDueApplies(stage);
  const incoming = fmsIncomingFormStages({ stages }, stage.key).map((source) => ({ source, dates: fmsAutoDueDateFields(fmsStageFormFields(source, data.formFields)) }));
  const found = incoming.filter((item) => item.dates.length);
  return <div className="space-y-2">
    <label className="flex min-h-10 items-start gap-2 text-sm text-champagne">
      <input checked={on} className="mt-0.5 size-5 shrink-0 accent-gold" onChange={(event) => updateSla({ autoFormDue: event.target.checked ? undefined : false })} type="checkbox" />
      <span>Take the due date from the previous form<span className="mt-0.5 block text-xs text-soft-grey">Like a normal task: the task is due on the date the employee picked, and shows as overdue once it passes.</span></span>
    </label>
    {!on ? <p className="text-xs text-soft-grey">No due date for this step.</p>
      : found.length ? <ul className="space-y-1 rounded-lg border border-gold/15 p-2 text-xs text-soft-grey">{found.map(({ source, dates }) => <li key={source.key}>
          From <span className="text-champagne">{source.name || "the earlier step"}</span>: {dates.map((field) => field.label).join(" or ")}{dates.length > 1 ? " (whichever was answered)" : ""}
        </li>)}<li>Date-only answers are due at the end of that day.</li></ul>
      : <p className="text-xs text-warning">The previous form has no follow-up or due date question, so this task gets no due date. Add a date question such as "Next follow-up date", or switch on Set deadline to choose a time.</p>}
  </div>;
}

function FormAnswerDue({ stage, stages, data, rule, stageIndex, updateSla, timing }: { stage: FmsStageDefinition; stages: readonly FmsStageDefinition[]; data: FmsData; rule: FmsFormDueRule; stageIndex: number; updateSla: (patch: Partial<FmsSlaRule>) => void; timing: ReactNode }) {
  const incoming = fmsIncomingFormStages({ stages }, stage.key);
  const set = (patch: Partial<FmsFormDueRule>) => updateSla({ formDue: { ...rule, ...patch } });
  const setSource = (stageKey: string, next: FmsFormDueSource | undefined) => {
    const others = rule.sources.filter((source) => source.stageKey !== stageKey);
    set({ sources: next ? [...others, next].sort((a, b) => incoming.findIndex((item) => item.key === a.stageKey) - incoming.findIndex((item) => item.key === b.stageKey)) : others });
  };
  // Configured sources whose step no longer leads here stay listed so they can be removed.
  const orphaned = rule.sources.filter((source) => !incoming.some((item) => item.key === source.stageKey));
  const issues = fmsFormDueIssues({ stages }, stage, stageIndex, data.formFields);
  return <div className="space-y-3 rounded-xl border border-gold/15 p-3">
    {!incoming.length ? <p className="text-xs text-soft-grey">No earlier step with a form leads to this step yet. Connect a step that has questions, then choose its date question here.</p> : null}
    {incoming.map((source) => {
      const fields = fmsStageFormFields(source, data.formFields);
      const dates = fmsDueDateFields(fields); const times = fmsDueTimeFields(fields);
      const current = rule.sources.find((item) => item.stageKey === source.key);
      const date = dates.find((field) => field.key === current?.dateFieldKey);
      return <fieldset className="space-y-2" key={source.key}>
        <legend className="text-xs font-semibold text-champagne">Arriving from {source.name || "an earlier step"}</legend>
        {!dates.length ? <p className="text-xs text-soft-grey">This step's form has no date question. Add one (for example Next Follow-up Date) or the task falls back below.</p> : <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="label">Date question</span>
            <select aria-label={`Due date question from ${source.name}`} className="field" onChange={(event) => setSource(source.key, event.target.value ? { stageKey: source.key, dateFieldKey: event.target.value, ...(current?.timeFieldKey && dates.find((field) => field.key === event.target.value)?.type === "date" ? { timeFieldKey: current.timeFieldKey } : {}) } : undefined)} value={current?.dateFieldKey ?? ""}>
              <option value="">{dates.length > 1 ? "Choose the due-date question" : "Do not use"}</option>
              {current && !date ? <option value={current.dateFieldKey}>Unavailable question (removed from the form)</option> : null}
              {dates.map((field) => <option key={field.key} value={field.key}>{field.label}{field.type === "datetime" ? " (date and time)" : ""}</option>)}
            </select></label>
          {date?.type === "date" ? <label className="block"><span className="label">Time question (optional)</span>
            <select aria-label={`Due time question from ${source.name}`} className="field" onChange={(event) => setSource(source.key, { stageKey: source.key, dateFieldKey: date.key, ...(event.target.value ? { timeFieldKey: event.target.value } : {}) })} value={current?.timeFieldKey ?? ""}>
              <option value="">No separate time</option>
              {times.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
            </select></label> : null}
        </div>}
        {dates.length > 1 && !current ? <p className="text-xs text-warning">This form has several date questions. Choose the one that sets the due date.</p> : null}
      </fieldset>;
    })}
    {orphaned.map((source) => <p className="flex items-center justify-between gap-2 rounded-lg border border-danger/30 p-2 text-xs text-danger" key={source.stageKey}>
      <span>{stages.find((item) => item.key === source.stageKey)?.name ?? "A removed step"} no longer leads here.</span>
      <button className="underline" onClick={() => setSource(source.stageKey, undefined)} type="button">Remove</button></p>)}
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block"><span className="label">Date-only answers are due at</span>
        <input aria-label="Default due time" className="field" onChange={(event) => set({ defaultTime: event.target.value || undefined })} type="time" value={rule.defaultTime ?? ""} />
        <span className="mt-1 block text-[11px] text-soft-grey">{rule.defaultTime ? "Used when the form has no time answer." : "Empty: the end of that day (India time)."}</span></label>
      <label className="block"><span className="label">If the date is missing</span>
        <select aria-label="If the due date is missing" className="field" onChange={(event) => set({ onMissing: event.target.value as FmsFormDueMissing })} value={rule.onMissing}>
          {FMS_FORM_DUE_MISSING.map((value) => <option key={value} value={value}>{FMS_FORM_DUE_MISSING_LABELS[value]}</option>)}
        </select></label>
    </div>
    {rule.onMissing === "fallback" ? <div className="space-y-2 border-t border-gold/10 pt-3"><p className="text-xs font-semibold text-champagne">Fallback timing</p>{timing}</div> : null}
    {issues.length ? <ul className="space-y-1 rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
  </div>;
}
