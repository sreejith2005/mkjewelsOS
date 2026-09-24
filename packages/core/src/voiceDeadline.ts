/**
 * Spoken task deadlines ("next Monday", "second week of next month at 3 pm")
 * turned into one validated instant.
 *
 * The extraction model only reports the words that were said. This module is
 * the single interpretation of those words, so web and native always show the
 * same deadline for the same note. It never trusts a model for calendar maths:
 * everything is computed from one reference instant in the tenant's timezone.
 *
 * Product rules (each one pinned by `voiceDeadline.test.ts`):
 *
 * - A week runs Monday to Sunday.
 * - "next <weekday>" is that weekday in next week. "<weekday>" or "coming
 *   <weekday>" is the next occurrence after today (today excluded). "this
 *   <weekday>" is that day in the current week; if it has already passed, the
 *   note is ambiguous and the author confirms.
 * - Week N of a month is the Monday-Sunday week that starts on that month's
 *   Nth Monday; the last week starts on its last Monday. "Friday of the second
 *   week" is that week's Friday.
 * - A week, weekend or month on its own ("next week", "this weekend",
 *   "second week of next month") names several days. It is reported as a range
 *   and the author picks the day - a date is never invented for it.
 * - Beginning/start, middle and end of a month are its 1st, 15th and last day.
 *   Start of a week is Monday, end of a week is Sunday.
 * - "in N days/weeks/months" counts calendar days from today; a month step
 *   keeps the day number, clamped to the month's last day.
 * - A date without a year takes the nearest occurrence (this year or next).
 *   Numeric dates are day/month/year, as written in India.
 * - With no spoken time the deadline is 7:00 PM local time. Part-of-day words
 *   alone mean morning 10:00 AM, noon 12:00 PM, afternoon 3:00 PM, evening,
 *   night and tonight 7:00 PM, midnight 11:59 PM. A bare hour without am/pm
 *   means 1-7 PM or 8-11 AM (shop hours); 12 is noon.
 * - A deadline that is already past, further than a year away, or not a real
 *   date is never filled in.
 */

export const VOICE_DEADLINE_DEFAULT_TIME = "19:00";
const DEFAULT_MINUTES = 19 * 60;
export const VOICE_DEADLINE_DEFAULT_TIME_ZONE = "Asia/Kolkata";
/** Further out than this is more likely a mishearing than a deadline. */
const MAX_DAYS_AHEAD = 366;

export type VoiceDeadlineStatus =
  /** One exact instant; the composer is prefilled. */
  | "resolved"
  /** No day was said. */
  | "missing"
  /** Words were said but do not identify one day (a range, an unclear phrase). */
  | "ambiguous"
  /** Not a real date or time ("31 September", "15 pm"). */
  | "invalid"
  /** Resolves to a moment that has already passed. */
  | "past";

export type VoiceDeadline = Readonly<{
  status: VoiceDeadlineStatus;
  /** The deadline words exactly as extracted, kept for review and diagnosis. */
  dateExpression: string | null;
  timeExpression: string | null;
  hasExplicitDate: boolean;
  hasExplicitTime: boolean;
  /** Local calendar day (YYYY-MM-DD) when one day was identified. */
  date: string | null;
  /** Local wall time (HH:MM) - spoken, or the 7:00 PM default. */
  time: string | null;
  timeSource: "spoken" | "default" | null;
  /** First and last local day of a spoken range the author must choose within. */
  range: Readonly<{ start: string; end: string }> | null;
  /** UTC instant; set only when `status` is "resolved". */
  plannedDatetime: string | null;
  timeZone: string;
  /** Author-facing explanation, or null when there is nothing to say. */
  note: string | null;
}>;

export type VoiceDeadlineInput = Readonly<{
  dateExpression: string | null | undefined;
  timeExpression: string | null | undefined;
  /** The one reference instant for every relative expression in this request. */
  now: Date | string;
  timeZone?: string | null;
}>;

// ---------------------------------------------------------------------------
// Calendar arithmetic on whole days (days since 1970-01-01), timezone-free.

const DAY_MS = 86_400_000;

type Ymd = Readonly<{ y: number; m: number; d: number }>;

