import { assertEquals } from "@std/assert";
import { CHUNK_ROWS, handleSyncRequest, headerNames, toIngestRows, type IngestGateway, type IngestRow, type SheetReader } from "./worker.ts";

function fakeSheet(dataRows: string[][]): SheetReader & { reads: Array<[number, number]> } {
  const all = [["callId", "Mobile Number", "Name", "Status", "Status"], ...dataRows];
  const reads: Array<[number, number]> = [];
  return { reads, rows(from, to) { reads.push([from, to]); return Promise.resolve(all.slice(from - 1, to)); } };
}

function fakeGateway(nextRow = 2) {
  const stored: IngestRow[] = []; const queue = { pending: 0 }; const errors: string[] = []; let cursor = nextRow;
  const gateway: IngestGateway = {
    state: () => Promise.resolve({ next_row: cursor, pending: queue.pending }),
    store(_source, rows, next) { stored.push(...rows); queue.pending += rows.length; cursor = next; return Promise.resolve({ new: rows.length, changed: 0 }); },
    apply(_source, limit) { const n = Math.min(limit, queue.pending); queue.pending -= n; return Promise.resolve({ applied: n, rejected: 0, pending: queue.pending }); },
    noteError(_source, message) { errors.push(message); return Promise.resolve(); },
  };
  return { gateway, stored, errors, cursor: () => cursor };
}

const post = (secret = "s", body = "{}") =>
  new Request("http://x", { method: "POST", headers: { "x-cron-secret": secret, "content-type": "application/json" }, body });

Deno.test("headers and rows become keyed payloads", () => {
  const names = headerNames(["callId", " Name ", "", "Status", "Status"]);
  assertEquals(names, ["callId", "Name", "", "Status", "Status (2)"]);
  const rows = toIngestRows(names, [["c1", " Meera ", "x", "Interested"], [], ["", "No Key"]], 2, "callId");
  assertEquals(rows, [
    { row_key: "c1", sheet_row: 2, payload: { callId: "c1", Name: "Meera", Status: "Interested" } },
    { row_key: "row:4", sheet_row: 4, payload: { Name: "No Key" } },
  ]);
});

Deno.test("authorization is checked before any read", async () => {
  const sheet = fakeSheet([]); const { gateway } = fakeGateway();
  assertEquals((await handleSyncRequest(post("wrong"), { secret: "s", reader: sheet, gateway })).status, 401);
  assertEquals((await handleSyncRequest(new Request("http://x"), { secret: "s", reader: sheet, gateway })).status, 405);
  assertEquals((await handleSyncRequest(post(), { secret: undefined, reader: sheet, gateway })).status, 500);
  assertEquals(sheet.reads.length, 0);
});

Deno.test("a run reads from the cursor, stores, applies and returns counts only", async () => {
  const sheet = fakeSheet([["c1", "9820000001", "A", "Interested"], ["c2", "9820000002", "B", "Not contacted"]]);
  const fake = fakeGateway();
  const response = await handleSyncRequest(post(), { secret: "s", reader: sheet, gateway: fake.gateway });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { source: "runo", rows_read: 2, new: 2, changed: 0, applied: 2, rejected: 0, pending: 0, reached_end: true });
  assertEquals(fake.stored.map((row) => row.row_key), ["c1", "c2"]);
  assertEquals(fake.cursor(), 4);
});

Deno.test("a later run re-reads a small overlap and continues", async () => {
  const data = Array.from({ length: CHUNK_ROWS + 5 }, (_, i) => [`c${i}`, "9820000001", "A", "Interested"]);
  const sheet = fakeSheet(data); const fake = fakeGateway(901);
  const response = await handleSyncRequest(post(), { secret: "s", reader: sheet, gateway: fake.gateway });
  const body = await response.json();
  assertEquals(sheet.reads[1], [601, 600 + CHUNK_ROWS]);
  assertEquals(body.reached_end, true);
  assertEquals(fake.cursor(), CHUNK_ROWS + 7);
});

Deno.test("restart re-reads from the top", async () => {
  const sheet = fakeSheet([["c1", "9820000001", "A", "Interested"]]); const fake = fakeGateway(5000);
  await handleSyncRequest(post("s", '{"restart": true}'), { secret: "s", reader: sheet, gateway: fake.gateway });
  assertEquals(sheet.reads[1], [2, CHUNK_ROWS + 1]);
  assertEquals((await handleSyncRequest(post("s", '{"restart": "yes"}'), { secret: "s", reader: sheet, gateway: fake.gateway })).status, 400);
});

Deno.test("a Google failure is reported as a short code, without content", async () => {
  const reader: SheetReader = { rows: () => Promise.reject(new Error("sheet_not_shared")) };
  const fake = fakeGateway();
  const response = await handleSyncRequest(post(), { secret: "s", reader, gateway: fake.gateway });
  assertEquals(response.status, 502);
  assertEquals(await response.json(), { error: "sheet_not_shared" });
  assertEquals(fake.errors, ["sheet_not_shared"]);
});

Deno.test("a sheet without the key column is refused", async () => {
  const reader: SheetReader = { rows: () => Promise.resolve([["Name", "Status"]]) };
  const fake = fakeGateway();
  const response = await handleSyncRequest(post(), { secret: "s", reader, gateway: fake.gateway });
  assertEquals(await response.json(), { error: "key_column_missing" });
});
