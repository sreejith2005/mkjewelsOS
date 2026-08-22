export function normalizeAvailabilityRange(startDate: string, endDate: string): { startDate: string; endDate: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Start date is required");
  const resolvedEnd = endDate || startDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedEnd)) throw new Error("End date is invalid");
  if (resolvedEnd < startDate) throw new Error("End date cannot be before start date");
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${resolvedEnd}T00:00:00Z`);
  if ((end.getTime() - start.getTime()) / 86_400_000 > 366) throw new Error("Availability range cannot exceed 367 days");
  return { startDate, endDate: resolvedEnd };
}