function dayOf(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function ymdOf(day: number): Ymd {
  const date = new Date(day * DAY_MS);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** Monday 0 ... Sunday 6. */
function weekdayOf(day: number): number {
  return (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isRealDate(y: number, m: number, d: number): boolean {
  return Number.isInteger(y) && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function weekStartOf(day: number): number {
  return day - weekdayOf(day);
}

function addMonths(day: number, months: number): number {
  const { y, m, d } = ymdOf(day);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return dayOf(year, month, Math.min(d, daysInMonth(year, month)));
}

/** The Nth (1-based) or last given weekday of a month, or null when it does not exist. */
function nthWeekdayOfMonth(y: number, m: number, weekday: number, nth: number | "last"): number | null {
  const lastDay = dayOf(y, m, daysInMonth(y, m));
  if (nth === "last") return lastDay - ((weekdayOf(lastDay) - weekday + 7) % 7);
  const first = dayOf(y, m, 1);
  const candidate = first + ((weekday - weekdayOf(first) + 7) % 7) + 7 * (nth - 1);
  return candidate <= lastDay ? candidate : null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dayKey(day: number): string {
  const { y, m, d } = ymdOf(day);
  return `${y}-${pad(m)}-${pad(d)}`;
}

// ---------------------------------------------------------------------------
// Timezone conversion. Offsets are read from Intl, never assumed, so a tenant
// outside India (or a zone with daylight saving) resolves correctly.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

type WallClock = Readonly<{ y: number; m: number; d: number; hour: number; minute: number; second: number }>;

function wallClockAt(ms: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value ?? Number.NaN);
  return { y: part("year"), m: part("month"), d: part("day"), hour: part("hour") % 24, minute: part("minute"), second: part("second") };
}

function wallClockAsUtc(clock: WallClock): number {
  return Date.UTC(clock.y, clock.m - 1, clock.d, clock.hour, clock.minute, clock.second);
}

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The local calendar day (YYYY-MM-DD) of an instant in a timezone. */
export function zonedDateKey(instant: Date | string, timeZone: string): string {
  const clock = wallClockAt(new Date(instant).getTime(), timeZone);
  return `${clock.y}-${pad(clock.m)}-${pad(clock.d)}`;
}

/**
 * The UTC instant (ISO) of a local wall time, or null when that wall time does
 * not exist in the zone (a daylight-saving gap).
 */
export function zonedWallTimeToInstant(date: string, time: string, timeZone: string): string | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (y === undefined || m === undefined || d === undefined || hour === undefined || minute === undefined) return null;
  const target = Date.UTC(y, m - 1, d, hour, minute);
  if (Number.isNaN(target)) return null;
  const offsetAt = (ms: number) => wallClockAsUtc(wallClockAt(ms, timeZone)) - Math.floor(ms / 1000) * 1000;
  let instant = target - offsetAt(target);
  instant = target - offsetAt(instant);
  return wallClockAsUtc(wallClockAt(instant, timeZone)) === target ? new Date(instant).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Normalisation: lower case, digits for number words, "#N" for ordinals.

const CARDINALS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS: Readonly<Record<string, number>> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth"];
const ORDINAL_TENS: Readonly<Record<string, number>> = { twentieth: 20, thirtieth: 30 };
const COUNTED_UNITS = new Set(["day", "week", "fortnight", "month", "hour", "minute"]);

function normalize(value: string | null | undefined): string {
  const text = (value ?? "")
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .replace(/\b([ap])\.\s*m\b\.?/g, "$1m")
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, "#$1")
    .replace(/([a-z])-([a-z])/g, "$1 $2")
    .replace(/\b(?:a )?couple(?: of)?\b/g, "2")
    .replace(/[^a-z0-9#:/.\- ]+/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/(^|\D)\./g, "$1 ");
  const tokens = text.split(/\s+/).filter((token) => /[a-z0-9]/.test(token));
  const out: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    const next = tokens[index + 1] ?? "";
    const tens = TENS[token];
    if (tens !== undefined) {
      const unit = CARDINALS.indexOf(next);
      const ordinal = ORDINALS.indexOf(next);
      if (unit >= 1 && unit <= 9) { out.push(String(tens + unit)); index += 1; continue; }
      if (ordinal >= 1 && ordinal <= 9) { out.push(`#${tens + ordinal}`); index += 1; continue; }
      out.push(String(tens));
      continue;
    }
    const ordinalTens = ORDINAL_TENS[token];
    if (ordinalTens !== undefined) { out.push(`#${ordinalTens}`); continue; }
    if (CARDINALS.includes(token)) { out.push(String(CARDINALS.indexOf(token))); continue; }
    if (ORDINALS.includes(token) && token) { out.push(`#${ORDINALS.indexOf(token)}`); continue; }
    if ((token === "a" || token === "an") && COUNTED_UNITS.has(next.replace(/s$/, ""))) { out.push("1"); continue; }
    out.push(token);
  }
  return out.join(" ");
}

// ---------------------------------------------------------------------------
// Time of day.

type PartOfDay = "morning" | "noon" | "afternoon" | "evening" | "night" | "midnight";
type Clock = Readonly<{ hour: number; minute: number; meridiem: "am" | "pm" | null; twentyFour: boolean }>;

type TimeHeard = {
  clock: Clock | null;
  part: PartOfDay | null;
  /** "tonight", "this evening", "end of day": the day is today unless another is said. */
  today: boolean;
};

const PART_DEFAULT_MINUTES: Readonly<Record<PartOfDay, number>> = {
  morning: 10 * 60, noon: 12 * 60, afternoon: 15 * 60, evening: 19 * 60, night: 19 * 60, midnight: 23 * 60 + 59,
};

function clockFrom(hour: string, minute: string | undefined, meridiem: string | undefined): Clock {
  const value = Number(hour);
  return {
    hour: value,
    minute: minute === undefined ? 0 : Number(minute),
    meridiem: meridiem === "am" || meridiem === "pm" ? meridiem : null,
    twentyFour: value === 0 || value >= 13 || (hour.length === 2 && hour.startsWith("0")),
  };
}

/**
 * Pulls time-of-day words out of a phrase. Numbers are only read as a time
 * when something marks them as one (am/pm, a colon, "at", "o'clock", a
 * part of day) so "in 2 days" or "30 September" are never mistaken for hours.
 */
function takeTime(text: string, heard: TimeHeard): string {
  let rest = ` ${text} `;
  const take = (pattern: RegExp, apply: (match: string[]) => void) => {
    rest = rest.replace(pattern, (...match: string[]) => {
      apply(match);
      return " ";
    });
  };
  const setClock = (clock: Clock) => { if (!heard.clock) heard.clock = clock; };
  const setPart = (part: string | undefined) => {
    if (heard.part || !part) return;
    heard.part = part === "tonight" ? "night" : part as PartOfDay;
    if (part === "tonight") heard.today = true;
  };

  take(/ (?:by )?(?:end of (?:the )?day|eod|close of business|cob)(?= )/, () => { heard.today = true; });
  take(/ (?:at )?(\d{1,2})(?:[:.](\d{2}))? ?(am|pm)(?: (?:in the |at |this )?(?:morning|afternoon|evening|night)| tonight)? /, (m) => setClock(clockFrom(m[1] as string, m[2], m[3])));
  take(/ (?:at )?(\d{1,2})(?:[:.](\d{2}))?(?: oclock)? (?:in the |at |this )?(morning|afternoon|evening|night|tonight) /, (m) => {
    setClock(clockFrom(m[1] as string, m[2], undefined));
    setPart(m[3]);
  });
  take(/ (?:at )?(half past|quarter past|quarter to) (\d{1,2})(?: (am|pm))? /, (m) => {
    const hour = Number(m[2]);
    if (m[1] === "quarter to") setClock({ ...clockFrom(String(hour === 1 ? 12 : hour - 1), "45", m[3]), twentyFour: hour > 12 });
    else setClock(clockFrom(m[2] as string, m[1] === "half past" ? "30" : "15", m[3]));
  });
  take(/ (?:at )?(\d{1,2})[:.](\d{2})(?: hrs| hours)? /, (m) => setClock(clockFrom(m[1] as string, m[2], undefined)));
  take(/ (?:at )?(\d{1,2}) (?:oclock|o clock|hrs) /, (m) => setClock(clockFrom(m[1] as string, undefined, undefined)));
  take(/ at (\d{1,2}) /, (m) => setClock(clockFrom(m[1] as string, undefined, undefined)));
  take(/ (?:at )?(?:12 )?(noon|midday|midnight) /, (m) => setPart(m[1] === "midday" ? "noon" : m[1]));
  take(/ this (morning|afternoon|evening) /, (m) => { setPart(m[1]); heard.today = true; });
  take(/ tonight /, () => setPart("tonight"));
  take(/ (?:in the |at |during the )?(morning|afternoon|evening|night) /, (m) => setPart(m[1]));
  return rest.trim().replace(/\s+/g, " ");
}

/** Minutes after local midnight, or null when the words are not a real time. */
function minutesOf(heard: TimeHeard): number | null {
  const { clock, part } = heard;
  if (!clock) return part ? PART_DEFAULT_MINUTES[part] : null;
  const { hour, minute, meridiem, twentyFour } = clock;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  let resolved: number;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    resolved = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else if (part === "morning") {
    if (hour > 12) return null;
    resolved = hour % 12;
  } else if (part === "afternoon" || part === "evening" || part === "night") {
    if (hour > 23) return null;
    if (hour === 12 && part === "night") return 23 * 60 + 59;
    resolved = hour < 12 ? hour + 12 : hour;
  } else if (twentyFour) {
    if (hour > 23) return null;
    resolved = hour;
  } else {
    if (hour > 12) return null;
    resolved = hour <= 7 ? hour + 12 : hour;
  }
  return resolved * 60 + minute;
}

// ---------------------------------------------------------------------------
// Calendar day.

const WEEKDAY = "(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun)";
const MONTH_NAME = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";
const ORDINAL = "(#[1-5]|last)";
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function weekdayIndex(word: string | undefined): number {
  return WEEKDAY_KEYS.indexOf((word ?? "").slice(0, 3));
}

function monthNumber(word: string | undefined): number {
  return MONTH_KEYS.indexOf((word ?? "").slice(0, 3)) + 1;
}

function ordinalOf(word: string | undefined): number | "last" {
  return word === "last" ? "last" : Number((word ?? "").replace("#", ""));
}

/** Words a speaker wraps around a deadline that carry no meaning here. */
const DATE_FILLERS = new Set(["by", "on", "or", "before", "due", "until", "till", "til", "upto", "for", "at", "latest", "the", "around", "about", "sometime", "deadline", "please", "date", "dated", "no", "later", "than"]);

function withoutFillers(text: string): string {
  const words = text.split(" ").filter(Boolean);
  // "later" and "than" are fillers only in "no later than"; "N days later" keeps it.
  const keepLater = /\d+ \w+ later$/.test(text);
  return words
    .filter((word, index) => !DATE_FILLERS.has(word) || (word === "later" && keepLater && index === words.length - 1))
    .join(" ")
    .replace(/\b(?:upcoming|this coming)\b/g, "coming")
    .replace(/\bcurrent\b/g, "this")
    .replace(/^(?:in|during) (?!\d)/, "")
    .trim();
}

type MonthRef = Readonly<{ y: number; m: number }>;

type DayResult =
  | Readonly<{ kind: "day"; day: number }>
  | Readonly<{ kind: "range"; start: number; end: number }>
  | Readonly<{ kind: "ambiguous"; reason: string; day?: number }>
  | Readonly<{ kind: "invalid"; reason: string }>
  | Readonly<{ kind: "none" }>;

function parseMonthRef(text: string, today: number): MonthRef | null {
  const current = ymdOf(today);
  if (/^(?:this )?month$/.test(text)) return { y: current.y, m: current.m };
  if (/^(?:next|coming) month$/.test(text)) {
    const next = ymdOf(addMonths(dayOf(current.y, current.m, 1), 1));
    return { y: next.y, m: next.m };
  }
  const named = new RegExp(`^${MONTH_NAME}(?: (\\d{4}))?$`).exec(text);
  if (!named) return null;
  const m = monthNumber(named[1]);
  if (named[2]) return { y: Number(named[2]), m };
  return { y: m >= current.m ? current.y : current.y + 1, m };
}

/** Week N of a month: the Monday-Sunday week starting on its Nth (or last) Monday. */
function weekOfMonth(month: MonthRef, nth: number | "last"): number | null {
  return nthWeekdayOfMonth(month.y, month.m, 0, nth);
}

/** Year-less dates take the nearest occurrence, so "5 January" said in December is next year. */
function nearestYear(m: number, d: number, today: number): number | null {
  const { y } = ymdOf(today);
  const candidates = [y - 1, y, y + 1].filter((year) => isRealDate(year, m, d));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, year) => Math.abs(dayOf(year, m, d) - today) < Math.abs(dayOf(best, m, d) - today) ? year : best);
}

function explicitDate(y: number, m: number, d: number, spokenWeekday: string | undefined): DayResult {
  if (!isRealDate(y, m, d)) return { kind: "invalid", reason: "not a real date" };
  const day = dayOf(y, m, d);
  const weekday = spokenWeekday ? weekdayIndex(spokenWeekday) : -1;
  if (weekday >= 0 && weekday !== weekdayOf(day)) {
    return { kind: "ambiguous", reason: `${formatDay(day)} is a ${WEEKDAY_NAMES[weekdayOf(day)]}, not a ${WEEKDAY_NAMES[weekday]}`, day };
  }
  return { kind: "day", day };
}

function parseDay(text: string, today: number): DayResult {
  if (!text) return { kind: "none" };
  const weekStart = weekStartOf(today);
  const current = ymdOf(today);
  let match: RegExpExecArray | null;
  const test = (pattern: string) => (match = new RegExp(`^${pattern}$`).exec(text)) !== null;
  const group = (index: number) => match?.[index];

  if (test("(?:today|tonight|tonite)")) return { kind: "day", day: today };
  if (test("(?:tomorrow|tomorow|tommorow|tommorrow|tmrw|tmr)")) return { kind: "day", day: today + 1 };
  if (test("(?:day after (?:tomorrow|tomorow|tommorow|tmrw)|overmorrow)")) return { kind: "day", day: today + 2 };

  if (test("(?:(?:in|after|within) )?(\\d+) (days?|weeks?|fortnights?|months?)(?: (?:from (?:now|today)|later|hence|time))?")) {
    const count = Number(group(1));
    const unit = (group(2) ?? "").replace(/s$/, "");
    if (unit === "month") return { kind: "day", day: addMonths(today, count) };
    return { kind: "day", day: today + count * (unit === "day" ? 1 : unit === "week" ? 7 : 14) };
  }

  if (test("(?:this )?week")) return { kind: "range", start: weekStart, end: weekStart + 6 };
  if (test("(?:next|coming) week")) return { kind: "range", start: weekStart + 7, end: weekStart + 13 };
  if (test("(?:this )?weekend")) return { kind: "range", start: weekStart + 5, end: weekStart + 6 };
  if (test("next weekend")) return { kind: "range", start: weekStart + 12, end: weekStart + 13 };
  if (test("coming weekend")) {
    const start = weekdayOf(today) >= 5 ? weekStart + 12 : weekStart + 5;
    return { kind: "range", start, end: start + 1 };
  }
  if (test("(?:end|last day) of (?:(this|next|coming) )?week")) return { kind: "day", day: weekStart + (group(1) === "next" || group(1) === "coming" ? 13 : 6) };
  if (test("(?:start|beginning|first day) of (?:(this|next|coming) )?week")) return { kind: "day", day: weekStart + (group(1) === "next" || group(1) === "coming" ? 7 : 0) };

  // Positions within a month: "end of next month", "mid October", "month end".
  const monthPosition = (position: string, ref: MonthRef | null): DayResult | null => {
    if (!ref) return null;
    if (/^(?:start|beginning|begining|first day)$/.test(position)) return { kind: "day", day: dayOf(ref.y, ref.m, 1) };
    if (/^(?:middle|mid)$/.test(position)) return { kind: "day", day: dayOf(ref.y, ref.m, 15) };
    return { kind: "day", day: dayOf(ref.y, ref.m, daysInMonth(ref.y, ref.m)) };
  };
  if (test("(start|beginning|begining|first day|middle|mid|end|last day) of (.+)")) {
    const result = monthPosition(group(1) ?? "", parseMonthRef(group(2) ?? "", today));
    if (result) return result;
  }
  if (test("mid (.+)")) {
    const result = monthPosition("mid", parseMonthRef(group(1) ?? "", today));
    if (result) return result;
  }
  if (test("(.+) (start|beginning|end)")) {
    const result = monthPosition(group(2) ?? "", parseMonthRef(group(1) ?? "", today));
    if (result) return result;
  }

  // "Friday of the second week of next month" and its spoken variants.
  const weekdayInWeek = (weekday: string | undefined, nth: string | undefined, ref: string | undefined): DayResult | null => {
    const month = parseMonthRef(ref ?? "", today);
    if (!month) return null;
    const start = weekOfMonth(month, ordinalOf(nth));
    if (start === null) return { kind: "invalid", reason: "that week does not exist in the month" };
    return { kind: "day", day: start + weekdayIndex(weekday) };
  };
  if (test(`${WEEKDAY} (?:of|in) ${ORDINAL} week of (.+)`)) {
    const result = weekdayInWeek(group(1), group(2), group(3));
    if (result) return result;
  }
  if (test(`${ORDINAL} week of (.+) ${WEEKDAY}`)) {
    const result = weekdayInWeek(group(3), group(1), group(2));
    if (result) return result;
  }
  if (test(`(.+) ${ORDINAL} week ${WEEKDAY}`)) {
    const result = weekdayInWeek(group(3), group(2), group(1));
    if (result) return result;
  }

  // "second week of next month" names seven days: a range, never a guessed day.
  const weekRange = (nth: string | undefined, ref: string | undefined): DayResult | null => {
    const month = parseMonthRef(ref ?? "", today);
    if (!month) return null;
    const start = weekOfMonth(month, ordinalOf(nth));
    return start === null ? { kind: "invalid", reason: "that week does not exist in the month" } : { kind: "range", start, end: start + 6 };
  };
  if (test(`${ORDINAL} week of (.+)`)) {
    const result = weekRange(group(1), group(2));
    if (result) return result;
  }
  if (test(`(.+) ${ORDINAL} week`)) {
    const result = weekRange(group(2), group(1));
    if (result) return result;
  }

  // "first Monday of next month", "last Friday of this month".
  const nthWeekday = (nth: string | undefined, weekday: string | undefined, ref: string | undefined): DayResult | null => {
    const month = parseMonthRef(ref ?? "", today);
    if (!month) return null;
    const day = nthWeekdayOfMonth(month.y, month.m, weekdayIndex(weekday), ordinalOf(nth));
    return day === null ? { kind: "invalid", reason: "that weekday does not occur that often in the month" } : { kind: "day", day };
  };
  if (test(`${ORDINAL} ${WEEKDAY} (?:of|in) (.+)`)) {
    const result = nthWeekday(group(1), group(2), group(3));
    if (result) return result;
  }
  if (test(`(.+) ${ORDINAL} ${WEEKDAY}`)) {
    const result = nthWeekday(group(2), group(3), group(1));
    if (result) return result;
  }

  // Weekdays relative to the Monday-Sunday week.
  if (test(`${WEEKDAY} (?:of |in )?(this|next|coming) week`) || test(`(this|next|coming) week(?:s)? ${WEEKDAY}`)) {
    const weekday = weekdayIndex(group(1)) >= 0 ? group(1) : group(2);
    const which = weekdayIndex(group(1)) >= 0 ? group(2) : group(1);
    return { kind: "day", day: weekStart + (which === "this" ? 0 : 7) + weekdayIndex(weekday) };
  }
  if (test(`this ${WEEKDAY}`)) {
    const day = weekStart + weekdayIndex(group(1));
    return day >= today ? { kind: "day", day } : { kind: "ambiguous", reason: "already passed this week", day };
  }
  if (test(`(?:next to next|next next) ${WEEKDAY}`) || test(`${WEEKDAY} after next`)) return { kind: "day", day: weekStart + 14 + weekdayIndex(group(1)) };
  if (test(`next ${WEEKDAY}`)) return { kind: "day", day: weekStart + 7 + weekdayIndex(group(1)) };
  if (test(`(?:coming )?${WEEKDAY}`)) {
    const ahead = (weekdayIndex(group(1)) - weekdayOf(today) + 7) % 7;
    return { kind: "day", day: today + (ahead === 0 ? 7 : ahead) };
  }

  // Explicit dates.
  if (test("(\\d{4})-(\\d{1,2})-(\\d{1,2})")) return explicitDate(Number(group(1)), Number(group(2)), Number(group(3)), undefined);
  if (test(`(?:${WEEKDAY} )?(\\d{1,2})[/.\\-](\\d{1,2})(?:[/.\\-](\\d{2}|\\d{4}))?`)) {
    const d = Number(group(2));
    const m = Number(group(3));
    const yearText = group(4);
    const year = yearText ? (yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)) : nearestYear(m, d, today);
    return year === null ? { kind: "invalid", reason: "not a real date" } : explicitDate(year, m, d, group(1));
  }
  const monthDay = (weekday: string | undefined, dayText: string | undefined, monthText: string | undefined, yearText: string | undefined): DayResult => {
    const d = Number((dayText ?? "").replace("#", ""));
    const m = monthNumber(monthText);
    const year = yearText ? Number(yearText) : nearestYear(m, d, today);
    return year === null ? { kind: "invalid", reason: "not a real date" } : explicitDate(year, m, d, weekday);
  };
  if (test(`(?:${WEEKDAY} )?(#?\\d{1,2}) (?:of )?${MONTH_NAME}(?: (\\d{4}))?`)) return monthDay(group(1), group(2), group(3), group(4));
  if (test(`(?:${WEEKDAY} )?${MONTH_NAME} (#?\\d{1,2})(?: (\\d{4}))?`)) return monthDay(group(1), group(3), group(2), group(4));
  if (test(`(?:${WEEKDAY} )?#(\\d{1,2})`)) {
    // "by the 30th": this month unless that day has passed, then next month.
    const d = Number(group(2));
    const next = ymdOf(addMonths(dayOf(current.y, current.m, 1), 1));
    const target = d >= current.d ? { y: current.y, m: current.m } : next;
    return explicitDate(target.y, target.m, d, group(1));
  }

  const month = parseMonthRef(text, today);
  if (month) return { kind: "range", start: dayOf(month.y, month.m, 1), end: dayOf(month.y, month.m, daysInMonth(month.y, month.m)) };
  return { kind: "ambiguous", reason: "unrecognised" };
}

// ---------------------------------------------------------------------------
// Presentation.

function formatDay(day: number): string {
  const { y, m, d } = ymdOf(day);
  return `${WEEKDAY_LABELS[weekdayOf(day)]} ${d} ${MONTH_LABELS[m - 1]} ${y}`;
}

function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${pad(minutes % 60)} ${hour < 12 ? "AM" : "PM"}`;
}

function quoted(value: string): string {
  return `“${value}”`;
}

// ---------------------------------------------------------------------------

const RELATIVE_INSTANT = /^(?:(?:in|after|within) )?(\d+) (hours?|hrs?|minutes?|mins?)(?: (?:from now|later|time))?$/;

/**
 * Resolves spoken deadline words against one reference instant. The result is
 * "resolved" only when exactly one future instant within a year is meant;
 * everything else leaves `plannedDatetime` null so the composer asks.
 */
export function resolveVoiceDeadline(input: VoiceDeadlineInput): VoiceDeadline {
  const timeZone = isValidTimeZone(input.timeZone) ? input.timeZone : VOICE_DEADLINE_DEFAULT_TIME_ZONE;
  const dateExpression = input.dateExpression?.trim() || null;
  const timeExpression = input.timeExpression?.trim() || null;
  const nowMs = new Date(input.now).getTime();
  const spoken = [dateExpression, timeExpression].filter(Boolean).join(" ");
  const base = {
    dateExpression, timeExpression,
    hasExplicitDate: dateExpression !== null,
    hasExplicitTime: false,
    date: null, time: null, timeSource: null, range: null, plannedDatetime: null, timeZone,
  } as const;
  if (Number.isNaN(nowMs)) return { ...base, status: "invalid", note: "The current time is unavailable. Choose the due date and time." };
  const nowClock = wallClockAt(nowMs, timeZone);
  const today = dayOf(nowClock.y, nowClock.m, nowClock.d);

  const dateText = normalize(dateExpression);
  const timeText = normalize(timeExpression);

  // "in 2 hours" is already an instant: no day or clock to combine.
  const instantMatch = RELATIVE_INSTANT.exec(withoutFillers(timeText)) ?? RELATIVE_INSTANT.exec(withoutFillers(dateText));
  if (instantMatch) {
    const amount = Number(instantMatch[1]);
    const instant = nowMs + amount * (instantMatch[2]?.startsWith("h") ? 3_600_000 : 60_000);
    const clock = wallClockAt(instant, timeZone);
    const date = `${clock.y}-${pad(clock.m)}-${pad(clock.d)}`;
    const time = `${pad(clock.hour)}:${pad(clock.minute)}`;
    return {
      ...base, status: "resolved", hasExplicitTime: true, date, time, timeSource: "spoken",
      plannedDatetime: new Date(Math.floor(instant / 60_000) * 60_000).toISOString(),
      note: `${quoted(spoken)} → ${formatDay(dayOf(clock.y, clock.m, clock.d))}, ${formatMinutes(clock.hour * 60 + clock.minute)}`,
    };
  }

  const heard: TimeHeard = { clock: null, part: null, today: false };
  const dateRest = takeTime(dateText, heard);
  let timeRest = takeTime(timeText, heard);
  // The time field on its own may be a bare "6" or "10:30".
  const bare = /^(?:at |by |around )?(\d{1,2})(?:[:.](\d{2}))?(?: sharp)?$/.exec(timeRest);
  if (bare && !heard.clock) {
    heard.clock = clockFrom(bare[1] as string, bare[2], undefined);
    timeRest = "";
  }
  const hasExplicitTime = heard.clock !== null || heard.part !== null;
  // Anything left in the time field that is not a time ("tomorrow 5 pm" put
  // in the wrong field) is read as part of the day.
  const dayText = withoutFillers([dateRest, withoutFillers(timeRest)].filter(Boolean).join(" "));
  const withTime = { ...base, hasExplicitDate: dayText !== "" || heard.today, hasExplicitTime };

  const minutes = minutesOf(heard);
  const timeWords = timeExpression ?? spoken;
  if (hasExplicitTime && minutes === null) {
    return { ...withTime, status: "invalid", note: `${quoted(timeWords)} is not a valid time. Choose the due date and time.` };
  }
  const time = minutes === null ? VOICE_DEADLINE_DEFAULT_TIME : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  const timeSource = hasExplicitTime ? "spoken" as const : "default" as const;

  const parsed = dayText === "" && heard.today ? { kind: "day" as const, day: today } : parseDay(dayText, today);
  if (parsed.kind === "none") {
    return {
      ...withTime, status: "missing", hasExplicitDate: false,
      note: hasExplicitTime ? `Heard the time ${quoted(timeWords)} but no day. Choose the due date.` : null,
    };
  }
  if (parsed.kind === "invalid") {
    const reason = parsed.reason === "not a real date" ? "is not a real date" : `does not exist: ${parsed.reason}`;
    return { ...withTime, status: "invalid", note: `${quoted(spoken)} ${reason}. Choose the due date.` };
  }
  if (parsed.kind === "range") {
    const range = { start: dayKey(parsed.start), end: dayKey(parsed.end) };
    const status = parsed.end < today ? "past" as const : "ambiguous" as const;
    const span = parsed.start === parsed.end ? formatDay(parsed.start) : `${formatDay(parsed.start)} – ${formatDay(parsed.end)}`;
    return {
      ...withTime, status, range,
      note: status === "past"
        ? `${quoted(spoken)} (${span}) has already passed. Choose the due date.`
        : `${quoted(spoken)} covers ${span}. Choose the exact day.`,
    };
  }
  if (parsed.kind === "ambiguous") {
    const note = parsed.reason === "unrecognised"
      ? `Couldn’t turn ${quoted(spoken)} into one date. Choose the due date.`
      : parsed.reason === "already passed this week" && parsed.day !== undefined
        ? `${quoted(spoken)} (${formatDay(parsed.day)}) has already passed this week. Choose the date you meant.`
        : `${quoted(spoken)}: ${parsed.reason}. Choose the due date.`;
    return { ...withTime, status: "ambiguous", date: parsed.day === undefined ? null : dayKey(parsed.day), note };
  }

  const date = dayKey(parsed.day);
  const described = `${formatDay(parsed.day)}, ${formatMinutes(Number(time.slice(0, 2)) * 60 + Number(time.slice(3)))}`;
  const resolvedFields = { ...withTime, date, time, timeSource };
  const instant = zonedWallTimeToInstant(date, time, timeZone);
  if (!instant) {
    return { ...resolvedFields, status: "invalid", note: `${described} does not exist in ${timeZone}. Choose the due date and time.` };
  }
  if (Date.parse(instant) <= nowMs) {
    return { ...resolvedFields, status: "past", note: `${quoted(spoken)} is ${described}, which has already passed. Choose a later due date and time.` };
  }
  if (parsed.day - today > MAX_DAYS_AHEAD) {
    return { ...resolvedFields, status: "ambiguous", note: `${quoted(spoken)} is ${described}, more than a year away. Confirm the due date.` };
  }
  const defaulted = timeSource === "default" ? ` (no time said, default ${formatMinutes(DEFAULT_MINUTES)})` : "";
  return {
    ...resolvedFields, status: "resolved", plannedDatetime: instant,
    note: `${quoted(spoken)} → ${described}${defaulted}`,
  };
}
