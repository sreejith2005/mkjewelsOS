import { assertEquals } from "@std/assert";
import { parseProbe, probeTab, shapeOf, type ProbeFile } from "./probe.ts";
import { handleSyncRequest, type SheetReader, type SyncDeps } from "./worker.ts";

function sheet(all: string[][]): SheetReader {
  // Like Google: empty rows at the end of the requested range are left out.
  return { rows(from, to) {
    const rows = all.slice(from - 1, to);
    while (rows.length && rows[rows.length - 1].every((cell) => !cell)) rows.pop();
    return Promise.resolve(rows);
  } };
}

const clock = () => { let t = 0; return () => (t += 10); };

Deno.test("shapeOf hides letters and digits and keeps the layout", () => {
  assertEquals(shapeOf("14/11/2026 10:05:00"), "99/99/9999 99:99:99");
  assertEquals(shapeOf("Asha Mehta"), "A A");
  assertEquals(shapeOf("+91 98200 00000"), "+99 99999 99999");
});

Deno.test("probeTab counts rows, distinct values and key uniqueness below a header that is not on row 1", async () => {
  const data: string[][] = [];
  for (let i = 0; i < 60; i++) data.push([`REF-${i % 50}`, `0${i % 9}/11/2026`, `98200000${String(i).padStart(2, "0")}`, `Person ${i}`, i % 2 ? "BUSY" : "NO", ""]);
  data.splice(10, 0, ["", "", "", "", "", ""]); // a blank row in the middle is not the end
  const result = await probeTab(sheet([["title"], ["REFERENCE NUMBER", "Timestamp", "PHONE", "NAME", "STATUS", "", "STATUS"], ...data]), {
    headerRow: 2, keyColumns: ["REFERENCE NUMBER", "Timestamp"], deadline: 1e9, now: clock(),
  });
  assertEquals(result.complete, true);
  assertEquals(result.rows_filled, 60);
  assertEquals(result.last_filled_row, 63);
  assertEquals(result.key, { columns: ["REFERENCE NUMBER", "Timestamp"], filled: 60, distinct: 60 });
  const byName = Object.fromEntries(result.columns.map((column) => [column.name, column]));
  assertEquals(Object.keys(byName), ["REFERENCE NUMBER", "Timestamp", "PHONE", "NAME", "STATUS", "STATUS (2)"]);
  assertEquals([byName["REFERENCE NUMBER"].filled, byName["REFERENCE NUMBER"].distinct], [60, 50]);
  assertEquals(byName["Timestamp"].shapes, [{ shape: "99/99/9999", count: 60 }]);
  // A dropdown column lists its values; names, phones and ids never do.
  assertEquals(byName["STATUS"].values, [{ value: "BUSY", count: 30 }, { value: "NO", count: 30 }]);
  assertEquals(byName["NAME"].values, undefined);
  assertEquals(byName["PHONE"].values, undefined);
  assertEquals(byName["REFERENCE NUMBER"].values, undefined);
  assertEquals(byName["STATUS (2)"].filled, 0);
});

Deno.test("a repeated phone number is never listed as a value", async () => {
  const data = Array.from({ length: 50 }, () => ["98200 00000"]);
  const result = await probeTab(sheet([["PHONE"], ...data]), { headerRow: 1, keyColumns: [], deadline: 1e9, now: clock() });
  assertEquals(result.columns[0].distinct, 1);
  assertEquals(result.columns[0].values, undefined);
});

Deno.test("probeTab stops early when time runs out and says so", async () => {
  const data = Array.from({ length: 2500 }, (_, i) => [`R${i}`]);
  let t = 0;
  const result = await probeTab(sheet([["REF"], ...data]), { headerRow: 1, keyColumns: [], deadline: 40_000, now: () => (t += 2_000) });
  assertEquals(result.complete, false);
  assertEquals(result.rows_filled, 1000);
});

