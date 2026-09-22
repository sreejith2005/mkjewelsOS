import ExcelJS from "exceljs";
import { IDEAL_TASK_IMPORT_TEMPLATE_HEADERS, TASK_IMPORT_BUSINESS_COLUMNS } from "@jewelos/core";

const COLORS = {
  accent: "FFF59E0B",
  optional: "FF78716C",
  border: "FFE2E8F0",
  text: "FF1E293B",
  muted: "FFF8FAFC",
  white: "FFFFFFFF",
} as const;

export async function createTaskImportTemplateBytes(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JewelOS";
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  const sheet = workbook.addWorksheet("Tasks", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = TASK_IMPORT_BUSINESS_COLUMNS.map((column, index) => ({
    header: IDEAL_TASK_IMPORT_TEMPLATE_HEADERS[index]!,
    key: column.header,
    width: column.width,
  }));
  sheet.addRow(Object.fromEntries(TASK_IMPORT_BUSINESS_COLUMNS.map((column) => [column.header, column.example])));
  sheet.autoFilter = "A1:T2";
  sheet.getRow(1).height = 30;
  sheet.getRow(1).font = { bold: true, color: { argb: COLORS.white }, size: 11 };
  sheet.getRow(2).height = 42;

  TASK_IMPORT_BUSINESS_COLUMNS.forEach((column, index) => {
    const header = sheet.getCell(1, index + 1);
    header.font = { bold: true, color: { argb: COLORS.white }, size: 11 };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: column.required ? COLORS.accent : COLORS.optional } };
    header.alignment = { vertical: "middle", wrapText: true };
    header.border = { bottom: { style: "thin", color: { argb: COLORS.border } } };
    header.dataValidation = {
      type: "custom",
      allowBlank: true,
      formulae: ["TRUE"],
      showInputMessage: true,
      promptTitle: column.required ? "Required column" : "Optional column",
      prompt: column.comment,
    };

    const example = sheet.getCell(2, index + 1);
    example.font = { color: { argb: COLORS.text }, size: 10 };
    example.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.muted } };
    example.alignment = { vertical: "top", wrapText: true };
    example.border = {
      top: { style: "thin", color: { argb: COLORS.border } },
      bottom: { style: "thin", color: { argb: COLORS.border } },
      left: { style: "thin", color: { argb: COLORS.border } },
      right: { style: "thin", color: { argb: COLORS.border } },
    };
  });

  return await workbook.xlsx.writeBuffer() as ArrayBuffer;
}
