// Reads Google Sheets (read-only) and hands their rows to the customer schema.
// Pure logic with injected dependencies, so it is tested without Google or a
// database. Nothing here ever writes to a sheet, and no row content is logged
// or returned: responses carry counts only.

import { parseProbe, runProbe, type ProbeFile, type ProbeRequest } from "./probe.ts";

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
/**
 * Google allows one account about 60 sheet reads a minute; past that it
 * answers 429. One run reads at most this many times across all sheets.
 */
export const READS_PER_RUN = 40;
/** Waits before retrying a read refused with 429. */
export const RATE_LIMIT_WAITS_MS = [2_000, 5_000, 10_000];
/** The smallest batch: a batch that is cancelled for time is retried four times smaller, down to this. */
export const MIN_APPLY_BATCH = 5;
/**
 * Rows removed per database call at the end of a full pass. Removing a row
 * recalculates its customers, so 200 at once ran past the API's 8-second limit
 * (MASTER DATABASE, 2026-11-20: "finish_failed_57014" on every pass, so rows
 * deleted from the sheet were never taken out). A cancelled call changed
 * nothing and is retried smaller, down to one row.
 */
export const FINISH_BATCH = 25;
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
  /** scheduled: false when the sheet is not switched on for the scheduled job (missing = on, for older databases). */
  state(source: string): Promise<{ next_row: number; scan_row: number; pending: number; completed: boolean; scheduled?: boolean }>;
  store(source: string, rows: IngestRow[], options: StoreOptions): Promise<{ new: number; changed: number }>;
  apply(source: string, limit: number): Promise<{ applied: number; rejected: number; pending: number }>;
  finishScan(source: string, limit: number): Promise<{ removed: number; remaining: boolean; blocked: boolean }>;
  noteError(source: string, message: string): Promise<void>;
  /** When each sheet was last read (ISO time, or null when never). Optional: older databases rotate instead. */
  lastRuns?(): Promise<Readonly<Record<string, string | null>>>;
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
  /** The row holding the headers (default 1). Data starts on the next row. */
  headerRow?: number;
  /** Rows applied per database call when a row is heavy (default APPLY_BATCH). */
  applyBatch?: number;
  /** Null when the sheet's secrets are not set; the source is then skipped. */
  reader: SheetReader | null;
}

export interface SyncDeps {
  secret: string | undefined;
  sources: SheetSource[];
  gateway: IngestGateway | null;
  /** Waits, for the retry after a 429. Tests pass a stand-in. */
  sleep?: (ms: number) => Promise<void>;
  /** A spreadsheet file by its short name, for a read-only probe. Null when its secret is not set. */
  probeFile?: (file: string) => ProbeFile | null | undefined;
  now?: () => number;
}

