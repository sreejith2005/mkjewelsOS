import { DATE_RANGE_PRESETS, type DateRange, type DateRangePreset } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function localDateAt(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function mondayOf(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  return addDays(value, 1 - day);
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function nextMonth(value: string): string {
  const date = new Date(`${value.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return isoDate(date).slice(0, 7) + "-01";
}

export function normalizeDateRange(input: Readonly<{
  preset?: string;
  from?: string;
  to?: string;
  timezone: string;
  now?: Date;
}>): DateRange {
  const preset = (input.preset ?? "today") as DateRangePreset;
  if (!DATE_RANGE_PRESETS.includes(preset)) throw new Error("Unknown date range preset");
  const today = localDateAt(input.now ?? new Date(), input.timezone);
  let localStart = today;
  let localEndExclusive = addDays(today, 1);
  if (preset === "this_week") {
    localStart = mondayOf(today);
    localEndExclusive = addDays(localStart, 7);
  } else if (preset === "this_month") {
    localStart = monthStart(today);
    localEndExclusive = nextMonth(today);
  } else if (preset === "last_7_days") {
    localStart = addDays(today, -6);
  } else if (preset === "last_30_days") {
    localStart = addDays(today, -29);
  } else if (preset === "custom") {
    if (!input.from || !input.to || !ISO_DATE.test(input.from) || !ISO_DATE.test(input.to)) throw new Error("Custom range requires valid from and to dates");
    localStart = input.from;
    localEndExclusive = addDays(input.to, 1);
  }
  const duration = (Date.parse(`${localEndExclusive}T00:00:00Z`) - Date.parse(`${localStart}T00:00:00Z`)) / 86_400_000;
  if (duration < 1 || duration > 366) throw new Error("Date range must be between 1 and 366 days");
  return { preset, localStart, localEndExclusive, timezone: input.timezone };
}

export function previousPeriod(range: DateRange): DateRange {
  const duration = Math.round((Date.parse(`${range.localEndExclusive}T00:00:00Z`) - Date.parse(`${range.localStart}T00:00:00Z`)) / 86_400_000);
  return {
    ...range,
    preset: "custom",
    localStart: addDays(range.localStart, -duration),
    localEndExclusive: range.localStart,
  };
}
