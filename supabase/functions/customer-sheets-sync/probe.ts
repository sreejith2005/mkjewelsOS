// A read-only look at one sheet tab before it is imported: its real headers,
// how many rows it has, which columns are unique, and what dates look like.
// It writes nothing, to the sheet or to the database.
//
// What it returns about cell content is limited on purpose:
//   * counts (filled, distinct);
//   * shapes, where every letter run becomes "A" and every digit becomes "9"
//     ("14/11/2026 10:05:00" -> "99/99/9999 99:99:99");
//   * the values themselves only for a dropdown-like column: few distinct
//     values, each repeated many times, none holding a long digit run. Names,
//     phones, addresses and remarks never qualify.
import { CHUNK_ROWS, headerNames, readChunk, type SheetReader } from "./worker.ts";

/** A column lists its values only when it has at most this many distinct ones... */
export const VALUE_LIST_MAX_DISTINCT = 40;
/** ...and on average each is used at least this many times. */
export const VALUE_LIST_MIN_REPEAT = 20;
/** Distinct values are counted exactly up to this many per column. */
const DISTINCT_CAP = 200_000;

export interface TabInfo { title: string; rows: number; columns: number }

/** One spreadsheet file: its tabs, and a reader for one of them. */
export interface ProbeFile {
  tabs(): Promise<TabInfo[]>;
  reader(tab: string): SheetReader;
}

export interface ProbeColumn {
  column: number;
  name: string;
  filled: number;
  distinct: number;
  shapes: Array<{ shape: string; count: number }>;
  values?: Array<{ value: string; count: number }>;
}

export interface ProbeResult {
  header_row: number;
  first_data_row: number;
  last_filled_row: number;
  rows_filled: number;
  complete: boolean;
  reads: number;
  slowest_read_ms: number;
  total_ms: number;
  key?: { columns: string[]; filled: number; distinct: number };
  columns: ProbeColumn[];
}

export function shapeOf(value: string): string {
  return value.replace(/\p{L}+/gu, "A").replace(/\p{N}/gu, "9").slice(0, 40);
}

function top(counts: Map<string, number>, limit: number): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit);
}

export interface ProbeOptions { headerRow: number; keyColumns: string[]; deadline: number; now: () => number }

export async function probeTab(reader: SheetReader, options: ProbeOptions): Promise<ProbeResult> {
  const started = options.now();
  let reads = 0, slowest = 0;
  const timed: SheetReader = {
    async rows(from, to) {
      const begin = options.now();
      try { return await reader.rows(from, to); } finally {
        reads++;
        slowest = Math.max(slowest, options.now() - begin);
      }
    },
  };

  const names = headerNames((await timed.rows(options.headerRow, options.headerRow))[0] ?? []);
  if (!names.some(Boolean)) throw new Error("header_row_empty");
  if (!options.keyColumns.every((column) => names.includes(column))) throw new Error("key_column_missing");

  const stats = names.map(() => ({ filled: 0, values: new Map<string, number>(), shapes: new Map<string, number>(), capped: false }));
  const keys = new Set<string>();
  let keyFilled = 0, rowsFilled = 0, lastFilled = options.headerRow, complete = false;
  let from = options.headerRow + 1;

  for (;;) {
    const { rows, atEnd } = await readChunk(timed, from, CHUNK_ROWS);
    rows.forEach((cells, index) => {
      let any = false;
      names.forEach((name, column) => {
        const value = String(cells[column] ?? "").trim();
        if (!name || !value) return;
        any = true;
        const stat = stats[column];
        stat.filled++;
        if (stat.values.has(value) || stat.values.size < DISTINCT_CAP) stat.values.set(value, (stat.values.get(value) ?? 0) + 1);
        else stat.capped = true;
        const shape = shapeOf(value);
        stat.shapes.set(shape, (stat.shapes.get(shape) ?? 0) + 1);
      });
      if (!any) return;
      rowsFilled++;
      lastFilled = from + index;
      if (options.keyColumns.length) {
        const parts = options.keyColumns.map((column) => String(cells[names.indexOf(column)] ?? "").trim());
        if (parts.some(Boolean)) { keyFilled++; keys.add(parts.join("|")); }
      }
    });
    from += rows.length;
    if (atEnd) { complete = true; break; }
    if (options.deadline - options.now() < 35_000) break;
  }

  const columns: ProbeColumn[] = [];
  names.forEach((name, index) => {
    if (!name) return;
    const stat = stats[index];
    const column: ProbeColumn = {
      column: index + 1, name, filled: stat.filled, distinct: stat.capped ? -1 : stat.values.size,
      shapes: top(stat.shapes, 3).map(([shape, count]) => ({ shape, count })),
    };
    const dropdownLike = !stat.capped && stat.values.size > 0 && stat.values.size <= VALUE_LIST_MAX_DISTINCT &&
      stat.filled >= stat.values.size * VALUE_LIST_MIN_REPEAT &&
      ![...stat.values.keys()].some((value) => /\d{7,}/.test(value.replace(/[\s\-()+.]/g, "")));
    if (dropdownLike) column.values = top(stat.values, VALUE_LIST_MAX_DISTINCT).map(([value, count]) => ({ value: value.slice(0, 80), count }));
    columns.push(column);
  });

  return {
    header_row: options.headerRow, first_data_row: options.headerRow + 1, last_filled_row: lastFilled, rows_filled: rowsFilled,
    complete, reads, slowest_read_ms: slowest, total_ms: options.now() - started,
    ...(options.keyColumns.length ? { key: { columns: options.keyColumns, filled: keyFilled, distinct: keys.size } } : {}),
    columns,
  };
}

export interface ProbeRequest { file: string; tab?: string; headerRow: number; keyColumns: string[] }

/** Validates the "probe" part of a request body. Returns a message when it is not usable. */
export function parseProbe(value: unknown): ProbeRequest | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "probe must be an object";
  const body = value as { file?: unknown; tab?: unknown; header_row?: unknown; key?: unknown };
  if (typeof body.file !== "string" || !body.file) return "probe.file is required";
  if (body.tab !== undefined && (typeof body.tab !== "string" || !body.tab.trim())) return "probe.tab must be text";
  let headerRow = 1;
  if (body.header_row !== undefined) {
    if (!Number.isInteger(body.header_row) || (body.header_row as number) < 1 || (body.header_row as number) > 100) return "probe.header_row must be an integer from 1 to 100";
    headerRow = body.header_row as number;
  }
  let keyColumns: string[] = [];
  if (body.key !== undefined) {
    if (!Array.isArray(body.key) || body.key.length > 4 || !body.key.every((item) => typeof item === "string" && item)) return "probe.key must be a list of up to 4 column names";
    keyColumns = body.key as string[];
  }
  return { file: body.file, tab: body.tab as string | undefined, headerRow, keyColumns };
}

/** Runs a probe. With no tab it lists the file's tabs; with a tab it reads that tab. */
export async function runProbe(file: ProbeFile, request: ProbeRequest, deadline: number, now: () => number): Promise<Record<string, unknown>> {
  if (!request.tab) return { probe: "tabs", file: request.file, tabs: await file.tabs() };
  const result = await probeTab(file.reader(request.tab), { headerRow: request.headerRow, keyColumns: request.keyColumns, deadline, now });
  return { probe: "tab", file: request.file, tab: request.tab, ...result };
}
