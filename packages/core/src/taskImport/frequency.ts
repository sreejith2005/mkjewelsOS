import type { ImportScheduleKind, TaskImportDestination } from "../taskImport";
import {
  buildScheduleRule,
  firstScheduleDate,
  type ScheduleOrdinal,
  type ScheduleSpec,
  type ScheduleWeekday,
} from "../recurrenceBuilder";

export type TaskImportTimingPresetKey = "general" | "opening" | "morning" | "closing" | "evening" | "manual";
export type TaskImportTimeWindow = Readonly<{ startTime: string; dueTime: string }>;
export type TaskImportTimingPresets = Readonly<Partial<Record<TaskImportTimingPresetKey, TaskImportTimeWindow>>>;

const DEFAULT_WINDOWS: Readonly<Record<TaskImportTimingPresetKey, TaskImportTimeWindow>> = {
  general: { startTime: "11:00", dueTime: "13:00" },
  opening: { startTime: "11:00", dueTime: "13:00" },
  morning: { startTime: "11:00", dueTime: "13:00" },
  closing: { startTime: "18:00", dueTime: "20:00" },
  evening: { startTime: "18:00", dueTime: "20:00" },
  manual: { startTime: "11:00", dueTime: "20:00" },
};

export function createDefaultTaskImportTimingPresets(): TaskImportTimingPresets {
  return {
    general: { ...DEFAULT_WINDOWS.general },
    opening: { ...DEFAULT_WINDOWS.opening },
    morning: { ...DEFAULT_WINDOWS.morning },
    closing: { ...DEFAULT_WINDOWS.closing },
    evening: { ...DEFAULT_WINDOWS.evening },
    manual: { ...DEFAULT_WINDOWS.manual },
  };
}

export type TaskImportFrequencyPlan = Readonly<{
  scheduleKind: ImportScheduleKind;
  destination: TaskImportDestination;
  recurrenceRule: string;
  startTimingPreset: TaskImportTimingPresetKey;
  dueTimingPreset: TaskImportTimingPresetKey;
  generatedCheckpoints: readonly string[];
  /**
   * Set only for frequencies read by the shared schedule builder: the row's
   * first occurrence moves to the first date the rule actually produces (a
   * "3rd Saturday" row starting on a Wednesday starts on the next 3rd
   * Saturday), exactly as Create Task does. Older labels never carry it, so
   * their replay fingerprints are unchanged.
   */
  anchorStart?: true;
}>;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

const DAILY = new Set([
  "daily",
  "daily - t-1",
  "daily/ongoing",
  "daily/as required",
  "daily/as assigned",
  "daily/as posted",
  "daily/as scheduled",
  "daily/per refill",
  "daily/weekly",
  "daily/monthly",
]);

const WEEKLY_ANCHORED = new Set(["weekly", "weekly/as required", "weekly/as scheduled"]);
const MONTHLY_ANCHORED = new Set(["monthly", "monthly/as required", "monthly/as scheduled"]);
const MANUAL = new Set([
  "",
  "as required",
  "as required/ongoing",
  "as scheduled",
  "as assigned",
  "as applicable",
  "ongoing",
  "campaign-based",
  "shoot days",
  "per customer",
  "per customer/as applicable",
  "per lead",
  "per product",
  "per not-bought customer",
  "per receipt",
  "per call",
  "per enquiry",
  "per visit",
  "per refill",
  "per piece/batch",
  "per job",
  "per issue",
  "per bag",
  "per lost lead",
  "per parcel",
  "per cam piece",
  "per prospect",
  "per follow-up",
  "per interaction",
  "per movement",
  "per video call",
  "after serving",
  "after customer visit",
  "after shoot",
  "after event",
  "after visit",
  "per order",
  "as needed",
  "on demand",
]);

function dateParts(value: string) {
  const match = DATE.exec(value);
  if (!match) throw new Error("Start date must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error("Start date is invalid");
  }
  return { date, month, day };
}

