// An optional throwaway local Supabase stack that runs the JewelOS migrations (`--isolated-jewelos`),
// so a parity run never touches the shared local JewelOS stack (project "jewelos") that another
// session may be resetting or testing. Own project id and ports (5732x); local only.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { psql, REPO_ROOT, run } from "./util.mjs";

export const PORT_PROJECT_ID = "jewelos-crm-parity-port";
export const PORT_DB_CONTAINER = `supabase_db_${PORT_PROJECT_ID}`;
export const isolatedJewelos = () => process.argv.includes("--isolated-jewelos");

const PORTS = `
[db]
port = 57322
shadow_port = 57320
major_version = 17

[db.pooler]
enabled = false
port = 57329

[db.seed]
enabled = false

[realtime]
enabled = false

[studio]
enabled = false
port = 57323

[local_smtp]
enabled = false
port = 57324

[analytics]
enabled = false
port = 57327

[edge_runtime]
enabled = true
inspector_port = 57383
`;

/** Writes the repository's supabase config (project id and ports replaced) and copies the tracked migrations, functions and tests. */
export function prepareJewelosStack(workdir) {
  const supabaseDir = join(workdir, "supabase");
  rmSync(supabaseDir, { recursive: true, force: true });
  mkdirSync(supabaseDir, { recursive: true });
  const repoConfig = readFileSync(join(REPO_ROOT, "supabase", "config.toml"), "utf8")
    .replace(/^project_id = ".*"$/m, `project_id = "${PORT_PROJECT_ID}"`);
  // The repository config keeps every other setting at its default, so its [api] block is the
  // only one; the port is added to it and the remaining sections are appended.
  const config = repoConfig.replace(/^\[api\]$/m, "[api]\nport = 57321");
  writeFileSync(join(supabaseDir, "config.toml"), `${config}\n${PORTS}`);
  // Only files Git tracks: a run reflects committed work, never another session's unfinished files.
  // packages/core/src is copied because several functions import it relatively (../../../packages/core).
  const tracked = run("git", ["ls-files", "-z", "--", "supabase/migrations", "supabase/functions", "supabase/tests", "packages/core/src"]).stdout.split("\0").filter(Boolean);
  for (const file of tracked) {
    const target = join(workdir, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(REPO_ROOT, file), target);
  }
}

export async function startJewelosStack(workdir) {
  run("supabase.cmd", ["start", "--workdir", workdir], { timeoutMs: 900_000 });
  const reset = run("supabase.cmd", ["db", "reset", "--workdir", workdir], { timeoutMs: 900_000, allowFailure: true });
  const applied = Number(psql(PORT_DB_CONTAINER, "select count(*) from supabase_migrations.schema_migrations;"));
  const expected = Number(run("node", ["-e", `console.log(require("fs").readdirSync(${JSON.stringify(join(workdir, "supabase", "migrations"))}).filter((f) => f.endsWith(".sql")).length)`]).stdout.trim());
  if (applied !== expected) {
    throw new Error(`JewelOS port stack reset applied ${applied}/${expected} migrations\n${`${reset.stdout}\n${reset.stderr}`.split("\n").slice(-20).join("\n")}`);
  }
  // The reset recreates auth/storage; the gateway can keep their old addresses (or be down),
  // so restart it and wait until auth answers through it.
  const kong = `supabase_kong_${PORT_PROJECT_ID}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (attempt % 12 === 0) run("docker", ["restart", kong], { timeoutMs: 120_000, allowFailure: true });
    try {
      const auth = await fetch("http://127.0.0.1:57321/auth/v1/health");
      if (auth.status < 500) return;
    } catch { /* restarting */ }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("JewelOS port stack auth API did not come up after the reset");
}

export function stopJewelosStack(workdir) {
  run("supabase.cmd", ["stop", "--workdir", workdir, "--no-backup"], { timeoutMs: 300_000, allowFailure: true });
}
