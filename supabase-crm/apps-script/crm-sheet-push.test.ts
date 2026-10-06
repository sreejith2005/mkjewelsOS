// Tests for crm-sheet-push.gs (the read-only one-way script).
// Run: deno test --allow-read supabase-crm/apps-script/crm-sheet-push.test.ts
// Expected keys equal the CRM's SQL (crm_private.sheet_referral_key / sheet_hashed_key) and the
// Sheet's own Code.gs rules (getReferenceNumberFromWalkinRow_, referralKey_).
import { assertEquals } from "jsr:@std/assert@1";
import { createHash } from "node:crypto";

type Fn = (...args: any[]) => any;
const pad = (n: number) => String(n).padStart(2, "0");
const Utilities = {
  DigestAlgorithm: { SHA_256: "SHA_256" },
  Charset: { UTF_8: "UTF_8" },
  computeDigest: (_a: string, text: string) => Array.from(createHash("sha256").update(text, "utf8").digest()).map((b) => (b > 127 ? b - 256 : b)),
  formatDate: (d: Date, _tz: string, pattern: string) => pattern.replace("yyyy", String(d.getUTCFullYear())).replace("MM", pad(d.getUTCMonth() + 1))
    .replace("dd", pad(d.getUTCDate())).replace("HH", pad(d.getUTCHours())).replace("mm", pad(d.getUTCMinutes())).replace("ss", pad(d.getUTCSeconds())),
};
const source = await Deno.readTextFile(new URL("./crm-sheet-push.gs", import.meta.url));
const names = ["crmspCell_", "crmspCleanHeader_", "crmspRowValues_", "crmspHashInput_", "crmspReferralKey_", "crmspWalkinReference_",
  "crmspWalkinKeys_", "crmspSha_", "crmspFormatDate_"];
const gs = new Function("Utilities", `${source}\nreturn { ${names.join(", ")} };`)(Utilities) as Record<string, Fn>;
const fmt = gs.crmspFormatDate_;

function walkinRow(cells: Record<number, unknown>): unknown[] {
  const raw = Array(136).fill("");
  for (const [col, value] of Object.entries(cells)) raw[Number(col) - 1] = value;
  return raw;
}
const headers = Array(136).fill("").map((_, i) => (i === 1 ? "CRM CLIENT ID" : i === 129 ? "REFERENCE NUMBER" : `H${i + 1}`));

Deno.test("references follow the Sheet's own order", () => {
  assertEquals(gs.crmspWalkinReference_(walkinRow({ 129: " mk-wk-abc-ban-ta-1 ", 123: "MK-OLD-1" }), headers, 5, fmt), "MK-WK-ABC-BAN-TA-1");
  assertEquals(gs.crmspWalkinReference_(walkinRow({ 123: "MK-OLD-1" }), headers, 5, fmt), "MK-OLD-1");
  assertEquals(gs.crmspWalkinReference_(walkinRow({ 130: "REF-BY-HEADER" }), headers, 5, fmt), "REF-BY-HEADER");
  assertEquals(gs.crmspWalkinReference_(walkinRow({ 40: "note mk wk xyz-77 here" }), headers, 5, fmt), "MK-WK-XYZ-77");
  assertEquals(gs.crmspWalkinReference_(walkinRow({ 11: "SYNTHETIC NAME" }), headers, 5, fmt), "AUTO-WALKIN-ROW-5");
});

Deno.test("a repeated reference keeps the first row; later rows get -R<row>", () => {
  assertEquals(gs.crmspWalkinKeys_(["MK-1", "mk-1", "MK-2"], [2, 7, 8]), ["MK-1", "MK-1-R7", "MK-2"]);
});

Deno.test("referral keys and hashes equal the CRM's", () => {
  const raw = gs.crmspReferralKey_("Synthetic  friend", "+91 91000 09904", "Synthetic Giver");
  assertEquals(raw, "9100009904|SYNTHETICFRIEND|SYNTHETICGIVER");
  assertEquals("RK-" + gs.crmspSha_("x").slice(0, 24).toUpperCase(), "RK-2D711642B726B04401627CA9");
});

Deno.test("cells and headers are read the CRM's way", () => {
  assertEquals(gs.crmspCleanHeader_(" client\nname* "), "CLIENT NAME");
  assertEquals(gs.crmspCell_(new Date(Date.UTC(2026, 9, 6)), fmt), "2026-10-06");
  assertEquals(gs.crmspCell_(919100009905, fmt), "919100009905");
  const values = gs.crmspRowValues_(["COMMUNITY", "", "COMMUNITY"], ["", "x", "SYNTHETIC"], fmt);
  assertEquals(values, { COMMUNITY: "SYNTHETIC" });
  assertEquals(gs.crmspHashInput_(["COMMUNITY", "", "COMMUNITY"], values), '[["COMMUNITY","SYNTHETIC"]]');
});

Deno.test("the script never writes to a Sheet", () => {
  for (const write of ["setValue", "setValues", "appendRow", "insertSheet", "clearContent", "setFormula", "deleteRow", "hideSheet"]) {
    assertEquals(source.includes(`.${write}(`), false, write);
  }
});
