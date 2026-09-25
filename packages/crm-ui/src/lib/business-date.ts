const KOLKATA_TIME_ZONE = "Asia/Kolkata";

export function kolkataDateKey(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOLKATA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function kolkataDayStart(value: Date = new Date()): string {
  const [year, month, day] = kolkataDateKey(value).split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, -5, -30)).toISOString();
}
