// Tests for crm-sheet-sync.gs: its pure helpers, and applying a pulled change to a fake sheet.
// Run: deno test --allow-read supabase-crm/apps-script/crm-sheet-sync.test.ts
// The expected keys are what the CRM project's SQL computes (crm_private.sheet_referral_key and
// sheet_hashed_key, migration 20261006000300), so both sides address a row the same way.
import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import { createHash } from "node:crypto";

type Fn = (...args: any[]) => any;

function signedBytes(text: string): number[] {
  return Array.from(createHash("sha256").update(text, "utf8").digest()).map((b) => (b > 127 ? b - 256 : b));
}

function pad(n: number) { return String(n).padStart(2, "0"); }

const Utilities = {
  DigestAlgorithm: { SHA_256: "SHA_256" },
  Charset: { UTF_8: "UTF_8" },
  computeDigest: (_algorithm: string, text: string) => signedBytes(text),
  formatDate: (d: Date, _tz: string, pattern: string) =>
    pattern
      .replace("yyyy", String(d.getUTCFullYear())).replace("MM", pad(d.getUTCMonth() + 1)).replace("dd", pad(d.getUTCDate()))
      .replace("HH", pad(d.getUTCHours())).replace("mm", pad(d.getUTCMinutes())).replace("ss", pad(d.getUTCSeconds())),
};

const updates: Array<Record<string, string>> = [];
const source = await Deno.readTextFile(new URL("./crm-sheet-sync.gs", import.meta.url));
const names = ["crmssCell_", "crmssRowValues_", "crmssHashInput_", "crmssReferralKey_", "crmssSame_", "crmssWalkinKeys_",
  "crmssCellsToWrite_", "crmssAppendRow_", "crmssHashedKey_", "crmssFingerprint_", "crmssApplyChange_", "crmssFormatDate_", "CRMSS"];
const gs = new Function("Utilities", "updateClientProfile", `${source}\nreturn { ${names.join(", ")} };`)(
  Utilities,
  (payload: Record<string, string>) => { updates.push(payload); return { ok: true }; },
) as Record<string, Fn> & { CRMSS: Record<string, unknown> };

/** A small in-memory sheet with the Range methods the script uses. */
function fakeSheet(rows: unknown[][], formulas: string[][] = []) {
  const data = rows.map((r) => [...r]);
  const f = formulas.map((r) => [...r]);
  const width = Math.max(...data.map((r) => r.length));
  const cellAt = (r: number, c: number) => data[r - 1]?.[c - 1] ?? "";
  return {
    data,
    formulasR1C1: f,
    getLastRow: () => data.length,
    getRange(row: number, col: number, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cellAt(row + i, col + j))),
        getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => f[row + i - 1]?.[col + j - 1] ?? "")),
        getFormulasR1C1: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => f[row + i - 1]?.[col + j - 1] ?? "")),
        setValues: (values: unknown[][]) => values.forEach((v, i) => {
          data[row + i - 1] = data[row + i - 1] ?? Array(width).fill("");
          v.forEach((x, j) => { data[row + i - 1]![col + j - 1] = x; });
        }),
        setValue: (value: unknown) => { data[row - 1]![col - 1] = value; },
        setFormulaR1C1: (formula: string) => { (f[row - 1] = f[row - 1] ?? [])[col - 1] = formula; data[row - 1]![col - 1] = `=${formula}`; },
      };
    },
  };
}

function table(tab: string, sheet: ReturnType<typeof fakeSheet>) {
  const headers = (sheet.data[0] as string[]).map((h) => String(h).toUpperCase());
  const t = { tab, sheet, headers, lastCol: headers.length, rows: [] as any[], byKey: {} as Record<string, any>, byRow: {} as Record<number, any> };
  sheet.data.slice(1).forEach((raw, i) => {
    const values = gs.crmssRowValues_(headers, raw, gs.crmssFormatDate_);
    const row = { rowNumber: i + 2, values, key: String(values["CLIENT ID"] ?? values["KEY"] ?? "").toUpperCase(), hash: "" };
    t.rows.push(row); t.byKey[row.key] = row; t.byRow[row.rowNumber] = row;
  });
  return t;
}

Deno.test("the referral key is the Sheet's referralKey_ and the CRM's sheet_referral_key", () => {
  assertEquals(gs.crmssReferralKey_("Synthetic  friend", "+91 91000 09904", "Synthetic Giver"), "9100009904|SYNTHETICFRIEND|SYNTHETICGIVER");
  assertEquals(gs.crmssReferralKey_("", "", "A very long given by name here"), "REF||AVERYLONGGIVENBYNAME");
});

Deno.test("hashed keys equal the CRM's sheet_hashed_key", () => {
  assertEquals(gs.crmssHashedKey_("RK", "x"), "RK-2D711642B726B04401627CA9");
});

Deno.test("cells are compared the CRM's way", () => {
  assertEquals(gs.crmssCell_(new Date(Date.UTC(2026, 9, 6)), gs.crmssFormatDate_), "2026-10-06");
  assertEquals(gs.crmssCell_(new Date(Date.UTC(2026, 9, 6, 10, 5, 9)), gs.crmssFormatDate_), "2026-10-06 10:05:09");
  assertEquals(gs.crmssCell_(919100009905, gs.crmssFormatDate_), "919100009905");
  assertEquals(gs.crmssCell_("  MUMBAI ", gs.crmssFormatDate_), "MUMBAI");
  assertEquals(gs.crmssCell_(null, gs.crmssFormatDate_), "");
  assertEquals(gs.crmssSame_("Hot  Lead", "HOT LEAD"), true);
  assertFalse(gs.crmssSame_("THANE", "PUNE"));
});

