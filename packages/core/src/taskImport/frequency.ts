import type { ImportScheduleKind, TaskImportDestination } from "../taskImport";

export type TaskImportTimingPresetKey = "general" | "opening" | "morning" | "closing" | "evening" | "manual";
export type TaskImportTimeWindow = Readonly<{ startTime: string; dueTime: string }>;
export type TaskImportTimingPresets = Readonly<Partial<Record<TaskImportTimingPresetKey, TaskImportTimeWindow>>>;

export type TaskImportFrequencyPlan = Readonly<{
  scheduleKind: ImportScheduleKind;
  destination: TaskImportDestination;
  recurrenceRule: string;
  startTimingPreset: TaskImportTimingPresetKey;
  dueTimingPreset: TaskImportTimingPresetKey;
  generatedCheckpoints: readonly string[];
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
  "throughout day",
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

export function normalizeTaskFrequencyLabel(raw: string): string {
  return raw.normalize("NFKC")
    .replace(/\s*[\u2013\u2014]\s*/g, " - ")
    .replace(/\u00d7/g, "x")
    .trim()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+-\s+/g, " - ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-IN");
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
  if (frequency === "2x daily") return plan("daily", "FREQ=DAILY", "general", "general", numberedCheckpoints(2, title));
  if (frequency === "3x daily") return plan("daily", "FREQ=DAILY", "general", "general", numberedCheckpoints(3, title));
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
  throw new Error("Unsupported frequency");
}
