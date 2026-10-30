import type { FmsFlowDefinition, FmsFormDueRule, FmsFormDueSource, FmsFormFieldRef, FmsStageDefinition } from "./types";

/**
 * Due dates taken from a form answer (planned_time_rule.formDue). The server
 * (fms_form_due_resolution, migration 0360) is the only place a deadline is
 * resolved and saved; these helpers drive the builder and the task board.
 */
export const FMS_FORM_DUE_MISSING = ["fallback", "none", "require"] as const;
export type FmsFormDueMissing = (typeof FMS_FORM_DUE_MISSING)[number];
export const FMS_FORM_DUE_MISSING_LABELS: Record<FmsFormDueMissing, string> = {
  fallback: "Use the fallback timing below",
  none: "Leave the task without a due date",
  require: "Require the date before the previous step can be submitted",
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const DATE_TYPES = new Set(["date", "datetime"]);
const TIME_TYPES = new Set(["text", "select", "radio"]);
/** Question names that clearly mean "when the next task is due". */
const DUE_INTENT = /\b(next|follow[\s-]?up|due|deadline|appointment|meeting|call\s?back|callback|visit|schedule[d]?|revisit)\b/i;
const TIME_INTENT = /\btime\b/i;

/** Date or date-and-time questions that can set a due date. */
export function fmsDueDateFields(fields: readonly FmsFormFieldRef[]): FmsFormFieldRef[] {
  return fields.filter((field) => DATE_TYPES.has(field.type ?? ""));
}
/** Questions that can carry a separate time answer (typed or chosen). */
export function fmsDueTimeFields(fields: readonly FmsFormFieldRef[]): FmsFormFieldRef[] {
  return fields.filter((field) => TIME_TYPES.has(field.type ?? ""));
}

/**
 * Safe automatic detection: suggest a question only when the form section has
 * exactly one date question and its name clearly means the next due date.
 * Several date questions are never guessed between.
 */
export function suggestFmsDueSource(stageKey: string, fields: readonly FmsFormFieldRef[]): FmsFormDueSource | undefined {
  const dates = fmsDueDateFields(fields);
  if (dates.length !== 1 || !DUE_INTENT.test(dates[0]!.label)) return undefined;
  const date = dates[0]!;
  if (date.type !== "date") return { stageKey, dateFieldKey: date.key };
  const times = fmsDueTimeFields(fields).filter((field) => TIME_INTENT.test(field.label));
  return { stageKey, dateFieldKey: date.key, ...(times.length === 1 ? { timeFieldKey: times[0]!.key } : {}) };
}

/** Steps with a form that route into `stageKey` (default next, routes, parallel starts). */
export function fmsIncomingFormStages(definition: Pick<FmsFlowDefinition, "stages">, stageKey: string): FmsStageDefinition[] {
  const leadsHere = (stage: FmsStageDefinition) => stage.defaultNextStageKey === stageKey
    || stage.branchRules.some((rule) => rule.nextStageKey === stageKey) || stage.parallelTargetStageKeys.includes(stageKey);
  const direct = definition.stages.filter((stage) => stage.key !== stageKey && leadsHere(stage));
  // Automatic steps (decision, parallel, notification) pass the previous form through.
  const seen = new Set<string>(); const out: FmsStageDefinition[] = [];
  const visit = (stage: FmsStageDefinition, depth: number) => {
    if (seen.has(stage.key) || depth > 20) return; seen.add(stage.key);
    if (stage.formTemplateId && ["form", "task", "approval"].includes(stage.type)) { out.push(stage); return; }
    for (const before of definition.stages.filter((item) => item.key !== stage.key && (item.defaultNextStageKey === stage.key || item.branchRules.some((rule) => rule.nextStageKey === stage.key) || item.parallelTargetStageKeys.includes(stage.key)))) visit(before, depth + 1);
  };
  for (const stage of direct) visit(stage, 0);
  return out;
}

export function normalizeFmsFormDue(value: unknown): FmsFormDueRule | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const sources = (Array.isArray(raw.sources) ? raw.sources : []).flatMap((item): FmsFormDueSource[] => {
    if (typeof item !== "object" || item === null) return [];
    const source = item as Record<string, unknown>;
    const stageKey = typeof source.stageKey === "string" ? source.stageKey.trim().toLowerCase() : "";
    const dateFieldKey = typeof source.dateFieldKey === "string" ? source.dateFieldKey.trim() : "";
    const timeFieldKey = typeof source.timeFieldKey === "string" ? source.timeFieldKey.trim() : "";
    if (!stageKey) return [];
    return [{ stageKey, dateFieldKey, ...(timeFieldKey ? { timeFieldKey } : {}) }];
  }).slice(0, 20);
  const onMissing = FMS_FORM_DUE_MISSING.includes(raw.onMissing as FmsFormDueMissing) ? raw.onMissing as FmsFormDueMissing : "none";
  const defaultTime = typeof raw.defaultTime === "string" && CLOCK.test(raw.defaultTime) ? raw.defaultTime : undefined;
  return { sources, onMissing, ...(defaultTime ? { defaultTime } : {}) };
}

