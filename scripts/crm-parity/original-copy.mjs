// A temporary, patched copy of the ORIGINAL app for parity runs (D5, owner decision 2026-09-28).
//
// The port breaks ORDER BY ties with the primary key (deterministic-order.mjs). For a fair
// comparison the parity harnesses run the original with the SAME tie-breakers, applied at run
// time to a copy in the harness workdir; the original under sreejith-crm/ is never edited.
// Only the app sources are copied. node_modules is mirrored as real directories whose files are
// hard links to the original's (same volume: no extra disk space; Turbopack rejects a junction
// that points outside the project root); nothing writes into it. The original's secrets and data
// (.env*, *.xlsx, migration-backups, migration-reports, reports, android, build output) are never
// copied.
import { copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { applyEdits, applySqlEditsToOriginal, uiEditsByFile } from "./deterministic-order.mjs";
import { ORIGINAL_DIR } from "./util.mjs";

const SKIP_TOP = new Set([
  "node_modules", ".next", "android", "migration-backups", "migration-reports", "reports", "test-results",
  "e2e", "supabase", "scripts", "tsconfig.tsbuildinfo",
]);

function copied(source) {
  const rel = relative(ORIGINAL_DIR, source);
  if (!rel) return true;
  const top = rel.split(/[\\/]/)[0];
  if (SKIP_TOP.has(top)) return false;
  const name = basename(source);
  if (name.startsWith(".env") || /\.xlsx$/i.test(name)) return false;
  return true;
}

/** Mirrors `source` at `target`: directories are created, files hard-linked (copied across volumes). */
function linkTree(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isSymbolicLink()) {
      const stat = lstatSync(from);
      symlinkSync(readlinkSync(from), to, stat.isDirectory() ? "junction" : "file");
    } else if (entry.isDirectory()) {
      linkTree(from, to);
    } else {
      try { linkSync(from, to); } catch (error) {
        if (error?.code !== "EXDEV") throw error;
        copyFileSync(from, to);
      }
    }
  }
}

/** Creates (or refreshes) `<workdir>/original-app` and returns its path. */
export function preparePatchedOriginal(workdir) {
  const target = join(workdir, "original-app");
  // Sources are refreshed on every run; the linked node_modules and Next's cache are kept.
  if (existsSync(target)) {
    for (const entry of ["app", "components", "lib", "public", "tests", "mk-jewels-logos"]) rmSync(join(target, entry), { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });
  cpSync(ORIGINAL_DIR, target, { recursive: true, filter: copied, force: true });
  const modules = join(target, "node_modules");
  const marker = join(target, ".node_modules-linked");
  if (!existsSync(marker)) {
    rmSync(modules, { recursive: true, force: true });
    linkTree(join(ORIGINAL_DIR, "node_modules"), modules);
    writeFileSync(marker, "node_modules mirrored with hard links");
  }
  for (const [file, edits] of uiEditsByFile()) {
    const path = join(target, file);
    writeFileSync(path, applyEdits(readFileSync(path, "utf8"), edits, `original ${file}`));
  }
  return target;
}

/** Applies the same SQL tie-breakers to the original's functions in its throwaway/restored local database. */
export async function patchOriginalDatabase(connectionString = "postgresql://postgres:postgres@127.0.0.1:56322/postgres") {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await applySqlEditsToOriginal((sql, params) => client.query(sql, params), "public");
  } finally {
    await client.end();
  }
}
