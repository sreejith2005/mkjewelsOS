import { fetchEmployeeTaskProgress, fetchReportingOptions, type ReportingOptions } from "@/features/analytics/api";
import type { EmployeeProgress, ProgressCounts } from "@/features/analytics/types";
import { fetchTaskEvidenceWorkspace } from "@/features/taskEvidence/api";
import type { EvidenceWorkspace } from "@/features/taskEvidence/types";
import { evidenceFilter, progressContext, type TaskControlFilters } from "./filters";

/**
 * `overdue` arrives from the progress RPC only once migration 0139 is applied.
 * A browser running ahead of the database must show a truthful zero rather than
 * NaN in every tile, so the counts are coerced on the way in.
 */
function counts<T extends ProgressCounts>(rows: readonly T[]): T[] {
  return rows.map((row) => ({ ...row, overdue: Number.isFinite(row.overdue) ? row.overdue : 0 }));
}

export type TaskControlSnapshot = Readonly<{ progress: EmployeeProgress; evidence: EvidenceWorkspace }>;

/**
 * One filter, two server contracts, one render. They are requested together so a
 * panel can never show numbers from a filter the neighbouring panel has moved on
 * from.
 */
export async function fetchTaskControlSnapshot(
  filters: TaskControlFilters,
  page: number,
  pageSize: number,
): Promise<TaskControlSnapshot> {
  const [progress, evidence] = await Promise.all([
    fetchEmployeeTaskProgress(progressContext(filters)),
    fetchTaskEvidenceWorkspace(evidenceFilter(filters, page, pageSize)),
  ]);
  return {
    progress: { employees: counts(progress.employees), departments: counts(progress.departments), branches: counts(progress.branches) },
    evidence,
  };
}

export type { ReportingOptions };
export { fetchReportingOptions };