/** Builder validation, matching assert_fms_form_due_publishable. */
export function fmsFormDueIssues(definition: Pick<FmsFlowDefinition, "stages">, stage: FmsStageDefinition, stageIndex: number, fields: Readonly<Record<string, readonly FmsFormFieldRef[]>> | undefined): string[] {
  const rule = stage.sla.formDue; if (!rule || stage.sla.deadlineEnabled === false) return [];
  const issues: string[] = [];
  if (!["form", "task", "approval"].includes(stage.type)) issues.push("Only a person's step can take its due date from a form");
  if (stageIndex === 0) issues.push("The first step has no earlier form to take a due date from");
  if (!rule.sources.length) issues.push("Choose the earlier step and the date question for the due date");
  if (new Set(rule.sources.map((source) => source.stageKey)).size !== rule.sources.length) issues.push("Choose one due-date question per earlier step");
  if (rule.defaultTime !== undefined && !CLOCK.test(rule.defaultTime)) issues.push("Default time must be HH:MM");
  for (const source of rule.sources) {
    const from = definition.stages.find((item) => item.key === source.stageKey);
    if (!KEY.test(source.stageKey) || !from || from.key === stage.key || !from.formTemplateId) { issues.push("Due date must come from an earlier step that has a form"); continue; }
    if (!fields) continue;
    const formFields = fields[from.formTemplateId] ?? [];
    const date = formFields.find((field) => field.key === source.dateFieldKey);
    if (!date || !DATE_TYPES.has(date.type ?? "")) { issues.push(`Choose a date question from ${from.name || "the earlier step"}`); continue; }
    if (source.timeFieldKey) {
      const time = formFields.find((field) => field.key === source.timeFieldKey);
      if (date.type !== "date" || !time || !TIME_TYPES.has(time.type ?? "")) issues.push(`The time question from ${from.name || "the earlier step"} must sit next to a date question`);
    }
  }
  return issues;
}

/** Plain-language summary for the inspector. */
export function fmsFormDueSummary(definition: Pick<FmsFlowDefinition, "stages">, rule: FmsFormDueRule, fields: Readonly<Record<string, readonly FmsFormFieldRef[]>>): string {
  if (!rule.sources.length) return "From form answer · not set";
  const labels = rule.sources.map((source) => {
    const from = definition.stages.find((stage) => stage.key === source.stageKey);
    const formFields = from?.formTemplateId ? fields[from.formTemplateId] ?? [] : [];
    const date = formFields.find((field) => field.key === source.dateFieldKey)?.label ?? "date not chosen";
    return `${date}${source.timeFieldKey ? ` + ${formFields.find((field) => field.key === source.timeFieldKey)?.label ?? "time"}` : ""}`;
  });
  return `From form · ${[...new Set(labels)].join(" / ")}`;
}

export type FmsDueUrgency = "overdue" | "today" | "upcoming" | "none";
/** Calendar day of an instant in a timezone, as YYYY-MM-DD. */
function localDay(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
/** Same rule as the server's fms_due_urgency: overdue, due today, upcoming or no deadline. */
export function fmsDueUrgency(dueAt: string | null, now = new Date(), timeZone = "Asia/Kolkata"): FmsDueUrgency {
  if (!dueAt) return "none";
  const due = new Date(dueAt); if (Number.isNaN(due.getTime())) return "none";
  if (due.getTime() < now.getTime()) return "overdue";
  return localDay(due, timeZone) === localDay(now, timeZone) ? "today" : "upcoming";
}
