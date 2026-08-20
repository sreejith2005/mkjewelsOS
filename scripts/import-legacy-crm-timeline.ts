import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { prepareLegacyTimelineImport } from "../packages/core/src/crm/legacyImport";

type LegacyTimeline = Record<string, unknown> & { id: string; clientId: string; branchId: string; eventType: string; eventDate: string };

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
    child.once("close", (code) => code === 0 ? resolveResult(stdout) : reject(new Error(stderr || `${command} exited ${code}`)));
  });
}

async function readLegacyTimeline(afterId: string | null): Promise<LegacyTimeline[]> {
  const query = `
    const { PrismaClient } = require('@prisma/client');
    process.env.DATABASE_URL = process.env.DIRECT_URL;
    const p = new PrismaClient();
    p.clientTimeline.findMany({ take: ${batchSize}, orderBy: { id: 'asc' }, ${afterId ? `cursor: { id: '${afterId}' }, skip: 1,` : ""}
      select: { id: true, clientId: true, branchId: true, eventType: true, buyStatus: true, eventDate: true, crmName: true, salespersonId: true, seenCategories: true, boughtCategories: true, orderCategories: true, productRequirement: true, remark: true, referenceNumber: true, createdAt: true }
    }).then((rows) => console.log(JSON.stringify(rows))).finally(() => p[String.fromCharCode(36) + 'disconnect']());
  `;
  return JSON.parse(await run("node", ["--env-file=.env", "-e", query], legacyRoot)) as LegacyTimeline[];
}

function sqlLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

function sourcePayload(timeline: LegacyTimeline): Record<string, unknown> {
  const prepared = prepareLegacyTimelineImport({ externalId: timeline.id, clientExternalId: timeline.clientId, branchExternalId: timeline.branchId, eventType: timeline.eventType, occurredAt: timeline.eventDate });
  return {
    occurred_at: timeline.eventDate,
    subject: prepared.subject,
    legacy_branch_id: prepared.branchExternalId,
    legacy_event_type: timeline.eventType,
    legacy_buy_status: timeline.buyStatus ?? null,
    crm_name: timeline.crmName ?? null,
    legacy_salesperson_id: timeline.salespersonId ?? null,
    seen_categories: timeline.seenCategories ?? [],
    bought_categories: timeline.boughtCategories ?? [],
    order_categories: timeline.orderCategories ?? [],
    product_requirement: timeline.productRequirement ?? null,
    remark: timeline.remark ?? null,
    reference_number: timeline.referenceNumber ?? null,
    legacy_created_at: timeline.createdAt ?? null,
  };
}

async function importBatch(rows: LegacyTimeline[]): Promise<void> {
  const calls = rows.map((timeline) => {
    const payload = JSON.stringify(sourcePayload(timeline));
    const checksum = createHash("sha256").update(payload).digest("hex");
    return `public.import_legacy_crm_timeline('legacy_sreejith_crm', ${sqlLiteral(timeline.id)}, ${sqlLiteral(timeline.clientId)}, ${sqlLiteral(payload)}::jsonb, '${checksum}', null)`;
  });
  // Windows limits command lines to roughly 32 KiB. Legacy visit forms can be
  // large, so split by rendered SQL length rather than a record-count guess.
  const maximumQueryLength = 12_000;
  let queryCalls: string[] = [];
  let queryLength = "select ;".length;
  for (const call of calls) {
    if (queryCalls.length > 0 && queryLength + call.length + 2 > maximumQueryLength) {
      await run("node", [supabaseCli, "db", "query", "--linked", `select ${queryCalls.join(", ")};`], root);
      queryCalls = [];
      queryLength = "select ;".length;
    }
    queryCalls.push(call);
    queryLength += call.length + 2;
  }
  if (queryCalls.length > 0) await run("node", [supabaseCli, "db", "query", "--linked", `select ${queryCalls.join(", ")};`], root);
}

async function main(): Promise<void> {
  let afterId: string | null = null; let scanned = 0;
  for (;;) {
    const rows = await readLegacyTimeline(afterId);
    if (rows.length === 0) break;
    scanned += rows.length;
    afterId = rows.at(-1)?.id ?? null;
    if (apply) await importBatch(rows);
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", scanned }));
  }
}

void main();
