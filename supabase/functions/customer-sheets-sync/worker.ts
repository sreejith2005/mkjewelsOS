// Reads a Google Sheet (read-only) and hands its rows to the customer schema.
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
/** Rows re-read before the cursor on every run, to catch recent edits. */
export const OVERLAP_ROWS = 300;
/** Rows applied per database call. */
export const APPLY_BATCH = 1000;

export interface SheetReader {
  /** Values of rows [fromRow, toRow] (1-based, inclusive), as shown in the sheet. */
  rows(fromRow: number, toRow: number): Promise<string[][]>;
}

export interface IngestGateway {
  state(source: string): Promise<{ next_row: number; pending: number }>;
  store(source: string, rows: IngestRow[], nextRow: number): Promise<{ new: number; changed: number }>;
  apply(source: string, limit: number): Promise<{ applied: number; rejected: number; pending: number }>;
  noteError(source: string, message: string): Promise<void>;
}

export interface IngestRow {
  row_key: string;
  sheet_row: number;
  payload: Record<string, string>;
}

export interface SyncDeps {
  secret: string | undefined;
  reader: SheetReader | null;
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
  reached_end: boolean;
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
 * fully empty row is skipped. The row key is the key column, or "row:<n>" when
 * that cell is empty.
 */
export function toIngestRows(names: string[], rows: string[][], firstRow: number, keyColumn: string): IngestRow[] {
  const out: IngestRow[] = [];
  rows.forEach((cells, index) => {
    const payload: Record<string, string> = {};
    names.forEach((name, column) => {
      const value = String(cells[column] ?? "").trim();
      if (name && value) payload[name] = value;
    });
    if (Object.keys(payload).length === 0) return;
    const sheetRow = firstRow + index;
    out.push({ row_key: payload[keyColumn] || `row:${sheetRow}`, sheet_row: sheetRow, payload });
  });
  return out;
}

/**
 * One run: continue reading where the last run stopped (re-reading a small
 * overlap for edits), store the rows, then apply queued rows until the time
 * budget is used. Safe to call again at any time.
 */
export async function syncSheet(
  source: string,
  keyColumn: string,
  reader: SheetReader,
  gateway: IngestGateway,
  options: { maxChunks: number; budgetMs: number; now: () => number; restart?: boolean },
): Promise<SyncResult> {
  const started = options.now();
  const result: SyncResult = { source, rows_read: 0, new: 0, changed: 0, applied: 0, rejected: 0, pending: 0, reached_end: false };

  const header = await reader.rows(1, 1);
  const names = headerNames(header[0] ?? []);
  if (!names.includes(keyColumn)) throw new Error("key_column_missing");

  const state = await gateway.state(source);
  // restart re-reads the sheet from the top over the next runs; unchanged rows cost nothing.
  let from = options.restart ? 2 : Math.max(2, state.next_row - OVERLAP_ROWS);
  for (let chunk = 0; chunk < options.maxChunks; chunk++) {
    const rows = await reader.rows(from, from + CHUNK_ROWS - 1);
    const ingest = toIngestRows(names, rows, from, keyColumn);
    // Google omits trailing empty rows, so rows.length is the last filled row read.
    const nextRow = from + rows.length;
    const stored = await gateway.store(source, ingest, nextRow);
    result.rows_read += ingest.length;
    result.new += stored.new;
    result.changed += stored.changed;
    from = nextRow;
    if (rows.length < CHUNK_ROWS) { result.reached_end = true; break; }
    if (options.now() - started > options.budgetMs / 2) break;
  }

  result.pending = state.pending + result.new + result.changed;
  while (result.pending > 0 && options.now() - started < options.budgetMs) {
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
  if (!deps.secret || !deps.reader || !deps.gateway) return json(500, { error: "Function secrets are not configured" });
  if (request.headers.get("x-cron-secret") !== deps.secret) return json(401, { error: "Scheduler authorization required" });

  let maxChunks = 5, restart = false;
  try {
    const body = request.headers.get("content-length") === "0" ? {} : await request.json() as { max_chunks?: unknown; restart?: unknown };
    if (body.restart !== undefined) {
      if (typeof body.restart !== "boolean") return json(400, { error: "restart must be true or false" });
      restart = body.restart;
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

  try {
    const result = await syncSheet("runo", "callId", deps.reader, deps.gateway, {
      maxChunks, restart, budgetMs: 100_000, now: deps.now ?? Date.now,
    });
    return json(200, result);
  } catch (error) {
    // Only a short code is stored or returned; never sheet content.
    const code = error instanceof Error && /^[a-z_0-9]+$/.test(error.message) ? error.message : "sync_failed";
    try { await deps.gateway.noteError("runo", code); } catch { /* The response still reports the failure. */ }
    return json(502, { error: code });
  }
}
