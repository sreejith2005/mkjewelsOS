import { expect, it } from "vitest";
import { createCorrectionReportCsv } from "./correctionReport";

it("exports safe issue metadata without source values", () => {
  const report = createCorrectionReportCsv([{ sheet: "Tasks", row: 9, field: "EMPLOYEE EMAIL", reason: "Identity is missing", guidance: "Add an email", severity: "error" }]);
  expect(report).toContain("source_row,field,reason,guidance");
  expect(report).not.toContain("Tasks");
  expect(report).not.toMatch(/@/);
});
