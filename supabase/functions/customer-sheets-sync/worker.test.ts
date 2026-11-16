import { assertEquals } from "@std/assert";
import {
  CHUNK_ROWS, handleSyncRequest, headerNames, readChunk, toIngestRows,
  type IngestGateway, type IngestRow, type SheetReader, type SheetSource, type StoreOptions, type SyncDeps,
} from "./worker.ts";

function fakeSheet(dataRows: string[][], key = "callId"): SheetReader & { reads: Array<[number, number]> } {
  const all = [[key, "Mobile Number", "Name", "Status", "Status"], ...dataRows];
  const reads: Array<[number, number]> = [];
  // Like Google: empty rows at the end of the requested range are left out.
  return { reads, rows(from, to) {
    reads.push([from, to]);
    const rows = all.slice(from - 1, to);
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    return Promise.resolve(rows);
  } };
}

function fakeGateway(initial: Record<string, { next_row?: number; scan_row?: number; completed?: boolean }> = {}) {
  const stored: Array<{ source: string; rows: IngestRow[]; options: StoreOptions }> = [];
  const state = new Map<string, { next_row: number; scan_row: number; pending: number; completed: boolean }>();
  const of = (source: string) => {
    if (!state.has(source)) state.set(source, { next_row: initial[source]?.next_row ?? 2, scan_row: initial[source]?.scan_row ?? 2, pending: 0, completed: initial[source]?.completed ?? false });
    return state.get(source)!;
  };
  const errors: string[] = []; const finished: string[] = []; const applyLimits: number[] = [];
  const gateway: IngestGateway = {
    state: (source) => Promise.resolve({ ...of(source) }),
    store(source, rows, options) {
      stored.push({ source, rows, options });
      const current = of(source);
      const fresh = options.scan ? 0 : rows.length;
      current.pending += fresh;
      if (options.next_row !== undefined) current.next_row = options.next_row;
      if (options.scan_row !== undefined) current.scan_row = options.scan_row;
      if (options.completed) current.completed = true;
      return Promise.resolve({ new: fresh, changed: 0 });
    },
    apply(source, limit) { applyLimits.push(limit); const current = of(source); const n = Math.min(limit, current.pending); current.pending -= n; return Promise.resolve({ applied: n, rejected: 0, pending: current.pending }); },
    finishScan(source) { finished.push(source); of(source).scan_row = 2; return Promise.resolve({ removed: 1, remaining: false, blocked: false }); },
    noteError(source, message) { errors.push(`${source}:${message}`); return Promise.resolve(); },
  };
  return { gateway, stored, errors, finished, applyLimits, of };
}

const live = (reader: SheetReader | null): SheetSource => ({ source: "runo", keyColumn: "callId", oneTime: false, reader });
const old = (reader: SheetReader | null): SheetSource => ({ source: "runo_old", keyColumn: "Unique id", oneTime: true, reader });
const deps = (sources: SheetSource[], gateway: IngestGateway): SyncDeps => ({ secret: "s", sources, gateway });
const post = (secret = "s", body = "{}") =>
  new Request("http://x", { method: "POST", headers: { "x-cron-secret": secret, "content-type": "application/json" }, body });
const calls = (count: number, prefix = "c") => Array.from({ length: count }, (_, i) => [`${prefix}${i}`, "9820000001", "A", "Interested"]);

Deno.test("headers and rows become keyed payloads", () => {
  const names = headerNames(["callId", " Name ", "", "Status", "Status"]);
  assertEquals(names, ["callId", "Name", "", "Status", "Status (2)"]);
  const rows = toIngestRows(names, [["c1", " Meera ", "x", "Interested"], [], ["", "No Key"]], 2, "callId");
  assertEquals(rows, [
    { row_key: "c1", sheet_row: 2, payload: { callId: "c1", Name: "Meera", Status: "Interested" } },
    { row_key: "row:4", sheet_row: 4, payload: { Name: "No Key" } },
  ]);
});

