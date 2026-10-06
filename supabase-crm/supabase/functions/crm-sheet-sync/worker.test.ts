import { assert, assertEquals, assertFalse } from "@std/assert";

import { handleSheetSync, rpcPayload, suppliedKeyMatches, type SyncGateway } from "./worker.ts";
import { sheetDate, sheetRowToWalkinPayload } from "./sheet-walkin.ts";

const KEY = "synthetic-sheet-sync-key-0123456789";

function fake(options: { throws?: boolean; result?: unknown } = {}) {
  const calls: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const gateway: SyncGateway = {
    call: (action, payload) => {
      calls.push({ action, payload });
      if (options.throws) return Promise.reject(new Error("database said something with a phone 9187700100"));
      return Promise.resolve(options.result ?? { counts: { inserted: 1 } });
    },
  };
  return { gateway, calls };
}

function post(body: unknown, headers: Record<string, string> = { "x-mk-sheet-sync-key": KEY }): Request {
  return new Request("https://crm.example.invalid/functions/v1/crm-sheet-sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("only POST is accepted", async () => {
  const { gateway } = fake();
  const res = await handleSheetSync(new Request("https://x.invalid", { method: "GET" }), { apiKey: KEY, gateway });
  assertEquals(res.status, 405);
});

Deno.test("an unconfigured function refuses with 503", async () => {
  const res = await handleSheetSync(post({ action: "pull" }), { apiKey: undefined, gateway: null });
  assertEquals(res.status, 503);
});

Deno.test("a missing or wrong key is refused before anything else", async () => {
  const { gateway, calls } = fake();
  assertEquals((await handleSheetSync(post({ action: "pull" }, {}), { apiKey: KEY, gateway })).status, 401);
  assertEquals((await handleSheetSync(post({ action: "pull" }, { "x-mk-sheet-sync-key": KEY + "x" }), { apiKey: KEY, gateway })).status, 401);
  assertEquals(calls.length, 0);
  assert(suppliedKeyMatches(KEY, KEY));
  assertFalse(suppliedKeyMatches(null, KEY));
});

Deno.test("invalid JSON and invalid requests are refused without echoing values", async () => {
  const { gateway, calls } = fake();
  assertEquals((await handleSheetSync(post("{not json"), { apiKey: KEY, gateway })).status, 400);
  const res = await handleSheetSync(post({ action: "push", tab: "SOMETHING ELSE", rows: [] }), { apiKey: KEY, gateway });
  assertEquals(res.status, 400);
  const tooMany = Array.from({ length: 201 }, (_, i) => ({ key: `MKC-${i}`, hash: "h", values: {} }));
  assertEquals((await handleSheetSync(post({ action: "push", tab: "FAMILY DATA", rows: tooMany }), { apiKey: KEY, gateway })).status, 400);
  const secret = await handleSheetSync(post({ action: "push", tab: "FAMILY DATA", rows: [{ key: "MKC-1", hash: "h", values: { NUMBER: 9187700100 } }] }), { apiKey: KEY, gateway });
  assertEquals(secret.status, 400);
  assertFalse((await secret.text()).includes("9187700100"));
  assertEquals(calls.length, 0);
});

Deno.test("push forwards rows with upper-case keys; walk-in rows get their walk-in payload", async () => {
  const { gateway, calls } = fake();
  const res = await handleSheetSync(post({
    action: "push", run_id: "5e1a0000-0000-4000-8000-000000000001", tab: "WALKIN DATASET",
    rows: [{ key: "mk-wk-abc-ban-ta-1", hash: "h1", values: { "CLIENT NAME": "SYNTHETIC", "CLIENT PHONE": "9187700100", BRANCH: "BANDRA", "FINAL STATUS": "ORDER PLACED" } }],
  }), { apiKey: KEY, gateway });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).counts, { inserted: 1 });
  assertEquals(calls[0]!.action, "push");
  const row = (calls[0]!.payload.rows as Array<Record<string, unknown>>)[0]!;
  assertEquals(row.key, "MK-WK-ABC-BAN-TA-1");
  const payload = row.payload as Record<string, unknown>;
  assertEquals(payload.primary_name, "SYNTHETIC");
  assertEquals((payload.additional_fields as Record<string, unknown>).visit_status, "ORDER_PLACED");
  assertEquals((payload.additional_fields as Record<string, unknown>).legacy_reference_number, "MK-WK-ABC-BAN-TA-1");
  assertFalse("branch_id" in payload);
});

