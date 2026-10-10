const OPEN = new Set(["pending", "in_progress", "in_review", "overdue"]);
/** History stays intact; progress uses current visits and never hides independent open work. */
export function latestFmsStageVisits<T extends Readonly<{ fms_stage_id: string; status: string; visit_number?: number | undefined }>>(visits: readonly T[]): readonly T[] {
  const latest = new Map<string, T>();
  for (const visit of visits) {
    const prior = latest.get(visit.fms_stage_id);
    if (!prior || (visit.visit_number ?? 1) >= (prior.visit_number ?? 1)) latest.set(visit.fms_stage_id, visit);
  }
  return visits.filter((visit) => OPEN.has(visit.status) || latest.get(visit.fms_stage_id) === visit);
}
