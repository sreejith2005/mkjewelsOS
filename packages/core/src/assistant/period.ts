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

export type KiaraRangeInput = Readonly<{ period?: unknown; from?: unknown; to?: unknown }>;
export type KiaraRangeResult = Readonly<{ ok: true; range: KiaraDateRange | null }> | Readonly<{ ok: false; error: string }>;

/**
 * The one way a tool input becomes a date range: a named period, or explicit
 * `from`/`to` dates (either may be given alone for a single day), never both.
 * No period and no dates means "not given" (`range: null`); each tool decides
 * its own default.
 */
export function kiaraRangeFromInput(input: KiaraRangeInput, now: Date, timeZone: string, maxDays = 366): KiaraRangeResult {
  const { period, from, to } = input;
  if (period !== undefined && period !== null) {
    if (from !== undefined || to !== undefined) return { ok: false, error: "Give either period or from/to dates, not both." };
    if (typeof period !== "string" || !(KIARA_PERIODS as readonly string[]).includes(period)) return { ok: false, error: "period must be one of the listed periods." };
    return { ok: true, range: resolveKiaraPeriod(period as KiaraPeriod, now, timeZone) };
  }
  if (from === undefined && to === undefined) return { ok: true, range: null };
  if (from !== undefined && !isIsoDate(from)) return { ok: false, error: "from must be a date (YYYY-MM-DD)." };
  if (to !== undefined && !isIsoDate(to)) return { ok: false, error: "to must be a date (YYYY-MM-DD)." };
  const start = (from ?? to) as string;
  const end = (to ?? from) as string;
  if (end < start) return { ok: false, error: "to must not be before from." };
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > maxDays) return { ok: false, error: `The date range can be at most ${maxDays} days.` };
  return { ok: true, range: { from: start, to: end } };
}

/** Number of days in an inclusive range. */
export function kiaraRangeDays(range: KiaraDateRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
}
