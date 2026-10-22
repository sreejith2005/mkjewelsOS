import { kolkataDateKey, recurrenceOccurrenceDates } from "./recurrence.ts";

/**
 * The structured schedule behind Create Task, the Task Control template form
 * and the bulk importer.
 *
 * All three describe a schedule as a `ScheduleSpec`, and `buildScheduleRule`
 * is the only place a spec becomes the `recurrence_rule` and `schedule_kind` a
 * `task_templates` row stores. The rule it writes is the subset that
 * `is_supported_task_rrule` (migration 0005) accepts, and the scheduler,
 * catch-up and immediate materialization all read it through
 * `shouldGenerateRecurringTask`, so a manual schedule and an imported schedule
 * with the same configuration produce the same occurrences.
 */

export const SCHEDULE_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type ScheduleWeekday = (typeof SCHEDULE_WEEKDAYS)[number];

/** 1 to 4 count from the start of the month; -1 is the last one. */
export type ScheduleOrdinal = 1 | 2 | 3 | 4 | -1;
export const SCHEDULE_ORDINALS: readonly ScheduleOrdinal[] = [1, 2, 3, 4, -1];

export type ScheduleEnd =
  | Readonly<{ type: "never" }>
  | Readonly<{ type: "until"; date: string }>
  | Readonly<{ type: "count"; count: number }>;

export type ScheduleSpec =
  /** Every `interval` days. */
  | Readonly<{ pattern: "daily"; interval: number; end: ScheduleEnd }>
  /** Every `interval` weeks on the chosen weekdays. */
  | Readonly<{ pattern: "weekly"; interval: number; weekdays: readonly ScheduleWeekday[]; end: ScheduleEnd }>
  /** Every `interval` months on the chosen dates; -1 is the last day of the month. */
  | Readonly<{ pattern: "monthly_dates"; interval: number; days: readonly number[]; end: ScheduleEnd }>
  /** Every `interval` months on the nth (or last) weekday, e.g. the 3rd Saturday. */
  | Readonly<{ pattern: "monthly_weekday"; interval: number; ordinal: ScheduleOrdinal; weekday: ScheduleWeekday; end: ScheduleEnd }>
  /** Every year in the chosen months, on one date of the month. */
  | Readonly<{ pattern: "yearly"; interval: number; months: readonly number[]; day: number; end: ScheduleEnd }>;

export type SchedulePattern = ScheduleSpec["pattern"];

/** `task_templates.schedule_kind` values a calendar schedule can carry. */
export type CalendarScheduleKind = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export const MAX_SCHEDULE_INTERVAL = 99;
export const MAX_SCHEDULE_COUNT = 999;

const WEEKDAY_NAMES: Readonly<Record<ScheduleWeekday, string>> = {
  MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday",
};
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function scheduleWeekdayName(day: ScheduleWeekday): string {
  return WEEKDAY_NAMES[day];
}

export function scheduleMonthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/** "1st", "2nd", "3rd", "4th", "last". */
export function scheduleOrdinalLabel(ordinal: number): string {
  if (ordinal === -1) return "last";
  const suffix = ordinal % 100 >= 11 && ordinal % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[ordinal % 10] ?? "th";
  return `${ordinal}${suffix}`;
}

function sortedWeekdays(days: readonly ScheduleWeekday[]): ScheduleWeekday[] {
  return SCHEDULE_WEEKDAYS.filter((day) => days.includes(day));
}

function sortedNumbers(values: readonly number[]): number[] {
  // The last day (-1) is written after the numbered days.
  return [...new Set(values)].sort((left, right) => (left === -1 ? 99 : left) - (right === -1 ? 99 : right));
}

function untilToken(date: string): string {
  return `UNTIL=${date.replaceAll("-", "")}T235959Z`;
}

function endTokens(end: ScheduleEnd): string[] {
  if (end.type === "count") return [`COUNT=${end.count}`];
  if (end.type === "until") return [untilToken(end.date)];
  return [];
}

function intervalToken(interval: number): string[] {
  return interval > 1 ? [`INTERVAL=${interval}`] : [];
}

/**
 * The schedule kind recorded beside the rule. It is a label and a filter value,
 * never what decides the dates; the importer's chunk contract accepts exactly
 * these five calendar kinds.
 */
export function scheduleKindForSpec(spec: ScheduleSpec): CalendarScheduleKind {
  if (spec.pattern === "daily") return "daily";
  if (spec.pattern === "weekly") return "weekly";
  if (spec.pattern === "yearly") {
    const months = sortedNumbers(spec.months);
    const quarterly = spec.interval === 1 && months.length === 4 && months.every((month, index) => index === 0 || month - months[index - 1]! === 3);
    return quarterly ? "quarterly" : "yearly";
  }
  return spec.interval === 3 ? "quarterly" : "monthly";
}