Deno.test("blank rows at the end of a read are not mistaken for the end of the sheet", async () => {
  // Rows 2-999 filled, 1000-1001 blank, 1002-1003 filled.
  const data = [...calls(998), [], [], ...calls(2, "z")];
  const first = await readChunk(fakeSheet(data), 2);
  assertEquals([first.rows.length, first.atEnd], [1002, false]);
  assertEquals(first.rows.at(-1)?.[0], "z1");
  assertEquals((await readChunk(fakeSheet(data), 1004)).atEnd, true);
  const exact = await readChunk(fakeSheet(calls(CHUNK_ROWS)), 2);
  assertEquals([exact.rows.length, exact.atEnd], [CHUNK_ROWS, false]);
  const empty = await readChunk(fakeSheet(calls(3)), 5);
  assertEquals([empty.rows.length, empty.atEnd], [0, true]);
});

Deno.test("authorization is checked before any read", async () => {
  const sheet = fakeSheet([]); const { gateway } = fakeGateway();
  assertEquals((await handleSyncRequest(post("wrong"), deps([live(sheet)], gateway))).status, 401);
  assertEquals((await handleSyncRequest(new Request("http://x"), deps([live(sheet)], gateway))).status, 405);
  assertEquals((await handleSyncRequest(post(), { ...deps([live(sheet)], gateway), secret: undefined })).status, 500);
  assertEquals((await handleSyncRequest(post(), deps([live(null)], gateway))).status, 500);
  assertEquals(sheet.reads.length, 0);
});

Deno.test("a run stores new rows with the headers, applies them and returns counts only", async () => {
  const sheet = fakeSheet(calls(2)); const fake = fakeGateway();
  const response = await handleSyncRequest(post(), deps([live(sheet)], fake.gateway));
  assertEquals(response.status, 200);
  const [result] = (await response.json()).sources;
  assertEquals({ rows_read: result.rows_read, new: result.new, applied: result.applied, pending: result.pending, reached_end: result.reached_end },
    { rows_read: 4, new: 2, applied: 2, pending: 0, reached_end: true });
  assertEquals(fake.stored[0].options, { headers: ["callId", "Mobile Number", "Name", "Status", "Status (2)"], next_row: 4, completed: undefined });
  assertEquals(fake.stored[0].rows.map((row) => row.row_key), ["c0", "c1"]);
});

Deno.test("once the tail is caught up, the full pass reads the whole sheet and closes it", async () => {
  const sheet = fakeSheet(calls(CHUNK_ROWS + 5)); const fake = fakeGateway({ runo: { next_row: CHUNK_ROWS + 7 } });
  const response = await handleSyncRequest(post(), deps([live(sheet)], fake.gateway));
  const [result] = (await response.json()).sources;
  // Each short read is followed by one check that the sheet really ends there.
  assertEquals(sheet.reads, [[1, 1], [CHUNK_ROWS - 293, 2 * CHUNK_ROWS - 294], [CHUNK_ROWS + 7, 2 * CHUNK_ROWS + 6],
    [2, CHUNK_ROWS + 1], [CHUNK_ROWS + 2, 2 * CHUNK_ROWS + 1], [CHUNK_ROWS + 7, 2 * CHUNK_ROWS + 6]]);
  assertEquals(fake.stored.map((call) => [call.options.scan ?? false, call.options.scan_row ?? null]), [[false, null], [true, CHUNK_ROWS + 2], [true, CHUNK_ROWS + 7]]);
  assertEquals(fake.finished, ["runo"]);
  assertEquals([result.full_pass_done, result.removed], [true, 1]);
});

Deno.test("the full pass continues from where the last run stopped", async () => {
  const sheet = fakeSheet(calls(8 * CHUNK_ROWS)); const fake = fakeGateway({ runo: { next_row: 8 * CHUNK_ROWS + 2, scan_row: CHUNK_ROWS + 2 } });
  await handleSyncRequest(post(), deps([live(sheet)], fake.gateway));
  assertEquals(sheet.reads[3], [CHUNK_ROWS + 2, 2 * CHUNK_ROWS + 1]);
  assertEquals(fake.of("runo").scan_row, 6 * CHUNK_ROWS + 2);
  assertEquals(fake.finished, []);
});

Deno.test("the full pass waits until the first load has reached the end", async () => {
  const sheet = fakeSheet(calls(3 * CHUNK_ROWS)); const fake = fakeGateway();
  await handleSyncRequest(post("s", '{"max_chunks": 2}'), deps([live(sheet)], fake.gateway));
  assertEquals(fake.stored.every((call) => !call.options.scan), true);
  assertEquals(fake.of("runo").next_row, 2 * CHUNK_ROWS + 2);
});

