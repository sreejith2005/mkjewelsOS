/**
 * Display formatting. Every date the backend sends is an instant; the business
 * runs in Asia/Kolkata, so that is what a date is rendered in unless the server
 * has told us otherwise for this tenant.
 */
const DEFAULT_TIMEZONE = "Asia/Kolkata";
const LOCALE = "en-IN";

export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter((letter): letter is string => Boolean(letter));
  return letters.join("").toUpperCase().slice(0, 2) || "?";
}

export function formatDateTime(value: string | null | undefined, fallback = "Any time"): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DEFAULT_TIMEZONE,
  });
}

export function formatDate(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString(LOCALE, { dateStyle: "medium", timeZone: DEFAULT_TIMEZONE });
}

/** "2 hours overdue", "in 35 minutes" — the shape a deadline is read in. */
export function formatRelativeDeadline(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  const minutes = Math.round((due.getTime() - now.getTime()) / 60_000);
  const overdue = minutes < 0;
  const magnitude = Math.abs(minutes);
  const amount =
    magnitude < 60
      ? `${magnitude} minute${magnitude === 1 ? "" : "s"}`
      : magnitude < 60 * 24
        ? `${Math.round(magnitude / 60)} hour${Math.round(magnitude / 60) === 1 ? "" : "s"}`
        : `${Math.round(magnitude / (60 * 24))} day${Math.round(magnitude / (60 * 24)) === 1 ? "" : "s"}`;
  return overdue ? `${amount} overdue` : `in ${amount}`;
}

/** `super_admin` becomes `Super Admin`, matching the web's role labels. */
export function titleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => (part[0] ?? "").toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function greetingFor(timezone: string = DEFAULT_TIMEZONE): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { hour: "2-digit", hour12: false, timeZone: timezone }).format(new Date()),
  );
  if (!Number.isFinite(hour)) return "Hello";
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}
