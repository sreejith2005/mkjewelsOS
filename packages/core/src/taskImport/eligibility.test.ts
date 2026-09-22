import { describe, expect, it } from "vitest";
import type { TaskBulkImportIssue } from "./workbook";
import { partitionTaskImportRows } from "./eligibility";

const rows = [
  { source_row: 2, title: "Synthetic two" },
  { source_row: 3, title: "Synthetic three" },
  { source_row: 4, title: "Synthetic four" },
] as const;

function issue(row: number, severity: "error" | "warning" = "error", field = "TASK FREQUENCY"): TaskBulkImportIssue {
  return {
    sheet: "Tasks",
    row,
    field,
    reason: "Synthetic issue",
    guidance: "Correct the synthetic value.",
    severity,
  };
}

describe("task import row eligibility", () => {
  it("blocks only the data row carrying an error", () => {
    const result = partitionTaskImportRows(rows, [issue(3)]);

    expect(result.readyRows.map((row) => row.source_row)).toEqual([2, 4]);
    expect(result.blockedRows.map((row) => row.source_row)).toEqual([3]);
    expect(result.blockedSourceRows).toEqual([3]);
    expect(result.globalIssues).toEqual([]);
  });

  it("counts a source row once when it carries multiple errors", () => {
    const result = partitionTaskImportRows(rows, [issue(3), issue(3, "error", "START TIME")]);

    expect(result.blockedRows.map((row) => row.source_row)).toEqual([3]);
    expect(result.blockedSourceRows).toEqual([3]);
  });

  it("returns sorted unique source rows for multiple blocked records", () => {
    const result = partitionTaskImportRows(rows, [issue(4), issue(3), issue(4, "error", "DUE TIME")]);

    expect(result.blockedRows.map((row) => row.source_row)).toEqual([3, 4]);
    expect(result.blockedSourceRows).toEqual([3, 4]);
  });

  it("does not block a row for a warning", () => {
    const result = partitionTaskImportRows(rows, [issue(3, "warning")]);

    expect(result.readyRows).toEqual(rows);
    expect(result.blockedRows).toEqual([]);
  });

  it.each([0, 1])("treats an error on structural row %i as global", (row) => {
    const structuralIssue = issue(row, "error", "sheet");
    const result = partitionTaskImportRows(rows, [structuralIssue]);

    expect(result.readyRows).toEqual([]);
    expect(result.blockedRows).toEqual(rows);
    expect(result.blockedSourceRows).toEqual([2, 3, 4]);
    expect(result.globalIssues).toEqual([structuralIssue]);
  });

  it("does not fabricate a blocked row for an absent source row", () => {
    const result = partitionTaskImportRows(rows, [issue(99)]);

    expect(result.readyRows).toEqual(rows);
    expect(result.blockedRows).toEqual([]);
    expect(result.blockedSourceRows).toEqual([]);
    expect(result.globalIssues).toEqual([]);
  });

  it("returns empty partitions for an empty source", () => {
    expect(partitionTaskImportRows([], [])).toEqual({
      readyRows: [],
      blockedRows: [],
      blockedSourceRows: [],
      globalIssues: [],
    });
  });
});