Deno.test("deleted sheet rows are noticed and the tail is read again from the top", async () => {
  const sheet = fakeSheet(calls(40)); const fake = fakeGateway({ runo: { next_row: 500 } });
  await handleSyncRequest(post(), deps([live(sheet)], fake.gateway));
  assertEquals([sheet.reads[1], sheet.reads[3]], [[200, 199 + CHUNK_ROWS], [2, CHUNK_ROWS + 1]]);
  assertEquals(fake.of("runo").next_row, 42);
});

Deno.test("a one-time sheet is read to the end once and then left alone", async () => {
  const sheet = fakeSheet(calls(3, "o"), "Unique id"); const fake = fakeGateway();
  const first = (await (await handleSyncRequest(post(), deps([old(sheet)], fake.gateway))).json()).sources[0];
  assertEquals([first.rows_read, first.applied, first.reached_end], [3, 3, true]);
  assertEquals(fake.stored[0].options.completed, true);
  assertEquals(fake.finished, []);
  const reads = sheet.reads.length;
  const second = (await (await handleSyncRequest(post(), deps([old(sheet)], fake.gateway))).json()).sources[0];
  assertEquals(second.skipped, "already_imported");
  assertEquals(sheet.reads.length, reads);
});

Deno.test("sheets are handled one after another and one failure does not stop the next", async () => {
  const broken: SheetReader = { rows: () => Promise.reject(new Error("sheet_not_shared")) };
  const sheet = fakeSheet(calls(2, "o"), "Unique id"); const fake = fakeGateway();
  const response = await handleSyncRequest(post(), deps([live(broken), old(sheet)], fake.gateway));
  assertEquals(response.status, 502);
  const body = await response.json();
  assertEquals(body.sources.map((item: { source: string; error?: string; applied: number }) => [item.source, item.error ?? null, item.applied]),
    [["runo", "sheet_not_shared", 0], ["runo_old", null, 2]]);
  assertEquals(fake.errors, ["runo:sheet_not_shared"]);
});

Deno.test("a source without its secret is skipped; one source can be chosen", async () => {
  const sheet = fakeSheet(calls(1)); const oldSheet = fakeSheet(calls(1, "o"), "Unique id"); const fake = fakeGateway();
  const skipped = await (await handleSyncRequest(post(), deps([live(sheet), old(null)], fake.gateway))).json();
  assertEquals(skipped.sources.map((item: { source: string }) => item.source), ["runo"]);
  const chosen = await (await handleSyncRequest(post("s", '{"source": "runo_old"}'), deps([live(sheet), old(oldSheet)], fake.gateway))).json();
  assertEquals(chosen.sources.map((item: { source: string }) => item.source), ["runo_old"]);
  assertEquals((await handleSyncRequest(post("s", '{"source": "nope"}'), deps([live(sheet)], fake.gateway))).status, 400);
});

Deno.test("rows are applied in small batches so no database call runs long", async () => {
  const fake = fakeGateway();
  const response = await handleSyncRequest(post(), deps([old(fakeSheet(calls(450, "o"), "Unique id"))], fake.gateway));
  assertEquals((await response.json()).sources[0].applied, 450);
  assertEquals(fake.applyLimits, [100, 100, 100, 100, 100]);
});

Deno.test("restart re-reads the tail from the top; bad options are refused", async () => {
  const sheet = fakeSheet(calls(1)); const fake = fakeGateway({ runo: { next_row: 5000 } });
  await handleSyncRequest(post("s", '{"restart": true}'), deps([live(sheet)], fake.gateway));
  assertEquals(sheet.reads[1], [2, CHUNK_ROWS + 1]);
  assertEquals((await handleSyncRequest(post("s", '{"restart": "yes"}'), deps([live(sheet)], fake.gateway))).status, 400);
  assertEquals((await handleSyncRequest(post("s", '{"max_chunks": 99}'), deps([live(sheet)], fake.gateway))).status, 400);
});

Deno.test("a sheet without the key column is refused with a short code", async () => {
  const reader: SheetReader = { rows: () => Promise.resolve([["Name", "Status"]]) };
  const fake = fakeGateway();
  const body = await (await handleSyncRequest(post(), deps([live(reader)], fake.gateway))).json();
  assertEquals(body.sources[0].error, "key_column_missing");
});
