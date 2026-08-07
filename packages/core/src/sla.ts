export type SlaStatus = "on_time" | "overdue" | "pending";

export type SlaResult = Readonly<{
  delayMinutes: number | null;
  slaBreached: boolean;
  status: SlaStatus;
}>;

function parseDate(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed;
}

export function calculateDelayMinutes(
  plannedDatetime: Date | string,
  actualDatetime: Date | string | null,
): number | null {
  if (actualDatetime === null) return null;
  const planned = parseDate(plannedDatetime, "planned_datetime");
  const actual = parseDate(actualDatetime, "actual_datetime");
  return Math.round((actual.getTime() - planned.getTime()) / 60_000);
}

export function calculateSla(
  plannedDatetime: Date | string,
  actualDatetime: Date | string | null,
  now: Date | string = new Date(),
): SlaResult {
  const planned = parseDate(plannedDatetime, "planned_datetime");
  if (actualDatetime === null) {
    const overdue = parseDate(now, "now").getTime() > planned.getTime();
    return {
      delayMinutes: null,
      slaBreached: overdue,
      status: overdue ? "overdue" : "pending",
    };
  }

  const delayMinutes = calculateDelayMinutes(planned, actualDatetime);
  const overdue = (delayMinutes ?? 0) > 0;
  return {
    delayMinutes,
    slaBreached: overdue,
    status: overdue ? "overdue" : "on_time",
  };
}
