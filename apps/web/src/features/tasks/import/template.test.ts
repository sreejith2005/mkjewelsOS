import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { IDEAL_TASK_IMPORT_HEADERS, parseTaskImportFile, TASK_IMPORT_BUSINESS_COLUMNS } from "@jewelos/core";
import { createTaskImportTemplateBytes } from "./template";

describe("task import download format", () => {
  it("creates one readable Tasks worksheet whose example round-trips", async () => {
    const bytes = await createTaskImportTemplateBytes();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Tasks"]);
    const sheet = workbook.getWorksheet("Tasks")!;
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toEqual("A1:T2");
    expect(sheet.getRow(1).font.bold).toBe(true);
    expect(sheet.getCell("C1").value).toBe("MAIN TASK * (REQUIRED)");
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      ...IDEAL_TASK_IMPORT_HEADERS.map((header) => header === "MAIN TASK" ? "MAIN TASK * (REQUIRED)" : header),
    ]);
    expect(sheet.getRow(1).eachCell((cell) => expect(cell.note).toBeUndefined())).toBeUndefined();
    expect(sheet.getCell("C1").dataValidation).toMatchObject({
      showInputMessage: true,
      promptTitle: "Required column",
    });
    expect(sheet.getCell("A1").dataValidation).toMatchObject({
      showInputMessage: true,
      promptTitle: "Optional column",
    });
    expect(sheet.columns.every((column) => (column.width ?? 0) >= 12 && (column.width ?? 0) <= 48)).toBe(true);
    expect(sheet.getCell("D2").alignment?.wrapText).toBe(true);
    expect(sheet.getCell("C1").fill).not.toEqual(sheet.getCell("A1").fill);

    const parsed = await parseTaskImportFile({
      name: "mk-jewels-task-bulk-import.xlsx",
      size: bytes.byteLength,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      arrayBuffer: async () => bytes,
    }, { defaultStartsOn: "2026-09-22" });
    expect(parsed.sourceFormat).toBe("ideal_business_sheet");
    expect(parsed.issues).toEqual([]);
    expect(parsed.draftRows).toHaveLength(1);
  });

  it("derives every column from the shared business descriptor", async () => {
    const bytes = await createTaskImportTemplateBytes();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.getWorksheet("Tasks")!;
    expect(sheet.columnCount).toBe(TASK_IMPORT_BUSINESS_COLUMNS.length);
    TASK_IMPORT_BUSINESS_COLUMNS.forEach((column, index) => {
      expect(sheet.getColumn(index + 1).width).toBe(column.width);
      expect(sheet.getCell(1, index + 1).note).toBeUndefined();
      expect(sheet.getCell(1, index + 1).dataValidation.prompt).toBe(column.comment);
    });
  });
});