function readableFrequencyLabel(raw: string): string {
  return raw
    .replace(/\u00e2\u0080\u0093/g, "\u2013")
    .replace(/\u00e2\u0080\u0094/g, "\u2014")
    .replace(/\u00c3\u0097/g, "\u00d7")
    .normalize("NFKC")
    .replace(/\s*[\u2013\u2014]\s*/g, " - ")
    .replace(/\u00d7/g, "x")
    .trim()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+-\s+/g, " - ")
    .replace(/\s+/g, " ");
}

export function normalizeTaskFrequencyLabel(raw: string): string {
  return readableFrequencyLabel(raw).toLocaleLowerCase("en-IN");
}

/** Longest trigger label `task_templates.trigger_label` accepts. */
export const TASK_TRIGGER_LABEL_MAX = 80;

/**
 * The sheet's own wording for event-driven work ("Per Customer", "After Visit"),
 * kept so an employee knows when an on-demand duty applies. Scheduled work and
 * a blank frequency cell have no trigger label.
 */
export function taskImportTriggerLabel(raw: string, scheduleKind: ImportScheduleKind): string {
  if (scheduleKind !== "as_required") return "";
  return readableFrequencyLabel(raw).slice(0, TASK_TRIGGER_LABEL_MAX).trim();
}

export function buildImportSchedule(kind: ImportScheduleKind, startsOn: string) {
  if (kind === "one_time") return { destination: "tasks" as const, recurrenceRule: "" };
  if (kind === "as_required") return { destination: "recurring_todo" as const, recurrenceRule: "FREQ=DAILY" };
  const { date, month, day } = dateParts(startsOn);
  const recurrenceRule = kind === "daily" ? "FREQ=DAILY"
    : kind === "weekly" ? `FREQ=WEEKLY;BYDAY=${WEEKDAYS[date.getUTCDay()]}`
    : kind === "monthly" ? `FREQ=MONTHLY;BYMONTHDAY=${day}`
    : kind === "quarterly" ? `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${day}`
    : `FREQ=YEARLY;BYMONTH=${month};BYMONTHDAY=${day}`;
  return { destination: "recurring_todo" as const, recurrenceRule };
}

function plan(
  scheduleKind: ImportScheduleKind,
  recurrenceRule: string,
  startTimingPreset: TaskImportTimingPresetKey,
  dueTimingPreset: TaskImportTimingPresetKey,
  generatedCheckpoints: readonly string[] = [],
): TaskImportFrequencyPlan {
  return {
    scheduleKind,
    destination: scheduleKind === "one_time" ? "tasks" : "recurring_todo",
    recurrenceRule,
    startTimingPreset,
    dueTimingPreset,
    generatedCheckpoints,
  };
}

function numberedCheckpoints(count: number, title: string): readonly string[] {
  return Array.from({ length: count }, (_, index) => `Checkpoint ${index + 1}: ${title}`);
}