/**
 * The stored rule for a spec. Token order (FREQ, INTERVAL, BYMONTH, BYDAY,
 * BYMONTHDAY, end) matches what the importer has always written, so the same
 * schedule is byte-identical whichever screen created it.
 */
export function buildScheduleRule(spec: ScheduleSpec): Readonly<{ recurrenceRule: string; scheduleKind: CalendarScheduleKind }> {
  const tokens: string[] = [];
  if (spec.pattern === "daily") tokens.push("FREQ=DAILY", ...intervalToken(spec.interval));
  else if (spec.pattern === "weekly") tokens.push("FREQ=WEEKLY", ...intervalToken(spec.interval), `BYDAY=${sortedWeekdays(spec.weekdays).join(",")}`);
  else if (spec.pattern === "monthly_dates") tokens.push("FREQ=MONTHLY", ...intervalToken(spec.interval), `BYMONTHDAY=${sortedNumbers(spec.days).join(",")}`);
  else if (spec.pattern === "monthly_weekday") tokens.push("FREQ=MONTHLY", ...intervalToken(spec.interval), `BYDAY=${spec.ordinal}${spec.weekday}`);
  else tokens.push("FREQ=YEARLY", ...intervalToken(spec.interval), `BYMONTH=${sortedNumbers(spec.months).join(",")}`, `BYMONTHDAY=${spec.day}`);
  tokens.push(...endTokens(spec.end));
  return { recurrenceRule: tokens.join(";"), scheduleKind: scheduleKindForSpec(spec) };
}

function validDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Why a spec cannot be saved, in the words the form shows, or null. */
export function validateScheduleSpec(spec: ScheduleSpec, startsOn: string): string | null {
  if (!validDate(startsOn)) return "Choose a valid start date.";
  if (!Number.isInteger(spec.interval) || spec.interval < 1 || spec.interval > MAX_SCHEDULE_INTERVAL) {
    return `Repeat every must be a whole number from 1 to ${MAX_SCHEDULE_INTERVAL}.`;
  }
  if (spec.pattern === "weekly" && sortedWeekdays(spec.weekdays).length === 0) return "Choose at least one weekday.";
  if (spec.pattern === "monthly_dates") {
    if (spec.days.length === 0) return "Choose at least one date of the month.";
    if (spec.days.some((day) => !Number.isInteger(day) || (day !== -1 && (day < 1 || day > 31)))) return "Dates of the month must be 1 to 31, or the last day.";
  }
  if (spec.pattern === "monthly_weekday" && !SCHEDULE_ORDINALS.includes(spec.ordinal)) return "Choose which week of the month.";
  if (spec.pattern === "yearly") {
    if (spec.months.length === 0) return "Choose at least one month.";
    if (spec.months.some((month) => !Number.isInteger(month) || month < 1 || month > 12)) return "Months must be January to December.";
    if (!Number.isInteger(spec.day) || spec.day < 1 || spec.day > 31) return "The date must be 1 to 31.";
  }
  if (spec.end.type === "count" && (!Number.isInteger(spec.end.count) || spec.end.count < 1 || spec.end.count > MAX_SCHEDULE_COUNT)) {
    return `End after must be 1 to ${MAX_SCHEDULE_COUNT} occurrences.`;
  }
  if (spec.end.type === "until") {
    if (!validDate(spec.end.date)) return "Choose a valid end date.";
    if (spec.end.date < startsOn) return "The end date must be on or after the start date.";
  }
  const { recurrenceRule } = buildScheduleRule(spec);
  if (!isSupportedTaskRrule(recurrenceRule)) return "This schedule cannot be saved.";
  if (recurrenceOccurrenceDates(recurrenceRule, startsOn, startsOn, 1).length === 0) return "This schedule never produces a date. Check the dates and end condition.";
  return null;
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function dayOfMonthLabel(day: number): string {
  return day === -1 ? "the last day" : `the ${scheduleOrdinalLabel(day)}`;
}

function everyLabel(interval: number, unit: string, units: string): string {
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${units}`;
}

function endLabel(end: ScheduleEnd): string {
  if (end.type === "count") return `, ${end.count} time${end.count === 1 ? "" : "s"}`;
  if (end.type === "until") return `, until ${end.date}`;
  return "";
}

/** A sentence for the schedule ("Every month on the 3rd Saturday"). */
export function describeScheduleSpec(spec: ScheduleSpec): string {
  let text: string;
  if (spec.pattern === "daily") text = everyLabel(spec.interval, "day", "days");
  else if (spec.pattern === "weekly") {
    const days = sortedWeekdays(spec.weekdays);
    const named = days.length === 7 ? "every day of the week" : joinWords(days.map(scheduleWeekdayName));
    text = `${everyLabel(spec.interval, "week", "weeks")} on ${named}`;
  } else if (spec.pattern === "monthly_dates") {
    const days = sortedNumbers(spec.days);
    text = `${everyLabel(spec.interval, "month", "months")} on ${joinWords(days.map(dayOfMonthLabel))}`;
  } else if (spec.pattern === "monthly_weekday") {
    text = `${everyLabel(spec.interval, "month", "months")} on the ${scheduleOrdinalLabel(spec.ordinal)} ${scheduleWeekdayName(spec.weekday)}`;
  } else {
    const months = sortedNumbers(spec.months).map(scheduleMonthName);
    const unit = spec.interval === 1 ? "Every year" : `Every ${spec.interval} years`;
    text = `${unit} on ${dayOfMonthLabel(spec.day)} of ${joinWords(months)}`;
  }
  return `${text}${endLabel(spec.end)}`;
}

/* ------------------------------------------------------------------ *
 * Reading a stored rule back.                                         *
 * ------------------------------------------------------------------ */

function ruleTokens(rule: string): Map<string, string> | null {
  const lines = rule.replace(/\r/g, "").trim().split("\n");
  const body = (lines.length === 2 && /^DTSTART/i.test(lines[0] ?? "") ? lines[1] : lines.length === 1 ? lines[0] : null) ?? null;
  if (!body) return null;
  const tokens = new Map<string, string>();
  for (const token of body.replace(/^RRULE:/i, "").split(";")) {
    const [key, value] = token.split("=", 2);
    if (!key || !value || tokens.has(key.toUpperCase())) return null;
    tokens.set(key.toUpperCase(), value.toUpperCase());
  }
  return tokens;
}

function parseEnd(tokens: Map<string, string>): ScheduleEnd | null {
  const count = tokens.get("COUNT");
  const until = tokens.get("UNTIL");
  if (count && until) return null;
  if (count) return /^[1-9]\d*$/.test(count) ? { type: "count", count: Number(count) } : null;
  if (until) {
    const match = /^(\d{4})(\d{2})(\d{2})/.exec(until);
    return match ? { type: "until", date: `${match[1]}-${match[2]}-${match[3]}` } : null;
  }
  return { type: "never" };
}

function weekdayOfDate(date: string): ScheduleWeekday {
  // getUTCDay: 0 is Sunday.
  return (["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const)[new Date(`${date}T00:00:00.000Z`).getUTCDay()]!;
}

/**
 * Reads a stored rule into a spec the form can show. A rule without an
 * explicit day (an older `FREQ=WEEKLY` or `FREQ=MONTHLY`) repeats on its start
 * date, so the start date fills the gap. Returns null for a rule the form
 * cannot represent; the caller keeps that rule unchanged.
 */
export function parseScheduleRule(rule: string | null | undefined, startsOn?: string | null): ScheduleSpec | null {
  if (!rule) return null;
  const tokens = ruleTokens(rule);
  if (!tokens) return null;
  const end = parseEnd(tokens);
  if (!end) return null;
  const known = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL", "WKST"]);
  if ([...tokens.keys()].some((key) => !known.has(key))) return null;
  const intervalText = tokens.get("INTERVAL") ?? "1";
  if (!/^[1-9]\d*$/.test(intervalText)) return null;
  const interval = Number(intervalText);
  const byDay = tokens.get("BYDAY");
  const byMonthDay = tokens.get("BYMONTHDAY");
  const byMonth = tokens.get("BYMONTH");
  const start = startsOn && validDate(startsOn) ? startsOn : null;
  const freq = tokens.get("FREQ");

  if (freq === "DAILY") {
    if (byDay || byMonthDay || byMonth) return null;
    return { pattern: "daily", interval, end };
  }
  if (freq === "WEEKLY") {
    if (byMonthDay || byMonth) return null;
    if (!byDay) return start ? { pattern: "weekly", interval, weekdays: [weekdayOfDate(start)], end } : null;
    const days = byDay.split(",");
    if (!days.every((day): day is ScheduleWeekday => (SCHEDULE_WEEKDAYS as readonly string[]).includes(day))) return null;
    return { pattern: "weekly", interval, weekdays: sortedWeekdays(days), end };
  }
  if (freq === "MONTHLY") {
    if (byMonth) return null;
    if (byDay && byMonthDay) return null;
    if (byDay) {
      const match = /^(-1|[1-4])(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay);
      if (!match) return null;
      return { pattern: "monthly_weekday", interval, ordinal: Number(match[1]) as ScheduleOrdinal, weekday: match[2] as ScheduleWeekday, end };
    }
    if (!byMonthDay) return start ? { pattern: "monthly_dates", interval, days: [Number(start.slice(8, 10))], end } : null;
    const days = byMonthDay.split(",").map(Number);
    if (days.some((day) => !Number.isInteger(day) || (day !== -1 && (day < 1 || day > 31)))) return null;
    return { pattern: "monthly_dates", interval, days: sortedNumbers(days), end };
  }
  if (freq === "YEARLY") {
    if (byDay) return null;
    const months = byMonth ? byMonth.split(",").map(Number) : start ? [Number(start.slice(5, 7))] : null;
    const day = byMonthDay ? Number(byMonthDay) : start ? Number(start.slice(8, 10)) : null;
    if (!months || day === null || byMonthDay?.includes(",")) return null;
    if (months.some((month) => !Number.isInteger(month) || month < 1 || month > 12) || !Number.isInteger(day) || day < 1 || day > 31) return null;
    return { pattern: "yearly", interval, months: sortedNumbers(months), day, end };
  }
  return null;
}

/** A readable sentence for any stored rule, or the rule itself when unreadable. */
export function describeScheduleRule(rule: string | null | undefined, startsOn?: string | null): string {
  const spec = parseScheduleRule(rule, startsOn);
  return spec ? describeScheduleSpec(spec) : (rule ?? "");
}

/**
 * The first business date a new schedule produces on or after the chosen start.
 *
 * A new template's first occurrence is created on its `starts_on`, so a "3rd
 * Saturday" schedule chosen on a Wednesday must start on the next 3rd
 * Saturday, not on that Wednesday. Re-anchoring on the first match keeps the
 * same dates (interval cycles are counted from that same week/month/year).
 */
export function firstScheduleDate(recurrenceRule: string, chosenStart: string): string | null {
  return recurrenceOccurrenceDates(recurrenceRule, chosenStart, chosenStart, 1)[0] ?? null;
}

/** The next `limit` business dates of a stored schedule, from `from` (default today). */
export function upcomingScheduleDates(
  recurrenceRule: string,
  startsOn: string | null | undefined,
  limit: number,
  from: Date | string = new Date(),
): string[] {
  try {
    return recurrenceOccurrenceDates(recurrenceRule, startsOn ?? undefined, kolkataDateKey(from), limit);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * The database's own rule grammar, mirrored.                          *
 * ------------------------------------------------------------------ */

/**
 * Mirrors `public.is_supported_task_rrule` (migration 0005) token for token,
 * so no form can offer a rule the save RPC would reject. pgTAP test
 * `0340_recurrence_builder_parity` runs the same corpus through the database.
 */
export function isSupportedTaskRrule(rule: string | null | undefined): boolean {
  const input = (rule ?? "").trim().replace(/\r/g, "");
  if (!input) return false;
  const lines = input.split("\n");
  let body: string;
  if (lines.length === 1) body = lines[0]!;
  else if (lines.length === 2 && /^DTSTART(;TZID=Asia\/Kolkata)?:[0-9]{8}T[0-9]{6}Z?$/.test(lines[0]!) && /^RRULE:/.test(lines[1]!)) body = lines[1]!;
  else return false;
  body = body.replace(/^RRULE:/i, "");
  if (!body) return false;
  const seen: string[] = [];
  for (const token of body.split(";")) {
    if (!/^[A-Z]+=.+/.test(token)) return false;
    const key = token.split("=", 1)[0]!;
    const value = token.slice(key.length + 1);
    if (seen.includes(key)) return false;
    seen.push(key);
    if (key === "FREQ") {
      if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value)) return false;
    } else if (key === "INTERVAL" || key === "COUNT") {
      if (!/^[1-9][0-9]*$/.test(value)) return false;
    } else if (key === "BYDAY") {
      if (!/^([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)(,([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU))*$/.test(value)) return false;
    } else if (key === "BYMONTHDAY" || key === "BYSETPOS") {
      for (const part of value.split(",")) {
        if (!/^-?[0-9]+$/.test(part)) return false;
        const number = Number(part);
        if (number === 0 || (key === "BYMONTHDAY" && Math.abs(number) > 31) || (key === "BYSETPOS" && Math.abs(number) > 366)) return false;
      }
    } else if (key === "BYMONTH") {
      for (const part of value.split(",")) {
        if (!/^[0-9]+$/.test(part) || Number(part) < 1 || Number(part) > 12) return false;
      }
    } else if (key === "UNTIL") {
      if (!/^[0-9]{8}(T[0-9]{6}Z?)?$/.test(value)) return false;
    } else if (key === "WKST") {
      if (!SCHEDULE_WEEKDAYS.includes(value as ScheduleWeekday)) return false;
    } else return false;
  }
  if (!seen.includes("FREQ")) return false;
  if (seen.includes("BYSETPOS") && !seen.includes("BYDAY")) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Ready-made choices for the form.                                    *
 * ------------------------------------------------------------------ */

export type SchedulePreset = Readonly<{ id: string; label: string; spec: (startsOn: string) => ScheduleSpec }>;

const never: ScheduleEnd = { type: "never" };

/**
 * One-tap schedules. Anything else is reached through the custom builder.
 * "Monday to Saturday" is named for what it is: JewelOS has no business
 * holiday calendar, and personal week-offs and leave are handled per employee
 * by coverage when each occurrence is created.
 */
export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  { id: "daily", label: "Every day", spec: () => ({ pattern: "daily", interval: 1, end: never }) },
  { id: "mon_sat", label: "Monday to Saturday", spec: () => ({ pattern: "weekly", interval: 1, weekdays: ["MO", "TU", "WE", "TH", "FR", "SA"], end: never }) },
  { id: "mon_fri", label: "Monday to Friday", spec: () => ({ pattern: "weekly", interval: 1, weekdays: ["MO", "TU", "WE", "TH", "FR"], end: never }) },
  { id: "weekly", label: "Every week on the start day", spec: (start) => ({ pattern: "weekly", interval: 1, weekdays: [weekdayOfDate(start)], end: never }) },
  { id: "monthly", label: "Every month on the start date", spec: (start) => ({ pattern: "monthly_dates", interval: 1, days: [Number(start.slice(8, 10))], end: never }) },
  { id: "third_saturday", label: "3rd Saturday of every month", spec: () => ({ pattern: "monthly_weekday", interval: 1, ordinal: 3, weekday: "SA", end: never }) },
  { id: "last_day", label: "Last day of every month", spec: () => ({ pattern: "monthly_dates", interval: 1, days: [-1], end: never }) },
  { id: "quarterly", label: "Every 3 months on the start date", spec: (start) => ({ pattern: "monthly_dates", interval: 3, days: [Number(start.slice(8, 10))], end: never }) },
  { id: "yearly", label: "Every year on the start date", spec: (start) => ({ pattern: "yearly", interval: 1, months: [Number(start.slice(5, 7))], day: Number(start.slice(8, 10)), end: never }) },
];

/** A spec rewritten for a different pattern, keeping what still applies. */
export function changeSchedulePattern(spec: ScheduleSpec, pattern: SchedulePattern, startsOn: string): ScheduleSpec {
  const base = { interval: spec.pattern === pattern ? spec.interval : 1, end: spec.end };
  const start = validDate(startsOn) ? startsOn : kolkataDateKey(new Date());
  if (pattern === "daily") return { pattern, ...base };
  if (pattern === "weekly") return { pattern, ...base, weekdays: spec.pattern === "weekly" ? spec.weekdays : [weekdayOfDate(start)] };
  if (pattern === "monthly_dates") return { pattern, ...base, days: spec.pattern === "monthly_dates" ? spec.days : [Number(start.slice(8, 10))] };
  if (pattern === "monthly_weekday") {
    if (spec.pattern === "monthly_weekday") return spec;
    const dayOfMonth = Number(start.slice(8, 10));
    const ordinal = (dayOfMonth > 28 ? -1 : Math.ceil(dayOfMonth / 7)) as ScheduleOrdinal;
    return { pattern, ...base, ordinal: ordinal > 4 ? -1 : ordinal, weekday: weekdayOfDate(start) };
  }
  return { pattern, ...base, months: spec.pattern === "yearly" ? spec.months : [Number(start.slice(5, 7))], day: spec.pattern === "yearly" ? spec.day : Number(start.slice(8, 10)) };
}

/** True when a chosen date of the month is skipped in shorter months. */
export function scheduleSkipsShortMonths(spec: ScheduleSpec): boolean {
  if (spec.pattern === "monthly_dates") return spec.days.some((day) => day >= 29);
  if (spec.pattern === "yearly") return spec.day >= 30 || (spec.day === 29 && spec.months.includes(2));
  return false;
}