/** Sheets in the order to read them: never read first, then the longest wait; ties keep the list order. */
export function stalestFirst(sources: readonly SheetSource[], runs: Readonly<Record<string, string | null>>): SheetSource[] {
  const at = (source: string) => {
    const value = runs[source];
    const time = value ? Date.parse(value) : Number.NaN;
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };
  return sources.map((config, index) => ({ config, index, time: at(config.source) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map((item) => item.config);
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

interface RunOptions { maxChunks: number; scanChunks: number; deadline: number; now: () => number; restart?: boolean; scheduledOnly?: boolean }

/**
 * Sheet reads shared by every sheet of one run: at most READS_PER_RUN, and a
 * read refused with 429 is retried after a wait. When the reads are used up,
 * or Google keeps refusing, the run reads nothing more ("read_limit"); rows
 * already stored are still applied. That is a pause, not a failure.
 */
export class ReadLimiter {
  private used = 0;
  private stopped = false;
  private readonly budget: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeLeft: () => number;
  constructor(budget: number, sleep: (ms: number) => Promise<void>, timeLeft: () => number) {
    this.budget = budget;
    this.sleep = sleep;
    this.timeLeft = timeLeft;
  }
  get reads(): number { return this.used; }
  wrap(reader: SheetReader): SheetReader {
    return {
      rows: async (from, to) => {
        for (let attempt = 0; ; attempt++) {
          if (this.stopped || this.used >= this.budget) throw new Error("read_limit");
          this.used++;
          try {
            return await reader.rows(from, to);
          } catch (error) {
            if (!(error instanceof Error) || error.message !== "sheet_read_failed_429") throw error;
            const wait = RATE_LIMIT_WAITS_MS[attempt];
            if (wait === undefined || this.timeLeft() < wait + 30_000) { this.stopped = true; throw new Error("read_limit"); }
            await this.sleep(wait);
          }
        }
      },
    };
  }
}

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
  const headerRow = config.headerRow ?? 1;
  const firstRow = headerRow + 1;

  if (options.scheduledOnly && state.scheduled === false) {
    // Switched off for the scheduled job: a new sheet is run by hand first.
    result.skipped = "not_scheduled";
    return result;
  }
  if (config.oneTime && state.completed && !options.restart) {
    result.skipped = "already_imported";
    result.reached_end = true;
  } else try {
    const header = await reader.rows(headerRow, headerRow);
    const names = headerNames(header[0] ?? []);
    const missing = keyColumns.filter((column) => !names.includes(column));
    // The column names (headers, not cell values) say which one to put back.
    if (missing.length) throw new Error(`key_column_missing:${missing.join(", ")}`);
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
    let from = options.restart ? firstRow : Math.max(firstRow, state.next_row - OVERLAP_ROWS);
    let shrinkChecked = options.restart === true || from === firstRow;
    // A one-time sheet reads as many chunks as the time allows; they start small.
    const tailChunks = config.oneTime && options.maxChunks > 0 ? 500 : options.maxChunks;
    for (let chunk = 0; chunk < tailChunks; chunk++) {
      const { rows, atEnd } = await read(from);
      // Rows that were read before are gone: rows were deleted from the sheet, so
      // everything below moved up. Read again from the top; rows that moved keep their key.
      if (!shrinkChecked) {
        shrinkChecked = true;
        if (rows.length < state.next_row - from) { from = firstRow; chunk--; continue; }
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
      let scanFrom = Math.max(firstRow, state.scan_row);
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
          let finishBatch = FINISH_BATCH;
          const finish = async () => {
            for (;;) {
              try {
                return await gateway.finishScan(source, finishBatch);
              } catch (error) {
                if (error instanceof Error && error.message === "finish_failed_57014" && finishBatch > 1) {
                  finishBatch = Math.max(1, Math.floor(finishBatch / 4));
                  continue;
                }
                throw error;
              }
            }
          };
          let finished = await finish();
          result.removed += finished.removed;
          while (finished.remaining && timeLeft() > 30_000) {
            finished = await finish();
            result.removed += finished.removed;
          }
          result.full_pass_done = !finished.remaining;
          if (finished.blocked) result.error = "too_many_rows_missing";
          break;
        }
      }
    }
  } catch (error) {
    // Out of reads for this run: what was stored is applied below; the next
    // run carries on from the stored position.
    if (!(error instanceof Error) || error.message !== "read_limit") throw error;
    result.skipped = "read_limit";
  }

  result.pending = state.pending + result.new + result.changed;
  // A database call through the API is cancelled after about 8 seconds
  // (code 57014). A cancelled batch changed nothing, so it is retried smaller.
  let batch = config.applyBatch ?? APPLY_BATCH;
  while (result.pending > 0 && timeLeft() > 0) {
    let applied: { applied: number; rejected: number; pending: number };
    try {
      applied = await gateway.apply(source, batch);
    } catch (error) {
      if (error instanceof Error && error.message === "apply_failed_57014" && batch > MIN_APPLY_BATCH) {
        batch = Math.max(MIN_APPLY_BATCH, Math.floor(batch / 4));
        continue;
      }
      throw error;
    }
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
  let probe: ProbeRequest | null = null;
  try {
    const body = request.headers.get("content-length") === "0" ? {} : await request.json() as { max_chunks?: unknown; restart?: unknown; source?: unknown; probe?: unknown };
    if (body.probe !== undefined) {
      const parsed = parseProbe(body.probe);
      if (typeof parsed === "string") return json(400, { error: parsed });
      probe = parsed;
    }
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

  // A probe only looks at a sheet. It never stores or applies anything, and a
  // request that carries one does no import.
  if (probe) {
    const file = deps.probeFile?.(probe.file);
    if (file === undefined) return json(400, { error: "Unknown file" });
    if (file === null) return json(400, { error: "The secret for this file is not set" });
    try {
      return json(200, await runProbe(file, probe, deadline, now));
    } catch (error) {
      const code = error instanceof Error && /^[a-z_0-9]+$/.test(error.message) ? error.message : "probe_failed";
      return json(502, { probe: probe.tab ? "tab" : "tabs", file: probe.file, error: code });
    }
  }

  const results: SyncResult[] = [];
  let failed = false;
  const limiter = new ReadLimiter(READS_PER_RUN, deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))), () => deadline - now());
  // The scheduled run reads the sheet that has waited longest first. A run has
  // time for a few sheets only, and with about 30 sheets a fixed rotation left
  // MASTER DATABASE unread for over an hour (2026-11-20). Without the last-read
  // times (older database, or the call failed) it rotates every 5 minutes.
  let ordered = deps.sources;
  if (!only) {
    let runs: Readonly<Record<string, string | null>> | null = null;
    try { runs = deps.gateway.lastRuns ? await deps.gateway.lastRuns() : null; } catch { runs = null; }
    if (runs) {
      ordered = stalestFirst(deps.sources, runs);
    } else {
      const turn = Math.floor(now() / 300_000) % Math.max(1, deps.sources.length);
      ordered = [...deps.sources.slice(turn), ...deps.sources.slice(0, turn)];
    }
  }
  for (const config of ordered) {
    if (only && config.source !== only) continue;
    // A one-time sheet is large and slow; it runs only when asked for by name,
    // so it never takes time from the live sheets.
    if (!only && config.oneTime) continue;
    if (!config.reader) continue;
    if (deadline - now() < 20_000) break;
    try {
      results.push(await syncSheet({ ...config, reader: limiter.wrap(config.reader) }, deps.gateway, {
        maxChunks, scanChunks: maxChunks === 0 ? 0 : SCAN_CHUNKS, deadline, now, restart, scheduledOnly: !only,
      }));
    } catch (error) {
      // Only a short code is stored or returned, optionally with a tab or
      // column name after ":"; never sheet content. An error without a code of
      // its own is reported by its type, for example sync_failed_timeouterror,
      // so the cause can be found without a log.
      const kind = error instanceof Error ? error.name.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
      const code = error instanceof Error && /^[a-z_0-9]+(:[^\r\n]{1,120})?$/.test(error.message) ? error.message : kind ? `sync_failed_${kind}` : "sync_failed";
      try { await deps.gateway.noteError(config.source, code); } catch { /* The response still reports the failure. */ }
      results.push({ source: config.source, rows_read: 0, new: 0, changed: 0, applied: 0, rejected: 0, pending: 0, removed: 0, reached_end: false, full_pass_done: false, error: code });
      failed = true;
    }
  }
  // One sheet failing does not stop the others; the status says whether any did.
  return json(failed ? 502 : 200, { sources: results });
}