export function planTaskImportFrequency(raw: string, startsOn: string, title: string): TaskImportFrequencyPlan {
  const frequency = normalizeTaskFrequencyLabel(raw);
  if (MANUAL.has(frequency)) return plan("as_required", "FREQ=DAILY", "manual", "manual");
  if (frequency === "once" || frequency === "one time") return plan("one_time", "", "general", "general");
  if (DAILY.has(frequency)) return plan("daily", "FREQ=DAILY", "general", "general");
  if (frequency === "daily - opening") return plan("daily", "FREQ=DAILY", "opening", "opening");
  if (frequency === "daily - morning") return plan("daily", "FREQ=DAILY", "morning", "morning");
  if (frequency === "daily - closing") return plan("daily", "FREQ=DAILY", "closing", "closing");
  if (frequency === "throughout day") return plan("daily", "FREQ=DAILY", "opening", "closing");
  if (frequency === "2x daily") return plan("daily", "FREQ=DAILY", "opening", "closing", numberedCheckpoints(2, title));
  if (frequency === "3x daily") return plan("daily", "FREQ=DAILY", "opening", "closing", numberedCheckpoints(3, title));
  if (frequency === "morning & evening") return plan("daily", "FREQ=DAILY", "morning", "evening", [`Morning: ${title}`, `Evening: ${title}`]);
  if (frequency === "morning & closing") return plan("daily", "FREQ=DAILY", "morning", "closing", [`Morning: ${title}`, `Closing: ${title}`]);
  if (WEEKLY_ANCHORED.has(frequency)) {
    const schedule = buildImportSchedule("weekly", startsOn);
    return plan("weekly", schedule.recurrenceRule, "general", "general");
  }
  if (frequency === "every monday") return plan("weekly", "FREQ=WEEKLY;BYDAY=MO", "general", "general");
  if (frequency === "sunday") return plan("weekly", "FREQ=WEEKLY;BYDAY=SU", "general", "general");
  if (frequency === "monday & thursday" || frequency === "monday & thursday/as required") {
    return plan("weekly", "FREQ=WEEKLY;BYDAY=MO,TH", "general", "general");
  }
  if (MONTHLY_ANCHORED.has(frequency)) {
    const schedule = buildImportSchedule("monthly", startsOn);
    return plan("monthly", schedule.recurrenceRule, "general", "general");
  }
  if (frequency === "1st monthly" || frequency === "1st week monthly") return plan("monthly", "FREQ=MONTHLY;BYMONTHDAY=1", "general", "general");
  if (frequency === "7th monthly") return plan("monthly", "FREQ=MONTHLY;BYMONTHDAY=7", "general", "general");
  if (frequency === "13th monthly") return plan("monthly", "FREQ=MONTHLY;BYMONTHDAY=13", "general", "general");
  if (frequency === "monthly - 1st to 5th") return plan("monthly", "FREQ=MONTHLY;BYMONTHDAY=1,2,3,4,5", "general", "general");
  if (frequency === "every 15 days") return plan("daily", "FREQ=DAILY;INTERVAL=15", "general", "general");
  if (frequency === "quarterly") {
    const schedule = buildImportSchedule("quarterly", startsOn);
    return plan("quarterly", schedule.recurrenceRule, "general", "general");
  }
  if (frequency === "annual" || frequency === "yearly") {
    const schedule = buildImportSchedule("yearly", startsOn);
    return plan("yearly", schedule.recurrenceRule, "general", "general");
  }
  const advanced = planScheduledFrequency(frequency, startsOn);
  if (advanced) {
    const { recurrenceRule, scheduleKind } = buildScheduleRule(advanced);
    return { ...plan(scheduleKind, recurrenceRule, "general", "general"), anchorStart: true };
  }
  throw new Error("Unsupported frequency");
}

/**
 * The start date a scheduled row is stored with. Rows read by the shared
 * builder start on their first real date; every older label keeps the date the
 * sheet gave it.
 */
export function taskImportScheduledStart(plan: TaskImportFrequencyPlan, startsOn: string): string {
  if (!plan.anchorStart || !DATE.test(startsOn)) return startsOn;
  try {
    return firstScheduleDate(plan.recurrenceRule, startsOn) ?? startsOn;
  } catch {
    return startsOn;
  }
}

const WEEKDAY_WORDS: Readonly<Record<string, ScheduleWeekday>> = {
  monday: "MO", mon: "MO", mondays: "MO",
  tuesday: "TU", tue: "TU", tues: "TU", tuesdays: "TU",
  wednesday: "WE", wed: "WE", wednesdays: "WE",
  thursday: "TH", thu: "TH", thur: "TH", thurs: "TH", thursdays: "TH",
  friday: "FR", fri: "FR", fridays: "FR",
  saturday: "SA", sat: "SA", saturdays: "SA",
  sunday: "SU", sun: "SU", sundays: "SU",
};
const WEEKDAY_PATTERN = Object.keys(WEEKDAY_WORDS).sort((left, right) => right.length - left.length).join("|");
const ORDINAL_WORDS: Readonly<Record<string, ScheduleOrdinal>> = {
  "1st": 1, first: 1, "2nd": 2, second: 2, "3rd": 3, third: 3, "4th": 4, fourth: 4, last: -1,
};
const MONTH_SUFFIX = String.raw`(?:\s+(?:monthly|every month|of every month|of each month|of the month|of month))?`;
const never = { type: "never" } as const;

