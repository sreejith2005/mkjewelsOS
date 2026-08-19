import * as rruleNamespace from "rrule";

const compatibleRRule = rruleNamespace as typeof rruleNamespace & {
  default?: typeof rruleNamespace;
};
const rrulestr = compatibleRRule.rrulestr ?? compatibleRRule.default?.rrulestr;

if (!rrulestr) throw new Error("rrule parser is unavailable");

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KOLKATA_TIME_ZONE = "Asia/Kolkata";

export type RecurringAvailabilityProfile = {
  buddy_id: string | null;
  id: string;
  week_off: readonly string[];
  working_status: string;
};

export type RecurringAssignment = {
  effective_assignee_id: string | null;
  original_assignee_id: string;
  resolution: "assigned" | "blocked" | "buddy";
};

function assertDateOnly(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Target date is invalid");
  }
  return value;
}

/** Returns the calendar date for an instant in JewelOS's business timezone. */
export function kolkataDateKey(value: Date | string): string {
  if (typeof value === "string" && DATE_ONLY_PATTERN.test(value)) return assertDateOnly(value);
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime())) throw new Error("Target date is invalid");
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: KOLKATA_TIME_ZONE,
    year: "numeric",
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function recurrenceDayBounds(date: Date | string): { end: Date; start: Date } {
  const dateKey = kolkataDateKey(date);
  // Asia/Kolkata has no daylight-saving transitions, so its business-day
  // window is a stable UTC+05:30 interval for both floating and explicit rules.
  const start = new Date(`${dateKey}T00:00:00.000+05:30`);
  return { start, end: new Date(start.getTime() + 86_400_000 - 1) };
}

function normalizeRule(recurrenceRule: string): string {
  const trimmed = recurrenceRule.trim();
  if (!trimmed) throw new Error("recurrence_rule is required");
  if (/^DTSTART(?:;|:)/im.test(trimmed)) return trimmed;
  return `DTSTART:19700101T000000Z\nRRULE:${trimmed.replace(/^RRULE:/i, "")}`;
}

function weekdayName(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: KOLKATA_TIME_ZONE,
    weekday: "long",
  }).format(new Date(`${kolkataDateKey(date)}T12:00:00.000Z`)).toLowerCase();
}

export function isUserAvailableForRecurringTask(
  profile: RecurringAvailabilityProfile | undefined,
  availabilityStatus: string | null | undefined,
  targetDate: Date | string,
): boolean {
  if (!profile || profile.working_status !== "active" || availabilityStatus === "absent") return false;
  const weekday = weekdayName(targetDate);
  return !profile.week_off.some((day) => day.trim().toLowerCase() === weekday);
}

export function resolveRecurringAssignment(
  original: RecurringAvailabilityProfile,
  buddy: RecurringAvailabilityProfile | undefined,
  availabilityByUser: ReadonlyMap<string, string>,
  targetDate: Date | string,
): RecurringAssignment {
  if (isUserAvailableForRecurringTask(original, availabilityByUser.get(original.id), targetDate)) {
    return {
      effective_assignee_id: original.id,
      original_assignee_id: original.id,
      resolution: "assigned",
    };
  }
  if (buddy && isUserAvailableForRecurringTask(buddy, availabilityByUser.get(buddy.id), targetDate)) {
    return {
      effective_assignee_id: buddy.id,
      original_assignee_id: original.id,
      resolution: "buddy",
    };
  }
  return {
    effective_assignee_id: null,
    original_assignee_id: original.id,
    resolution: "blocked",
  };
}

/** Returns true when an RFC 5545 recurrence occurs on the Asia/Kolkata date. */
export function shouldGenerateRecurringTask(
  recurrenceRule: string,
  targetDate: Date | string,
): boolean {
  const { start, end } = recurrenceDayBounds(targetDate);
  const recurrence = rrulestr(normalizeRule(recurrenceRule), { forceset: true });
  return recurrence.between(start, end, true).length > 0;
}