Deno.test("parseProbe validates its fields", () => {
  assertEquals(parseProbe({ file: "fms" }), { file: "fms", tab: undefined, headerRow: 1, keyColumns: [] });
  assertEquals(parseProbe({ file: "fms", tab: "INSTAGRAM FMS", header_row: 3, key: ["REFERENCE NUMBER"] }),
    { file: "fms", tab: "INSTAGRAM FMS", headerRow: 3, keyColumns: ["REFERENCE NUMBER"] });
  assertEquals(parseProbe({}), "probe.file is required");
  assertEquals(parseProbe({ file: "fms", header_row: 0 }), "probe.header_row must be an integer from 1 to 100");
  assertEquals(parseProbe({ file: "fms", key: "REF" }), "probe.key must be a list of up to 4 column names");
});

function deps(file: ProbeFile | null | undefined, calls: string[]): SyncDeps {
  const fail = () => { calls.push("database"); return Promise.reject(new Error("must not be called")); };
  return {
    secret: "s",
    sources: [{ source: "runo", keyColumns: ["callId"], oneTime: false, reader: { rows: () => { calls.push("import read"); return Promise.resolve([]); } } }],
    gateway: { state: fail, store: fail, apply: fail, finishScan: fail, noteError: fail },
    probeFile: (name) => (name === "fms" ? file : undefined),
  };
}

const post = (body: unknown, secret = "s") => new Request("http://local/", { method: "POST", headers: { "x-cron-secret": secret, "content-type": "application/json" }, body: JSON.stringify(body) });

Deno.test("a probe request lists tabs or reads one tab, and never imports", async () => {
  const calls: string[] = [];
  const file: ProbeFile = {
    tabs: () => Promise.resolve([{ title: "INSTAGRAM FMS", rows: 5000, columns: 40 }]),
    reader: (tab) => { calls.push(`probe ${tab}`); return sheet([["REF", "STATUS"], ["R1", "NO"], ["R2", "NO"]]); },
  };
  const tabs = await handleSyncRequest(post({ probe: { file: "fms" } }), deps(file, calls));
  assertEquals([tabs.status, await tabs.json()], [200, { probe: "tabs", file: "fms", tabs: [{ title: "INSTAGRAM FMS", rows: 5000, columns: 40 }] }]);
  const tab = await handleSyncRequest(post({ probe: { file: "fms", tab: "INSTAGRAM FMS", key: ["REF"] } }), deps(file, calls));
  const body = await tab.json();
  assertEquals([tab.status, body.rows_filled, body.key.distinct, body.complete], [200, 2, 2, true]);
  assertEquals(calls, ["probe INSTAGRAM FMS"]);
});

Deno.test("a probe needs the scheduler secret, a known file and that file's secret", async () => {
  const calls: string[] = [];
  const file: ProbeFile = { tabs: () => Promise.reject(new Error("sheet_not_shared")), reader: () => sheet([[]]) };
  assertEquals((await handleSyncRequest(post({ probe: { file: "fms" } }, "wrong"), deps(file, calls))).status, 401);
  const unknown = await handleSyncRequest(post({ probe: { file: "other" } }), deps(file, calls));
  assertEquals([unknown.status, await unknown.json()], [400, { error: "Unknown file" }]);
  const unset = await handleSyncRequest(post({ probe: { file: "fms" } }), deps(null, calls));
  assertEquals([unset.status, await unset.json()], [400, { error: "The secret for this file is not set" }]);
  const failed = await handleSyncRequest(post({ probe: { file: "fms" } }), deps(file, calls));
  assertEquals([failed.status, await failed.json()], [502, { probe: "tabs", file: "fms", error: "sheet_not_shared" }]);
  const empty = await handleSyncRequest(post({ probe: { file: "fms", tab: "X" } }), deps(file, calls));
  assertEquals([empty.status, await empty.json()], [502, { probe: "tab", file: "fms", error: "header_row_empty" }]);
  assertEquals(calls, []);
});