Deno.test("other tabs carry no walk-in payload", () => {
  const payload = rpcPayload({ action: "push", tab: "FAMILY DATA", dry_run: true, rows: [{ key: "mkc-1", hash: "h", values: {} }] });
  assertEquals(payload, { run_id: null, tab: "FAMILY DATA", dry_run: true, rows: [{ key: "MKC-1", hash: "h", values: {} }] });
});

Deno.test("pull, ack and runs pass straight through", async () => {
  const { gateway, calls } = fake({ result: { changes: [] } });
  assertEquals((await handleSheetSync(post({ action: "pull", limit: 50 }), { apiKey: KEY, gateway })).status, 200);
  assertEquals(calls[0], { action: "pull", payload: { limit: 50 } });
  assertEquals((await handleSheetSync(post({ action: "ack", results: [{ id: 3, outcome: "sheet_won", applied_columns: ["CITY"] }] }), { apiKey: KEY, gateway })).status, 200);
  assertEquals(calls[1]!.payload, { results: [{ id: 3, outcome: "sheet_won", applied_columns: ["CITY"] }] });
  assertEquals((await handleSheetSync(post({ action: "run_start", mode: "dry_run" }), { apiKey: KEY, gateway })).status, 200);
  assertEquals((await handleSheetSync(post({ action: "ack", results: [{ id: 3, outcome: "applied", reason: "Bad Reason!" }] }), { apiKey: KEY, gateway })).status, 400);
});

Deno.test("a database failure answers a generic 500 without details", async () => {
  const { gateway } = fake({ throws: true });
  const res = await handleSheetSync(post({ action: "pull" }), { apiKey: KEY, gateway });
  assertEquals(res.status, 500);
  const text = await res.text();
  assertEquals(JSON.parse(text), { ok: false, code: "SYNC_FAILED" });
  assertFalse(text.includes("9187700100"));
});

Deno.test("a WALKIN DATASET row maps like the walk-in feed", () => {
  const payload = sheetRowToWalkinPayload({
    "CLIENT NAME": "SYNTHETIC CLIENT", "CLIENT PHONE": "", "BILLING PHONE": "9187700101", "CLIENT VISIT DATE": "15/12/2025 12:34",
    "COMMUNITY": "OTHER", "COMMUNITY (OTHER)": "SYNTHETIC", "SEEN CATEGORIES": "RINGS, CHAINS", "SEEN TAGS (COMBINED)": "R1, R2",
    "COMPANION 1 NAME": "SYNTHETIC SISTER", "COMPANION 1 MOBILE": "9187700102", "COMPANION 1 RELATION": "SISTER",
    "GIFT GIVEN": "COIN", "INSTAGRAM FOLLOW - PROOF URL": "https://example.invalid/p", "INSTAGRAM FOLLOW ASKED": "YES",
    "CLIENT BOUGHT ANY PRODUCT?": "YES AND ORDER_PLACED",
  }, "MK-1");
  assertEquals(payload.primary_phone, "9187700101");
  assertEquals(payload.event_date, "2025-12-15T00:00:00.000Z");
  assertEquals(payload.community, "OTHER");
  assertEquals(payload.community_other, "SYNTHETIC");
  assertEquals(payload.seen_categories, ["RINGS", "CHAINS"]);
  assertEquals((payload.category_details as Record<string, unknown>).seen_tags, ["R1", "R2"]);
  assertEquals(payload.companions, [{ name: "SYNTHETIC SISTER", phone: "9187700102", relation: "SISTER" }]);
  assertEquals(payload.did_buy, true);
  assertEquals((payload.additional_fields as Record<string, unknown>).gift_given, "COIN");
  assertEquals(payload.proof_urls, { instagram: "https://example.invalid/p" });
  assertEquals(((payload.engagement as Record<string, Record<string, unknown>>).instagram)!.asked, true);
});

Deno.test("dates are read as the walk-in feed reads them", () => {
  assertEquals(sheetDate("2025-12-15 12:34"), "2025-12-15");
  assertEquals(sheetDate("5/1/2026"), "2026-01-05");
  assertEquals(sheetDate("not a date"), "");
});
