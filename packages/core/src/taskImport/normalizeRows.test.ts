import { describe, expect, it } from "vitest";
import type { ParsedTaskCsv, TaskImportMapping } from "./parseCsv";
import { normalizeImportRows } from "./normalizeRows";

const mapping: TaskImportMapping = {
  checklist: "Checklist",
  doerName: "Doer",
  taskGroup: "Group",
  title: "Task",
};

const parsed: ParsedTaskCsv = {
  headers: ["Task", "Doer", "Group", "Checklist"],
  rows: [
    { Task: "Stock count", Doer: "Asha", Group: "safe", Checklist: "Open safe" },
    { Task: "Stock count", Doer: "Asha", Group: "safe", Checklist: "Count rings" },
  ],
};

describe("normalizeImportRows", () => {
  it("groups matching checklist rows", () => {
    expect(normalizeImportRows(parsed, mapping).accepted[0]?.checklist).toEqual(["Open safe", "Count rings"]);
  });

  it("blocks conflicting groups", () => {
    const conflict: ParsedTaskCsv = {
      ...parsed,
      rows: [...parsed.rows, { Task: "Different task", Doer: "Asha", Group: "safe", Checklist: "Lock safe" }],
    };
    expect(normalizeImportRows(conflict, mapping).blocked[0]?.reason).toMatch(/group/i);
  });

  it("blocks unsupported frequency values", () => {
    const withFrequency: ParsedTaskCsv = { headers: ["Task", "Doer", "Frequency"], rows: [{ Task: "Stock count", Doer: "Asha", Frequency: "yearly" }] };
    expect(normalizeImportRows(withFrequency, { title: "Task", doerName: "Doer", frequency: "Frequency" }).blocked[0]?.reason).toMatch(/frequency/i);
  });
});
