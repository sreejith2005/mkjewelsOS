import * as rruleNamespace from "rrule";
import {
  isCoverageCandidateAvailable,
  resolveTaskCoverage,
  type TaskCoverageProfile,
  type TaskCoverageResolution,
} from "./taskCoverage.ts";

const compatibleRRule = rruleNamespace as typeof rruleNamespace & {
  default?: typeof rruleNamespace;
};
const rrulestr = compatibleRRule.rrulestr ?? compatibleRRule.default?.rrulestr;

if (!rrulestr) throw new Error("rrule parser is unavailable");

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KOLKATA_TIME_ZONE = "Asia/Kolkata";

export type RecurringAvailabilityProfile = TaskCoverageProfile & {
  buddy_id: string | null;
  reports_to_user_id: string | null;
  secondary_buddy_id: string | null;
};

export type RecurringAssignment = {
  effective_assignee_id: string | null;
  original_assignee_id: string;
  resolution: TaskCoverageResolution;
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

function normalizeRule(recurrenceRule: string, startsOn?: string): string {
  const trimmed = recurrenceRule.trim();
  if (!trimmed) throw new Error("recurrence_rule is required");
  if (/^DTSTART(?:;|:)/im.test(trimmed)) return trimmed;
  const anchor = startsOn ? assertDateOnly(startsOn).replaceAll("-", "") : "19700101";
  return `DTSTART:${anchor}T000000Z\nRRULE:${trimmed.replace(/^RRULE:/i, "")}`;
}

export function isUserAvailableForRecurringTask(
  profile: RecurringAvailabilityProfile | undefined,
  availabilityStatus: string | null | undefined,
  targetDate: Date | string,
): boolean {
  return isCoverageCandidateAvailable(profile, availabilityStatus, targetDate);
}

export function resolveRecurringAssignment(
  original: RecurringAvailabilityProfile,
  buddy: RecurringAvailabilityProfile | undefined,
  availabilityByUser: ReadonlyMap<string, string>,
  targetDate: Date | string,
): RecurringAssignment {
  const decision = resolveTaskCoverage({ availabilityByUser, original, primary: buddy, targetDate });
  return {
    effective_assignee_id: decision.effectiveAssigneeId,
    original_assignee_id: decision.originalAssigneeId,
    resolution: decision.resolution,
  };
}

/** Returns true when an RFC 5545 recurrence occurs on the Asia/Kolkata date. */
export function shouldGenerateRecurringTask(
  recurrenceRule: string,
  targetDate: Date | string,
  startsOn?: string,
): boolean {
  if (startsOn && kolkataDateKey(targetDate) < assertDateOnly(startsOn)) return false;
  const { start, end } = recurrenceDayBounds(targetDate);
  const recurrence = rrulestr(normalizeRule(recurrenceRule, startsOn), { forceset: true });
  return recurrence.between(start, end, true).length > 0;
}
