import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

type TimelineWithVisitForm = { id: string; visitForm: Record<string, unknown> | null };

const root = resolve(import.meta.dirname, "..");
const legacyRoot = resolve(root, "..", "sreejith-crm", "web-app");
const appData = process.env.APPDATA;
if (!appData) throw new Error("APPDATA is required to locate the installed Supabase CLI on Windows.");
const supabaseCli = resolve(appData, "npm", "node_modules", "supabase", "dist", "supabase.js");
const apply = process.argv.includes("--apply");
const batchSize = 40;

function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveResult(stdout) : reject(new Error(`${stderr}\n${stdout}`.trim() || `${command} exited ${code}`)));
  });
}

async function readRows(afterId: string | null): Promise<TimelineWithVisitForm[]> {
  const query = `
    const { PrismaClient } = require('@prisma/client');
    process.env.DATABASE_URL = process.env.DIRECT_URL;
    const p = new PrismaClient();
    p.clientTimeline.findMany({ take: ${batchSize}, orderBy: { id: 'asc' }, ${afterId ? `cursor: { id: '${afterId}' }, skip: 1,` : ""} select: { id: true, visitForm: true } })
      .then((rows) => console.log(JSON.stringify(rows))).finally(() => p[String.fromCharCode(36) + 'disconnect']());
  `;
  return JSON.parse(await run("node", ["--env-file=.env", "-e", query], legacyRoot)) as TimelineWithVisitForm[];
}

function sqlLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

async function importBatch(rows: TimelineWithVisitForm[]): Promise<void> {
  const calls = rows.map((row) => {
    const payload = JSON.stringify({ legacy_visit_form: row.visitForm });
    const checksum = createHash("sha256").update(payload).digest("hex");
    return `public.preserve_legacy_crm_timeline_visit_form('legacy_sreejith_crm', ${sqlLiteral(row.id)}, ${sqlLiteral(payload)}::jsonb, '${checksum}')`;
  });
  const maximumQueryLength = 24_000;
  let queryCalls: string[] = []; let queryLength = "select ;".length;
  for (const call of calls) {
    if (queryCalls.length > 0 && queryLength + call.length + 2 > maximumQueryLength) {
      await run("node", [supabaseCli, "db", "query", "--linked", `select ${queryCalls.join(", ")};`], root);
      queryCalls = []; queryLength = "select ;".length;
    }
    queryCalls.push(call); queryLength += call.length + 2;
  }
  if (queryCalls.length > 0) await run("node", [supabaseCli, "db", "query", "--linked", `select ${queryCalls.join(", ")};`], root);
}

async function main(): Promise<void> {
  let afterId: string | null = null; let scanned = 0;
  for (;;) {
    const rows = await readRows(afterId);
    if (rows.length === 0) break;
    scanned += rows.length; afterId = rows.at(-1)?.id ?? null;
    if (apply) await importBatch(rows);
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", scanned }));
  }
}

void main();
