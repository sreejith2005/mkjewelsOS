const FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/;

export function escapeSpreadsheetFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const safe = escapeSpreadsheetFormula(typeof value === "string" ? value : String(value));
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function encodeCsv(columns: readonly string[], rows: readonly Readonly<Record<string, unknown>>[]): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** An export column: from the report catalogue, or sent by the server for one form's questions. */
export type ExportColumn = Readonly<{ key: string; label: string; format?: string; phone?: boolean; instant?: boolean }>;

const IST_PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** "2026-11-02 14:05" in Asia/Kolkata: spreadsheets read it as a date and time. */
export function istDateTime(value: string): string | null {
  if (!INSTANT.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const part = (type: string) => IST_PARTS.formatToParts(date).find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

/** "in_progress" -> "In progress". */
export function humanizeReportValue(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) return value;
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function columnFormat(column: ExportColumn): string {
  return column.format ?? (column.phone ? "phone" : column.instant ? "instant" : "text");
}

/** Business-readable cell text: IST date-times, Yes/No, readable statuses. */
export function businessExportValue(value: unknown, column: ExportColumn): string {
  if (value === null || value === undefined || value === "") return "";
  const format = columnFormat(column);
  if (format === "instant" && typeof value === "string") return istDateTime(value) ?? value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (format === "status" && typeof value === "string") return humanizeReportValue(value);
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * One CSV cell. A phone number is written as ="98765 43210" so Excel and Google Sheets keep
 * it as text (no scientific notation, no lost leading zero). Only digits, spaces and a
 * leading + are ever wrapped; any other text goes through the formula-injection escape.
 */
export function businessCsvCell(value: unknown, column: ExportColumn): string {
  const text = businessExportValue(value, column);
  if (columnFormat(column) === "phone" && /^\+?[0-9][0-9 ]{3,24}$/.test(text)) return `"=""${text}"""`;
  return csvCell(text);
}

/** Header text; date-time columns say they are in IST. */
export function businessExportHeader(column: ExportColumn): string {
  return columnFormat(column) === "instant" && !/IST|Asia\/Kolkata/.test(column.label) ? `${column.label} (IST)` : column.label;
}

export function safeExportFilename(reportKey: string, date = new Date()): string {
  const safeKey = reportKey.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
  return `${safeKey}-${date.toISOString().slice(0, 10)}.csv`;
}
