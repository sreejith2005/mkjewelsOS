import { zonedDateKey } from "../voiceDeadline.ts";

/**
 * Relative periods Kiara's tools accept ("today", "kal", "this week",
 * "is mahine", ...). The model picks a period name; the server turns it into
 * dates in the tenant's timezone (Asia/Kolkata), so a date is never guessed from
 * the model's own idea of "now". Weeks start on Monday, like the Dashboard
 * (`reporting_context_for_actor`, `normalizeDateRange`).
 */
export const KIARA_PERIODS = [
  "today",
  "yesterday",
  "tomorrow",
  "this_week",
  "last_week",
  "next_7_days",
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
] as const;
export type KiaraPeriod = (typeof KIARA_PERIODS)[number];

/** An inclusive local date range (YYYY-MM-DD). */
export type KiaraDateRange = Readonly<{ from: string; to: string }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addLocalDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(value: string): string {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay() || 7;
  return addLocalDays(value, 1 - day);
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function monthEnd(value: string): string {
  const date = new Date(`${monthStart(value)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return addLocalDays(date.toISOString().slice(0, 10), -1);
}

/** Today's local date in the tenant timezone. */
export function kiaraToday(now: Date, timeZone: string): string {
  return zonedDateKey(now, timeZone);
}

export function resolveKiaraPeriod(period: KiaraPeriod, now: Date, timeZone: string): KiaraDateRange {
  const today = kiaraToday(now, timeZone);
  switch (period) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: addLocalDays(today, -1), to: addLocalDays(today, -1) };
    case "tomorrow": return { from: addLocalDays(today, 1), to: addLocalDays(today, 1) };
    case "this_week": { const start = mondayOf(today); return { from: start, to: addLocalDays(start, 6) }; }
    case "last_week": { const start = addLocalDays(mondayOf(today), -7); return { from: start, to: addLocalDays(start, 6) }; }
    case "next_7_days": return { from: today, to: addLocalDays(today, 6) };
    case "this_month": return { from: monthStart(today), to: monthEnd(today) };
    case "last_month": { const previous = addLocalDays(monthStart(today), -1); return { from: monthStart(previous), to: previous }; }
    case "last_7_days": return { from: addLocalDays(today, -6), to: today };
    case "last_30_days": return { from: addLocalDays(today, -29), to: today };
  }
}

/**
 * The one way a tool's `period` text becomes a date range: a period name
 * ("tomorrow"), one date ("2026-10-10"), or a range ("2026-10-01..2026-10-07").
 * Nothing given means "not given" (`range: null`); each tool decides its own
 * default. A single text field keeps the strict tool schemas small.
 */
export type KiaraRangeResult = Readonly<{ ok: true; range: KiaraDateRange | null }> | Readonly<{ ok: false; error: string }>;

export const KIARA_PERIOD_HINT = `One of ${KIARA_PERIODS.join(", ")}; or a date YYYY-MM-DD; or a range YYYY-MM-DD..YYYY-MM-DD.`;

export function kiaraRangeFromInput(period: unknown, now: Date, timeZone: string, maxDays = 366): KiaraRangeResult {
  if (period === undefined || period === null) return { ok: true, range: null };
  if (typeof period !== "string") return { ok: false, error: `period must be text. ${KIARA_PERIOD_HINT}` };
  const value = period.trim().toLowerCase();
  if (!value) return { ok: true, range: null };
  if ((KIARA_PERIODS as readonly string[]).includes(value)) return { ok: true, range: resolveKiaraPeriod(value as KiaraPeriod, now, timeZone) };
  const [start, end = start, extra] = value.split("..").map((part) => part.trim());
  if (extra !== undefined || !isIsoDate(start) || !isIsoDate(end)) return { ok: false, error: `period is not understood. ${KIARA_PERIOD_HINT}` };
  if (end < start) return { ok: false, error: "The range ends before it starts." };
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > maxDays) return { ok: false, error: `The date range can be at most ${maxDays} days.` };
  return { ok: true, range: { from: start, to: end } };
}

/** Number of days in an inclusive range. */
export function kiaraRangeDays(range: KiaraDateRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
}