Deno.test("a repeated header keeps its first non-empty value; blank headers are ignored", () => {
  const values = gs.crmssRowValues_(["COMMUNITY", "", "COMMUNITY", "CITY"], ["", "x", "MUSLIM", "MUMBAI"], gs.crmssFormatDate_);
  assertEquals(values, { COMMUNITY: "MUSLIM", CITY: "MUMBAI" });
  assertEquals(gs.crmssHashInput_(["COMMUNITY", "", "COMMUNITY", "CITY"], values), '[["COMMUNITY","MUSLIM"],["CITY","MUMBAI"]]');
});

Deno.test("a repeated reference keeps the first row; later rows get -R<row>", () => {
  assertEquals(gs.crmssWalkinKeys_(["mk-1", "MK-1", "", "MK-2"], [2, 9, 10, 11]), ["MK-1", "MK-1-R9", "", "MK-2"]);
});

Deno.test("only cells still holding their base value are written (Sheet wins)", () => {
  const plan = gs.crmssCellsToWrite_({ CITY: "THANE", PINCODE: "400703" },
    { values: { CITY: "VASHI", PINCODE: "400001" }, base: { CITY: "thane", PINCODE: "400050" } });
  assertEquals(plan, { write: ["CITY"], skipped: ["PINCODE"] });
});

Deno.test("an appended row copies formulas down and leaves ARRAYFORMULA columns empty", () => {
  const built = gs.crmssAppendRow_(["A", "B", "C", "D"], { A: "1", B: "2", C: "3", D: "4" }, ["", "=R[-1]C[-1]", "", ""], { 3: true });
  assertEquals(built, { values: ["1", "", "3", ""], formulas: { 1: "=R[-1]C[-1]" } });
});

Deno.test("a pulled update writes the allowed cells and reports sheet_won for the rest", () => {
  const sheet = fakeSheet([["KEY", "FOLLOW UP STATUS", "LAST FOLLOW UP REMARK", "NOTE"], ["RK-1", "PENDING", "CHANGED IN SHEET", "=x"]]);
  const t = table("REFERRALS CALLING MASTER", sheet);
  const state: Record<string, string> = {};
  const result = gs.crmssApplyChange_({ id: 7, tab: "REFERRALS CALLING MASTER", key: "RK-1", op: "update",
    values: { "FOLLOW UP STATUS": "VISIT PLANNED", "LAST FOLLOW UP REMARK": "FROM CRM" },
    base: { "FOLLOW UP STATUS": "PENDING", "LAST FOLLOW UP REMARK": "OLD" } }, { "REFERRALS CALLING MASTER": t }, state);
  assertEquals(result, { id: 7, outcome: "sheet_won", applied_columns: ["FOLLOW UP STATUS"] });
  assertEquals(sheet.data[1], ["RK-1", "VISIT PLANNED", "CHANGED IN SHEET", "=x"]);
  assertEquals(Object.keys(state), ["REFERRALS CALLING MASTER\u0001RK-1"]);
});

Deno.test("a pulled profile edit goes through the Sheet's own updateClientProfile", () => {
  updates.length = 0;
  const sheet = fakeSheet([["CLIENT ID", "CITY"], ["MKC-1", "THANE"]]);
  const t = table("CLIENT DATABASE MASTER", sheet);
  const result = gs.crmssApplyChange_({ id: 8, tab: "CLIENT DATABASE MASTER", key: "MKC-1", op: "update", values: { CITY: "VASHI" }, base: { CITY: "THANE" } },
    { "CLIENT DATABASE MASTER": t }, {});
  assertEquals(result, { id: 8, outcome: "applied" });
  assertEquals(updates, [{ clientId: "MKC-1", editedBy: "CRM WEB APP", CITY: "VASHI" }]);
});

Deno.test("an append adds a new row by header; a key the Sheet already has is left alone", () => {
  const sheet = fakeSheet([["CLIENT ID", "FAMILY ID", "WEEK"], ["MKC-1", "MKF-1", "Week-1"]], [[], ["", "", "=WEEKNUM(R[0]C[-2])"]]);
  const t = table("FAMILY DATA", sheet);
  const tables = { "FAMILY DATA": t };
  assertEquals(gs.crmssApplyChange_({ id: 9, tab: "FAMILY DATA", key: "MKC-2", op: "append", values: { "CLIENT ID": "MKC-2", "FAMILY ID": "MKF-1", WEEK: "Week-9" } }, tables, {}),
    { id: 9, outcome: "applied" });
  assertEquals(sheet.data[2]!.slice(0, 2), ["MKC-2", "MKF-1"]);
  assertEquals(sheet.formulasR1C1[2]![2], "=WEEKNUM(R[0]C[-2])");
  assertEquals(gs.crmssApplyChange_({ id: 10, tab: "FAMILY DATA", key: "MKC-1", op: "append", values: { "CLIENT ID": "MKC-1" } }, tables, {}),
    { id: 10, outcome: "sheet_won", applied_columns: [] });
});
