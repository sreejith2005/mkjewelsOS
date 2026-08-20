import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

type LegacyClient = Record<string, unknown> & { clientId: string; primaryName: string; primaryPhone: string; lastBranchId: string | null };

const root = resolve(import.meta.dirname, "..");
const legacyRoot = resolve(root, "..", "sreejith-crm", "web-app");
// Invoke the Supabase CLI entry point with Node rather than its Windows .cmd
// shim. child_process.spawn cannot safely launch a .cmd with shell disabled.
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

async function readLegacyClients(afterId: string | null): Promise<LegacyClient[]> {
  const query = `
    const { PrismaClient } = require('@prisma/client');
    process.env.DATABASE_URL = process.env.DIRECT_URL;
    const p = new PrismaClient();
    p.client.findMany({
      take: ${batchSize},
      orderBy: { clientId: 'asc' },
      ${afterId ? `cursor: { clientId: '${afterId}' }, skip: 1,` : ""}
      select: { clientId: true, primaryName: true, primaryPhone: true, billingPhone: true, otherNames: true, gender: true, state: true, city: true, cityOther: true, pincode: true, address: true, dob: true, anniversary: true, lastBranchId: true, clientPotentialCategory: true, lastSeenCategories: true }
    }).then((rows) => console.log(JSON.stringify(rows))).finally(() => p[String.fromCharCode(36) + 'disconnect']());
  `;
  const output = await run("node", ["--env-file=.env", "-e", query], legacyRoot);
  return JSON.parse(output) as LegacyClient[];
}

function sourcePayload(client: LegacyClient): Record<string, unknown> {
  return {
    primary_name: client.primaryName,
    primary_phone: client.primaryPhone,
    billing_phone: client.billingPhone ?? null,
    other_names: client.otherNames ?? [],
    gender: client.gender ?? null,
    state: client.state ?? null,
    city: client.city ?? null,
    city_other: client.cityOther ?? null,
    pincode: client.pincode ?? null,
    address: client.address ?? null,
    dob: client.dob instanceof Date ? client.dob.toISOString().slice(0, 10) : client.dob ?? null,
    anniversary: client.anniversary instanceof Date ? client.anniversary.toISOString().slice(0, 10) : client.anniversary ?? null,
    legacy_branch_id: client.lastBranchId,
    client_potential_category: client.clientPotentialCategory ?? null,
    last_seen_categories: client.lastSeenCategories ?? [],
  };
}

function sqlLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

async function importBatch(clients: LegacyClient[]): Promise<void> {
  const calls = clients.map((client) => {
    const payload = JSON.stringify(sourcePayload(client));
    const checksum = createHash("sha256").update(payload).digest("hex");
    return `public.import_legacy_crm_client('legacy_sreejith_crm', ${sqlLiteral(client.clientId)}, ${sqlLiteral(payload)}::jsonb, '${checksum}', null)`;
  });
  await run("node", [supabaseCli, "db", "query", "--linked", `select ${calls.join(", ")};`], root);
}

async function main(): Promise<void> {
  let afterId: string | null = null; let scanned = 0;
  for (;;) {
    const clients = await readLegacyClients(afterId);
    if (clients.length === 0) break;
    scanned += clients.length;
    afterId = clients.at(-1)?.clientId ?? null;
    if (apply) await importBatch(clients);
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", scanned }));
  }
}

void main();
