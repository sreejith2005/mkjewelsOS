export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;

export type ParsedTaskCsv = Readonly<{
  headers: readonly string[];
  rows: readonly Readonly<Record<string, string>>[];
}>;

export type TaskImportMapping = Readonly<{
  title: string;
  doerName?: string;
  doerEmail?: string;
  description?: string;
  dueAt?: string;
  priority?: string;
  category?: string;
  branch?: string;
  department?: string;
  checklist?: string;
  taskGroup?: string;
  frequency?: string;
}>;

function normalizedHeader(value: string) {
  return value.trim().toLocaleLowerCase();
}

function parseRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      if (value.length > 0) throw new Error("CSV quote must begin a cell");
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (character !== "\r") {
      value += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted cell");
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function hasUnsafeControlCharacter(value: string) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

export function parseTaskCsv(text: string): ParsedTaskCsv {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("CSV must be 1 MiB or smaller");
  }
  const rows = parseRows(text.replace(/^\uFEFF/, ""));
  const headerRow = rows.shift();
  if (!headerRow || headerRow.length === 0 || headerRow.every((header) => header.trim().length === 0)) {
    throw new Error("CSV must include a header row");
  }
  const headers = headerRow.map((header) => header.trim());
  if (headers.some((header) => header.length === 0 || hasUnsafeControlCharacter(header))) {
    throw new Error("CSV headers are invalid");
  }
  const uniqueHeaders = new Set(headers.map(normalizedHeader));
  if (uniqueHeaders.size !== headers.length) throw new Error("CSV contains duplicate headers");

  const dataRows = rows.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (dataRows.length === 0) throw new Error("CSV must include at least one task row");
  if (dataRows.length > MAX_IMPORT_ROWS) throw new Error(`CSV can include at most ${MAX_IMPORT_ROWS} rows`);
  if (dataRows.some((row) => row.length !== headers.length || row.some(hasUnsafeControlCharacter))) {
    throw new Error("CSV rows are invalid");
  }
  return {
    headers,
    rows: dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))),
  };
}

export function validateImportMapping(mapping: TaskImportMapping): string | null {
  if (!mapping.title.trim()) return "Map a task title column";
  if (!mapping.doerName?.trim() && !mapping.doerEmail?.trim()) return "Map a doer name or doer email column";
  return null;
}
