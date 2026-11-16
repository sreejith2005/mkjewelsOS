// Reads Google Sheets (read-only) and hands their rows to the customer schema.
// Pure logic with injected dependencies, so it is tested without Google or a
// database. Nothing here ever writes to a sheet, and no row content is logged
// or returned: responses carry counts only.

export const responseHeaders = {
  "Access-Control-Allow-Headers": "content-type,x-cron-secret",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

/** Sheet rows per read. One read is one Google request. */
export const CHUNK_ROWS = 1000;
/** Rows re-read before the cursor on every run, to catch recent edits quickly. */
export const OVERLAP_ROWS = 300;
/**
 * Rows applied per database call. Kept small on purpose: a database call made
 * through the API is cancelled after about 8 seconds, and one row costs a few
 * milliseconds (more while the tables are new). 1000 per call failed in
 * production on 2026-11-14.
 */
export const APPLY_BATCH = 100;
/** A one-time (large, old) sheet starts each run with this many rows per read and grows while reads are fast. */
export const ONE_TIME_START_ROWS = 250;
/** The fewest rows asked for when reads are slow. */
export const MIN_READ_ROWS = 25;
/** Chunks of the whole-sheet pass read per run. The pass finds edits and deletions anywhere. */
export const SCAN_CHUNKS = 5;

export interface SheetReader {
  /** Values of rows [fromRow, toRow] (1-based, inclusive), as shown in the sheet. */
  rows(fromRow: number, toRow: number): Promise<string[][]>;
}

export interface IngestRow {
  row_key: string;
  sheet_row: number;
  payload: Record<string, string>;
}

export interface StoreOptions {
  headers?: string[];
  next_row?: number;
  scan?: boolean;
  scan_row?: number;
  completed?: boolean;
}

export interface IngestGateway {
  state(source: string): Promise<{ next_row: number; scan_row: number; pending: number; completed: boolean }>;
  store(source: string, rows: IngestRow[], options: StoreOptions): Promise<{ new: number; changed: number }>;
  apply(source: string, limit: number): Promise<{ applied: number; rejected: number; pending: number }>;
  finishScan(source: string): Promise<{ removed: number; remaining: boolean; blocked: boolean }>;
  noteError(source: string, message: string): Promise<void>;
}

/** One sheet to import. */
export interface SheetSource {
  source: string;
  /**
   * The columns that together identify one row. More than one when no single
   * column is unique: in the old Runo sheet "Unique id" repeats across calls
   * (36,577 rows, 20,707 ids), and id + Interaction Date is unique.
   */
  keyColumns: readonly string[];
  /** A sheet nobody edits any more: read once to the end, then left alone. */
  oneTime: boolean;
  /** Null when the sheet's secrets are not set; the source is then skipped. */
  reader: SheetReader | null;
}

export interface SyncDeps {
  secret: string | undefined;
  sources: SheetSource[];
  gateway: IngestGateway | null;
  now?: () => number;
}

export interface SyncResult {
  source: string;
  rows_read: number;
  new: number;
  changed: number;
  applied: number;
  rejected: number;
  pending: number;
  removed: number;
  reached_end: boolean;
  full_pass_done: boolean;
  skipped?: string;
  error?: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

/** Header cells -> unique column names. A repeated header gets " (2)", " (3)". */
export function headerNames(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((cell) => {
    const name = String(cell ?? "").trim();
    if (!name) return "";
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

/**
 * Sheet rows -> payload objects keyed by header. Empty cells are left out and a
 * fully empty row is skipped. The row key is the key columns joined by "|", or
 * "row:<n>" when all of them are empty.
 */
export function toIngestRows(names: string[], rows: string[][], firstRow: number, keyColumns: readonly string[]): IngestRow[] {
  const out: IngestRow[] = [];
  rows.forEach((cells, index) => {
    const payload: Record<string, string> = {};
    names.forEach((name, column) => {
      const value = String(cells[column] ?? "").trim();
      if (name && value) payload[name] = value;
    });
    if (Object.keys(payload).length === 0) return;
    const sheetRow = firstRow + index;
    const parts = keyColumns.map((column) => payload[column] ?? "");
    out.push({ row_key: parts.some(Boolean) ? parts.join("|") : `row:${sheetRow}`, sheet_row: sheetRow, payload });
  });
  return out;
}

/**
 * Read one chunk starting at `from`, and say whether the sheet ends there.
 * Google leaves out empty rows at the end of the range it is asked for, so a
 * short answer can also mean "blank rows here, more data below". A short answer
 * is therefore checked by reading on: only an empty follow-up read is the end.
 * (A gap of more than CHUNK_ROWS blank rows is treated as the end.)
 */
export async function readChunk(reader: SheetReader, from: number, size: number = CHUNK_ROWS): Promise<{ rows: string[][]; atEnd: boolean }> {
  let rows = await reader.rows(from, from + size - 1);
  while (rows.length < size) {
    const more = await reader.rows(from + rows.length, from + rows.length + size - 1);
    if (more.length === 0) return { rows, atEnd: true };
    rows = rows.concat(more);
  }
  return { rows, atEnd: false };
}

interface RunOptions { maxChunks: number; scanChunks: number; deadline: number; now: () => number; restart?: boolean }

/**
 * One run for one sheet. Safe to call again at any time.
 *  1. Tail: continue where the last run stopped, re-reading a small overlap,
 *     so new rows and recent edits arrive within one run.
 *  2. Full pass (live sheets, once the tail is caught up): read the next slice
 *     of the whole sheet. When the pass reaches the end, rows that were not
 *     seen in it are gone from the sheet and are removed.
 *  3. Apply queued rows until the time budget is used.
 */
export async function syncSheet(config: SheetSource & { reader: SheetReader }, gateway: IngestGateway, options: RunOptions): Promise<SyncResult> {
  const { source, keyColumns, reader } = config;
  const result: SyncResult = {
    source, rows_read: 0, new: 0, changed: 0, applied: 0, rejected: 0, pending: 0, removed: 0, reached_end: false, full_pass_done: false,
  };
  const state = await gateway.state(source);
  const timeLeft = () => options.deadline - options.now();

  if (config.oneTime && state.completed && !options.restart) {
    result.skipped = "already_imported";
    result.reached_end = true;
  } else {
    const header = await reader.rows(1, 1);
    const names = headerNames(header[0] ?? []);
    if (!keyColumns.every((column) => names.includes(column))) throw new Error("key_column_missing");
    const headers = names.filter(Boolean);

    // Some regions of a large sheet answer slowly. A read that times out is
    // repeated with half the rows; a read that works doubles the next one.
    let size = config.oneTime ? ONE_TIME_START_ROWS : CHUNK_ROWS;
    const read = async (start: number) => {
      for (;;) {
        try {
          const chunk = await readChunk(reader, start, size);
          const used = size;
          size = Math.min(CHUNK_ROWS, size * 2);
          return { ...chunk, used };
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "sheet_read_timeout") throw error;
          if (size <= MIN_READ_ROWS) throw new Error(`sheet_read_timeout_row_${start}`);
          size = Math.max(MIN_READ_ROWS, Math.floor(size / 2));
          if (timeLeft() < 35_000) throw new Error(`sheet_read_timeout_row_${start}`);
        }
      }
    };

    // restart re-reads the sheet from the top over the next runs; unchanged rows cost nothing.
    let from = options.restart ? 2 : Math.max(2, state.next_row - OVERLAP_ROWS);
    let shrinkChecked = options.restart === true || from === 2;
    // A one-time sheet reads as many chunks as the time allows; they start small.
    const tailChunks = config.oneTime && options.maxChunks > 0 ? 500 : options.maxChunks;
    for (let chunk = 0; chunk < tailChunks; chunk++) {
      const { rows, atEnd } = await read(from);
      // Rows that were read before are gone: rows were deleted from the sheet, so
      // everything below moved up. Read again from the top; rows that moved keep their key.
      if (!shrinkChecked) {
        shrinkChecked = true;
        if (rows.length < state.next_row - from) { from = 2; chunk--; continue; }
      }
      const ingest = toIngestRows(names, rows, from, keyColumns);
      // Google omits trailing empty rows, so rows.length is the last filled row read.
      const nextRow = from + rows.length;
      const stored = await gateway.store(source, ingest, { headers, next_row: nextRow, completed: config.oneTime && atEnd ? true : undefined });
      result.rows_read += ingest.length;
      result.new += stored.new;
      result.changed += stored.changed;
      from = nextRow;
      if (atEnd) { result.reached_end = true; break; }
      if (timeLeft() < 40_000) break;
    }

    if (!config.oneTime && result.reached_end) {
      let scanFrom = Math.max(2, state.scan_row);
      for (let chunk = 0; chunk < options.scanChunks && timeLeft() > 40_000; chunk++) {
        const { rows, atEnd } = await read(scanFrom);
        const ingest = toIngestRows(names, rows, scanFrom, keyColumns);
        scanFrom += rows.length;
        const stored = await gateway.store(source, ingest, { headers, scan: true, scan_row: scanFrom });
        result.rows_read += ingest.length;
        result.new += stored.new;
        result.changed += stored.changed;
        if (atEnd) {
          // The pass has read the whole sheet.
          let finished = await gateway.finishScan(source);
          result.removed += finished.removed;
          while (finished.remaining && timeLeft() > 30_000) {
            finished = await gateway.finishScan(source);
            result.removed += finished.removed;
          }
          result.full_pass_done = !finished.remaining;
          if (finished.blocked) result.error = "too_many_rows_missing";
          break;
        }
      }
    }
  }

  result.pending = state.pending + result.new + result.changed;
  while (result.pending > 0 && timeLeft() > 0) {
    const applied = await gateway.apply(source, APPLY_BATCH);
    result.applied += applied.applied;
    result.rejected += applied.rejected;
    result.pending = applied.pending;
    if (applied.applied + applied.rejected === 0) break;
  }
  return result;
}

export async function handleSyncRequest(request: Request, deps: SyncDeps): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!deps.secret || !deps.gateway || !deps.sources.some((item) => item.reader)) return json(500, { error: "Function secrets are not configured" });
  if (request.headers.get("x-cron-secret") !== deps.secret) return json(401, { error: "Scheduler authorization required" });

  let maxChunks = 5, restart = false, only: string | null = null;
  try {
    const body = request.headers.get("content-length") === "0" ? {} : await request.json() as { max_chunks?: unknown; restart?: unknown; source?: unknown };
    if (body.restart !== undefined) {
      if (typeof body.restart !== "boolean") return json(400, { error: "restart must be true or false" });
      restart = body.restart;
    }
    if (body.source !== undefined) {
      if (typeof body.source !== "string" || !deps.sources.some((item) => item.source === body.source)) return json(400, { error: "Unknown source" });
      only = body.source;
    }
    if (body.max_chunks !== undefined) {
      if (!Number.isInteger(body.max_chunks) || (body.max_chunks as number) < 0 || (body.max_chunks as number) > 20) {
        return json(400, { error: "max_chunks must be an integer from 0 to 20" });
      }
      maxChunks = body.max_chunks as number;
    }
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const now = deps.now ?? Date.now;
  const deadline = now() + 100_000;
  const results: SyncResult[] = [];
  let failed = false;
  for (const config of deps.sources) {
    if (only && config.source !== only) continue;
    // A one-time sheet is large and slow; it runs only when asked for by name,
    // so it never takes time from the live sheets.
    if (!only && config.oneTime) continue;
    if (!config.reader) continue;
    if (deadline - now() < 20_000) break;
    try {
      results.push(await syncSheet({ ...config, reader: config.reader }, deps.gateway, {
        maxChunks, scanChunks: maxChunks === 0 ? 0 : SCAN_CHUNKS, deadline, now, restart,
      }));
    } catch (error) {
      // Only a short code is stored or returned; never sheet content. An error
      // without a code of its own is reported by its type, for example
      // sync_failed_timeouterror, so the cause can be found without a log.
      const kind = error instanceof Error ? error.name.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
      const code = error instanceof Error && /^[a-z_0-9]+$/.test(error.message) ? error.message : kind ? `sync_failed_${kind}` : "sync_failed";
      try { await deps.gateway.noteError(config.source, code); } catch { /* The response still reports the failure. */ }
      results.push({ source: config.source, rows_read: 0, new: 0, changed: 0, applied: 0, rejected: 0, pending: 0, removed: 0, reached_end: false, full_pass_done: false, error: code });
      failed = true;
    }
  }
  // One sheet failing does not stop the others; the status says whether any did.
  return json(failed ? 502 : 200, { sources: results });
}
