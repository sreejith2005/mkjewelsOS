const FORMULA_PREFIX = /^[=+\-@]/;

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

export function safeExportFilename(reportKey: string, date = new Date()): string {
  const safeKey = reportKey.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
  return `${safeKey}-${date.toISOString().slice(0, 10)}.csv`;
}
