import type { TaskBulkImportIssue } from "./workbook";
const csv = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
export function createCorrectionReportCsv(issues: readonly TaskBulkImportIssue[]) {
  return ["source_row,field,reason,guidance", ...issues.map((item) => [item.row, item.field, item.reason, item.guidance].map(csv).join(","))].join("\r\n");
}
