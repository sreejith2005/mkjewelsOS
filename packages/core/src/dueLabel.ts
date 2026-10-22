import { kolkataDateKey } from "./recurrence";

export type DueTone = "overdue" | "today" | "upcoming" | "none" | "done";
export type DueDescription = Readonly<{ label: string; tone: DueTone }>;

const DAY_MS = 86_400_000;
const ZONE = "Asia/Kolkata";
const tidy = (text: string) => text.replace(/[  ]/g, " ");
const time = (date: Date) => tidy(new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: ZONE }).format(date));
const day = (date: Date, withYear: boolean) => tidy(new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: ZONE }).format(date));
const dayNumber = (date: Date) => Date.parse(`${kolkataDateKey(date)}T00:00:00Z`) / DAY_MS;

/**
 * Plain-language due text for a work card, by MK Jewels calendar day:
 * "Due today, 5:00 pm", "Due tomorrow, 10:00 am", "Overdue by 2 days".
 * Display only — overdue status for filters and counts stays server-derived.
 */
export function describeDue(dueAt: string | null | undefined, now: Date = new Date(), options: Readonly<{ completed?: boolean }> = {}): DueDescription {
  if (!dueAt) return { label: "No due date", tone: "none" };
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return { label: "No due date", tone: "none" };
  const sameYear = kolkataDateKey(due).slice(0, 4) === kolkataDateKey(now).slice(0, 4);
  if (options.completed) return { label: `Was due ${day(due, !sameYear)}`, tone: "done" };
  const days = dayNumber(due) - dayNumber(now);
  if (due.getTime() < now.getTime()) {
    if (days === 0) return { label: `Overdue since ${time(due)} today`, tone: "overdue" };
    const late = -days;
    return { label: `Overdue by ${late} ${late === 1 ? "day" : "days"}`, tone: "overdue" };
  }
  if (days === 0) return { label: `Due today, ${time(due)}`, tone: "today" };
  if (days === 1) return { label: `Due tomorrow, ${time(due)}`, tone: "upcoming" };
  return { label: `Due ${day(due, !sameYear)}, ${time(due)}`, tone: "upcoming" };
}

/** "22 Oct 2026, 2:30 pm" in MK Jewels time, for submission and history stamps. */
export function formatKolkataDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return tidy(new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: ZONE }).format(date));
}
