import type { TaskBulkImportIssue } from "./workbook";

export type TaskImportRowEligibility<T extends { source_row: number }> = Readonly<{
  readyRows: readonly T[];
  blockedRows: readonly T[];
  blockedSourceRows: readonly number[];
  globalIssues: readonly TaskBulkImportIssue[];
}>;

export function partitionTaskImportRows<T extends { source_row: number }>(
  rows: readonly T[],
  issues: readonly TaskBulkImportIssue[],
): TaskImportRowEligibility<T> {
  const errors = issues.filter((issue) => issue.severity === "error");
  const globalIssues = errors.filter((issue) => issue.row < 2);
  if (globalIssues.length > 0) {
    return {
      readyRows: [],
      blockedRows: [...rows],
      blockedSourceRows: [...new Set(rows.map((row) => row.source_row))].sort((left, right) => left - right),
      globalIssues,
    };
  }

  const blocked = new Set(errors.map((issue) => issue.row));
  const blockedRows = rows.filter((row) => blocked.has(row.source_row));
  return {
    readyRows: rows.filter((row) => !blocked.has(row.source_row)),
    blockedRows,
    blockedSourceRows: [...new Set(blockedRows.map((row) => row.source_row))].sort((left, right) => left - right),
    globalIssues,
  };
}