function startParts(startsOn: string) {
  const { date, month, day } = dateParts(startsOn);
  return { weekday: WEEKDAYS[date.getUTCDay()] as ScheduleWeekday, month, day };
}

/**
 * Calendar frequencies beyond the original sheet vocabulary, read into the
 * same `ScheduleSpec` the Create Task builder saves. A label not recognised
 * here is still rejected by the caller; nothing falls back to daily.
 */
function planScheduledFrequency(frequency: string, startsOn: string): ScheduleSpec | null {
  const unit = (word: string) => word.replace(/s$/, "");
  const every = /^every (\d{1,2}|other) (days?|weeks?|months?|years?)$/.exec(frequency) ?? /^every (day|week|month|year)$/.exec(frequency);
  if (every) {
    const interval = every.length === 3 ? (every[1] === "other" ? 2 : Number(every[1])) : 1;
    const period = unit(every.length === 3 ? every[2]! : every[1]!);
    if (interval < 1 || interval > 99) return null;
    const start = startParts(startsOn);
    if (period === "day") return { pattern: "daily", interval, end: never };
    if (period === "week") return { pattern: "weekly", interval, weekdays: [start.weekday], end: never };
    if (period === "month") return { pattern: "monthly_dates", interval, days: [start.day], end: never };
    return { pattern: "yearly", interval, months: [start.month], day: start.day, end: never };
  }
  if (frequency === "fortnightly") return { pattern: "weekly", interval: 2, weekdays: [startParts(startsOn).weekday], end: never };
  if (["half yearly", "half-yearly", "semi-annual", "semi-annually", "every 6 months"].includes(frequency)) {
    return { pattern: "monthly_dates", interval: 6, days: [startParts(startsOn).day], end: never };
  }
  if (frequency === "every quarter") return { pattern: "monthly_dates", interval: 3, days: [startParts(startsOn).day], end: never };
  if (["last day of month", "last day of the month", "last day of every month", "month end", "month-end", "end of month", "monthly - last day", "last day monthly"].includes(frequency)) {
    return { pattern: "monthly_dates", interval: 1, days: [-1], end: never };
  }

  const range = new RegExp(`^(?:every )?(${WEEKDAY_PATTERN}) ?(?:to|-) ?(${WEEKDAY_PATTERN})$`).exec(frequency);
  if (range) {
    const order = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
    const from = order.indexOf(WEEKDAY_WORDS[range[1]!]!);
    const to = order.indexOf(WEEKDAY_WORDS[range[2]!]!);
    if (from < to) return { pattern: "weekly", interval: 1, weekdays: order.slice(from, to + 1), end: never };
    return null;
  }

  const list = new RegExp(`^(?:every )?((?:${WEEKDAY_PATTERN})(?:\\s*(?:,|&|and)\\s*(?:${WEEKDAY_PATTERN}))*)$`).exec(frequency);
  if (list) {
    const weekdays = list[1]!.split(/\s*(?:,|&|\band\b)\s*/).map((word) => WEEKDAY_WORDS[word.trim()]).filter((day): day is ScheduleWeekday => Boolean(day));
    return weekdays.length ? { pattern: "weekly", interval: 1, weekdays, end: never } : null;
  }

  const ordinal = new RegExp(`^(?:every |the )?(1st|2nd|3rd|4th|first|second|third|fourth|last) (${WEEKDAY_PATTERN})${MONTH_SUFFIX}$`).exec(frequency);
  if (ordinal) return { pattern: "monthly_weekday", interval: 1, ordinal: ORDINAL_WORDS[ordinal[1]!]!, weekday: WEEKDAY_WORDS[ordinal[2]!]!, end: never };

  const monthDate = /^(\d{1,2})(?:st|nd|rd|th)(?: of)? (?:monthly|every month|each month|the month|month)$/.exec(frequency);
  if (monthDate) {
    const day = Number(monthDate[1]);
    return day >= 1 && day <= 31 ? { pattern: "monthly_dates", interval: 1, days: [day], end: never } : null;
  }
  return null;
}
