/**
 * MK Jewels business-day deadlines (owner decision 2026-11-03).
 *
 * The working day has two halves, each with one fixed deadline in India time:
 *   First half  -> 3:00 PM (15:00)
 *   Second half -> 9:00 PM (21:00)
 *
 * Work that has no usable deadline of its own takes the next half-day deadline
 * after the moment it became actionable: before 3:00 PM it is due 9:00 PM the
 * same day; from 3:00 PM on it is due 3:00 PM the next day.
 *
 * The database is authoritative: `day_half_deadline(timestamptz)` in migration
 * 0371 implements the same rule and the server stores the result. This module
 * mirrors it for import previews, labels and tests. Keep both in step
 * (dayHalfDeadline.migration.test.ts checks the constants).
 */

export const DAY_HALF_TIME_ZONE = "Asia/Kolkata";
export type DayHalf = "first_half" | "second_half";

/** Fixed business settings, not editable presets. HH:MM, 24-hour, India time. */
export const DAY_HALF_DUE_TIMES: Readonly<Record<DayHalf, string>> = {
  first_half: "15:00",
  second_half: "21:00",
};

export const DAY_HALF_LABELS: Readonly<Record<DayHalf, string>> = {
  first_half: "First half",
  second_half: "Second half",
};

const DUE_TIME_LABELS: Readonly<Record<DayHalf, string>> = {
  first_half: "3:00 PM",
  second_half: "9:00 PM",
};

// India has no daylight saving time, so its offset is fixed at +05:30.
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/** The instant of `HH:MM` India time on the India calendar day `dayNumber` (days since epoch). */
function istInstant(dayNumber: number, time: string): Date {
  return new Date(dayNumber * DAY_MS + minutesOf(time) * 60_000 - IST_OFFSET_MS);
}

export type DayHalfDeadline = Readonly<{
  dueAt: string;
  half: DayHalf;
  /** The India calendar day of the deadline, YYYY-MM-DD. */
  dueDate: string;
}>;

/**
 * The half-day deadline for work that became actionable at `reference`
 * (server time; any client timezone gives the same answer).
 */
export function dayHalfDeadlineAfter(reference: Date | string): DayHalfDeadline {
  const at = typeof reference === "string" ? new Date(reference) : reference;
  if (Number.isNaN(at.getTime())) throw new Error("Reference time is invalid");
  const local = at.getTime() + IST_OFFSET_MS;
  const dayNumber = Math.floor(local / DAY_MS);
  const minuteOfDay = Math.floor((local - dayNumber * DAY_MS) / 60_000);
  const beforeFirstHalfDeadline = minuteOfDay < minutesOf(DAY_HALF_DUE_TIMES.first_half);
  const half: DayHalf = beforeFirstHalfDeadline ? "second_half" : "first_half";
  const dueDay = beforeFirstHalfDeadline ? dayNumber : dayNumber + 1;
  const due = istInstant(dueDay, DAY_HALF_DUE_TIMES[half]);
  return { dueAt: due.toISOString(), half, dueDate: new Date(dueDay * DAY_MS).toISOString().slice(0, 10) };
}

/** The half a stored deadline belongs to, when it sits exactly on 3:00 PM or 9:00 PM India time. */
export function dayHalfOfDeadline(dueAt: string | null | undefined): DayHalf | null {
  if (!dueAt) return null;
  const at = new Date(dueAt);
  if (Number.isNaN(at.getTime())) return null;
  const local = at.getTime() + IST_OFFSET_MS;
  const msOfDay = ((local % DAY_MS) + DAY_MS) % DAY_MS;
  if (msOfDay === minutesOf(DAY_HALF_DUE_TIMES.first_half) * 60_000) return "first_half";
  if (msOfDay === minutesOf(DAY_HALF_DUE_TIMES.second_half) * 60_000) return "second_half";
  return null;
}

/** "First half · 3:00 PM" */
export function describeDayHalf(half: DayHalf): string {
  return `${DAY_HALF_LABELS[half]} · ${DUE_TIME_LABELS[half]}`;
}

const FIRST = String.raw`(?:first|1st|1)`;
const SECOND = String.raw`(?:second|2nd|2)`;
const HALF = String.raw`[\s_-]*half(?:[\s_-]*(?:of[\s_-]*(?:the[\s_-]*)?day|day))?`;
const FIRST_HALF = new RegExp(String.raw`^${FIRST}${HALF}$`);
const SECOND_HALF = new RegExp(String.raw`^${SECOND}${HALF}$`);

/**
 * Reads an unambiguous first/second half label ("First Half", "1st half",
 * "FIRST-HALF", "second half of the day", "2nd Half"). Anything else, including
 * Opening, Closing, Morning, Evening, General and Manual, is not a half.
 */
export function parseDayHalfLabel(raw: string): DayHalf | null {
  const text = raw.normalize("NFKC").toLocaleLowerCase("en-IN").replace(/[()[\]]/g, " ").trim().replace(/\s+/g, " ");
  if (FIRST_HALF.test(text)) return "first_half";
  if (SECOND_HALF.test(text)) return "second_half";
  return null;
}
