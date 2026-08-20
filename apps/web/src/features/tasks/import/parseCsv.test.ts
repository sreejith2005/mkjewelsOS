import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, parseTaskCsv, validateImportMapping } from "./parseCsv";

function csvWithRows(count: number) {
  return `Task,Doer\n${Array.from({ length: count }, (_, index) => `Task ${index},Asha`).join("\n")}`;
}

describe("parseTaskCsv", () => {
  it("parses a BOM header and quoted comma", () => {
    expect(parseTaskCsv("\uFEFFTask,Doer\n\"Stock, count\",Asha").rows[0]).toEqual({ Task: "Stock, count", Doer: "Asha" });
  });

  it("rejects more than 500 data rows", () => {
    expect(() => parseTaskCsv(csvWithRows(MAX_IMPORT_ROWS + 1))).toThrow("500");
  });

  it("rejects duplicate normalized headers", () => {
    expect(() => parseTaskCsv("Task, task \nStock count,Asha")).toThrow(/duplicate/i);
  });
});

describe("validateImportMapping", () => {
  it("requires title and a doer name or email", () => {
    expect(validateImportMapping({ title: "Task" })).toMatch(/doer/i);
    expect(validateImportMapping({ title: "Task", doerEmail: "Email" })).toBeNull();
  });
});
