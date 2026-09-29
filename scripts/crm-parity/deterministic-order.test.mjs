// node --test scripts/crm-parity/deterministic-order.test.mjs
// D5: the port carries exactly the tie-breakers listed in deterministic-order.mjs, and the same
// list applies cleanly to the original (when the git-ignored original is present locally).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { applyEdits, MARK, SQL_EDITS, UI_EDITS, uiEditsByFile } from "./deterministic-order.mjs";
import { ORIGINAL_DIR, REPO_ROOT } from "./util.mjs";

const PORT_SRC = join(REPO_ROOT, "packages", "crm-ui", "src");
const count = (text, needle) => text.split(needle).length - 1;

test("every UI tie-breaker is in the port, marked, the listed number of times", () => {
  for (const [file, edits] of uiEditsByFile()) {
    const text = readFileSync(join(PORT_SRC, file), "utf8");
    for (const edit of edits) {
      assert.ok(edit.replace.includes(MARK), `${file}: replacement is marked`);
      assert.equal(count(text, edit.replace), edit.count, `${file}: ${edit.replace}`);
    }
  }
});

test("migration 0191 carries every SQL tie-breaker", () => {
  const sql = readFileSync(join(REPO_ROOT, "supabase", "migrations", "0191_crm_deterministic_order.sql"), "utf8");
  for (const edit of SQL_EDITS) assert.equal(count(sql, edit.replace), edit.count, `${edit.fn}: ${edit.replace}`);
});

test("applyEdits refuses a find that does not occur the listed number of times", () => {
  assert.equal(applyEdits("a.order(x)", [{ find: ".order(x)", replace: ".order(x).order(id)", count: 1 }], "t"), "a.order(x).order(id)");
  assert.throws(() => applyEdits("a", [{ find: ".order(x)", replace: "", count: 1 }], "t"), /expected 1/);
  assert.throws(() => applyEdits(".order(x).order(x)", [{ find: ".order(x)", replace: "", count: 1 }], "t"), /found 2/);
});

test("the same UI edits apply to the original, which stays unmarked", { skip: !existsSync(ORIGINAL_DIR) && "original not present" }, () => {
  for (const [file, edits] of uiEditsByFile()) {
    const original = readFileSync(join(ORIGINAL_DIR, file), "utf8");
    assert.ok(!original.includes(MARK), `${file}: the original is never edited`);
    assert.doesNotThrow(() => applyEdits(original, edits, file));
  }
  assert.ok(UI_EDITS.length > 0);
});
