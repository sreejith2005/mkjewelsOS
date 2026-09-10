import { kolkataDateKey } from "./recurrence";

export type AvailabilityWeekDay = Readonly<{
  date: string;
  weekdayLabel: string;
  shortLabel: string;
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
}>;

const WEEKDAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

// A business date key is a plain calendar date, so shifting and weekday maths
// run on UTC midnight - never on the +05:30 instant, which sits on the previous
// UTC day and would report the wrong weekday.
function addDays(dateKey: string, days: number): string {
  const shifted = new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/** Index of a business day inside its Monday-to-Sunday week (Monday = 0). */
function weekdayIndex(dateKey: string): number {
  return (new Date(`${dateKey}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

/** Monday of the business week that contains `reference`. */
export function availabilityWeekStart(reference: Date | string = new Date()): string {
  const dateKey = kolkataDateKey(reference);
  return addDays(dateKey, -weekdayIndex(dateKey));
}

/** Sunday of the business week that contains `reference`. */
export function availabilityWeekEnd(reference: Date | string = new Date()): string {
  return addDays(availabilityWeekStart(reference), 6);
}

/**
 * The seven days of the business week containing `reference`, Monday first, so
 * a user can mark the days already gone and the days still to come.
 */
export function availabilityWeekDays(reference: Date | string = new Date()): AvailabilityWeekDay[] {
  const todayKey = kolkataDateKey(reference);
  const start = availabilityWeekStart(reference);
  return WEEKDAY_LABELS.map((weekdayLabel, offset) => {
    const date = addDays(start, offset);
    return {
      date,
      weekdayLabel,
      shortLabel: weekdayLabel.slice(0, 3),
      isToday: date === todayKey,
      isPast: date < todayKey,
      isFuture: date > todayKey,
    };
  });
}

/** True when `date` may be self-edited: it sits in the current business week. */
export function isWithinAvailabilityWeek(date: string, reference: Date | string = new Date()): boolean {
  return date >= availabilityWeekStart(reference) && date <= availabilityWeekEnd(reference);
}
