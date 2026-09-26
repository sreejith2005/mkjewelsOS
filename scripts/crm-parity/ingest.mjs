// Server-route parity (`--ingest`): the ORIGINAL POST /api/ingest/walkin and
// POST /api/leads/[leadId]/runo (next dev, original schema in the throwaway stack) versus the
// JewelOS Edge Functions crm-walkin-ingest and crm-runo-push (`supabase functions serve`,
// schema crm), on the same synthetic fixture.
//
// Each case is posted to both; the HTTP status and the response JSON (request ids and
// generated ids masked) are compared, then every table's rows in both databases. For Runo the
// outbound request each app sends to a local stub is compared as well. Local only: the
// original app runs with explicit local DATABASE_URL / DIRECT_URL and synthetic secrets that
// override its (git-ignored) .env; nothing reaches a hosted service.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { JEWELOS_DB_CONTAINER, PARITY_PASSWORD, PARITY_USERS } from "./load-jewelos.mjs";
import { ORIGINAL_DB_CONTAINER } from "./original-stack.mjs";
import { jewelosSession, originalSessionCookies } from "./sessions.mjs";
import { psql, REPO_ROOT, run, startServer, stopServer, waitForUrl } from "./util.mjs";
import { normalise } from "./workflow.mjs";

export const ORIGINAL_ORIGIN = "http://localhost:3300";
const STUB_PORT = 3390;
const BRANCH = "Andheri Parity";
const EXCLUDED_TABLES = new Set(["_prisma_migrations", "legacy_walkin_ingest_rate_limits"]);

// ---------------------------------------------------------------------------------------------
// Runo stub: records what each app sends and answers as scripted.
// ---------------------------------------------------------------------------------------------
export function startRunoStub() {
  const requests = [];
  let script = { status: 200, body: { id: "runo-customer-1" }, drop: false };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({ method: request.method, path: request.url, authKey: request.headers["auth-key"], contentType: request.headers["content-type"], body: Buffer.concat(chunks).toString("utf8") });
      if (script.drop) return request.socket.destroy();
      response.writeHead(script.status, { "content-type": "application/json" });
      response.end(JSON.stringify(script.body));
    });
  });
  return new Promise((resolve) => server.listen(STUB_PORT, "0.0.0.0", () => resolve({
    requests,
    respond: (next) => { script = { status: 200, body: {}, drop: false, ...next }; },
    close: () => server.close(),
  })));
}

// ---------------------------------------------------------------------------------------------
// Row snapshots of every table both schemas share (original columns only).
// ---------------------------------------------------------------------------------------------
function snapshotSql(schema, tables) {
  return `select jsonb_build_object(${tables.map(({ name, columns }) => `'${name}', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (select ${columns} from ${schema}."${name}") t)`).join(",\n")});`;
}

function tableColumns() {
  const rows = psql(ORIGINAL_DB_CONTAINER, "select table_name || '|' || string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') group by table_name order by table_name;");
  return rows.split("\n").filter(Boolean).map((row) => { const [name, columns] = row.split("|"); return { name, columns }; }).filter(({ name }) => !EXCLUDED_TABLES.has(name));
}

function snapshot(tables) {
  const dump = (container, schema) => JSON.parse(psql(container, snapshotSql(schema, tables)));
  const shape = (data) => Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.map((row) => normalise(JSON.stringify(row))).sort()]));
  return { original: shape(dump(ORIGINAL_DB_CONTAINER, "public")), port: shape(dump(JEWELOS_DB_CONTAINER, "crm")) };
}

/** Tables whose rows differ between the two databases (with the first differing row). */
function rowDifferences({ original, port }) {
  const differences = [];
  for (const table of Object.keys(original)) {
    if (JSON.stringify(original[table]) === JSON.stringify(port[table])) continue;
    const onlyOriginal = original[table].filter((row) => !port[table].includes(row));
    const onlyPort = port[table].filter((row) => !original[table].includes(row));
    differences.push({ table, original: onlyOriginal[0]?.slice(0, 500), port: onlyPort[0]?.slice(0, 500) });
  }
  return differences;
}

const maskResponse = (body) => (body && typeof body === "object" ? JSON.parse(normalise(JSON.stringify({ ...body, requestId: body.requestId ? "<requestId>" : undefined }))) : body);

// ---------------------------------------------------------------------------------------------
// Walk-in ingest cases
// ---------------------------------------------------------------------------------------------
const VISIT = {
  branch: BRANCH, client_name: "Ingest Parity One", client_phone: "+91 91000 90001", gender: "FEMALE", country: "India", state: "Maharashtra",
  city: "Pune", pincode: "411001", address: "1 Synthetic Road", visit_date: "2026-09-20", buy_status: "YES",
  seen_categories: ["Diamond Ring", "Silver Ring"], bought_categories: ["Diamond Ring"], companion_name_1: "Ingest Companion",
  companion_phone_1: "9100090002", companion_relation_1: "Friend", instagram_follow_asked: "YES", google_review_asked: "NO",
  google_review_no_reason: "Not now", remark: "Synthetic parity ingest visit", source: "Instagram", form_mode: "NEW_WALKIN_ENTRY",
  reference_number: "MK-WK-PARITY-1",
};
const envelope = (form = VISIT, filesPayload = []) => ({ formDataObj: form, filesPayload });

export function ingestCases(key) {
  const good = { "x-mk-legacy-api-key": key };
  return [
    { id: "valid-new-client", headers: good, body: envelope() },
    { id: "repeat-client", headers: good, body: envelope({ ...VISIT, client_name: "Ingest Parity One Again", buy_status: "NO", not_bought_reasons: ["Price"], remark: "Second synthetic visit", reference_number: "MK-WK-PARITY-2" }) },
    { id: "replay-identical-submission", headers: good, body: envelope() },
    { id: "invalid-key", headers: { "x-mk-legacy-api-key": `${key}-wrong` }, body: envelope() },
    { id: "missing-key", headers: {}, body: envelope() },
    { id: "oversized", headers: good, body: envelope({ ...VISIT, padding: "x".repeat(1_100_000) }) },
    { id: "invalid-json", headers: good, raw: "{ not json" },
    { id: "invalid-fields-type", headers: good, body: { formDataObj: { branch: BRANCH, client_name: { nested: true }, client_phone: 5 }, filesPayload: [] } },
    { id: "invalid-fields-unknown-key-and-missing-form", headers: good, body: { extra: true } },
    { id: "invalid-fields-too-long", headers: good, body: envelope({ ...VISIT, remark: "y".repeat(2001) }) },
    { id: "proof-upload", headers: good, body: envelope(VISIT, [{ fieldName: "instagram_follow_proof", fileName: "proof.png", mimeType: "image/png", base64: "UEFSSVRZLVBST09G" }]) },
    { id: "invalid-branch", headers: good, body: envelope({ ...VISIT, branch: "No Such Branch", client_phone: "9100090003" }) },
    { id: "blank-branch", headers: good, body: envelope({ ...VISIT, branch: "  ", client_phone: "9100090004" }) },
    { id: "branch-case-insensitive", headers: good, body: envelope({ ...VISIT, branch: "  andheri PARITY ", client_name: "Ingest Parity Two", client_phone: "9100090005", reference_number: "MK-WK-PARITY-3" }) },
    { id: "failed-write-unknown-entry-token", headers: good, body: envelope({ ...VISIT, client_phone: "9100090006", entry_token: "0000-NOPE1" }) },
    { id: "wrong-method-get", method: "GET", headers: good },
  ];
}

async function post(url, { method = "POST", headers = {}, body, raw }, extraHeaders = {}) {
  const response = await fetch(url, {
    method,
    redirect: "manual",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers, ...extraHeaders },
    ...(method === "GET" ? {} : { body: raw ?? JSON.stringify(body) }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json };
}

async function runIngestCases({ cases, originalUrl, functionUrl, tables, originalSession }) {
  const results = [];
  for (const testCase of cases) {
    const original = await post(originalUrl, testCase, originalSession);
    const port = await post(functionUrl, testCase);
    const rows = rowDifferences(snapshot(tables));
    const jsonOriginal = JSON.stringify(maskResponse(original.json));
    const jsonPort = JSON.stringify(maskResponse(port.json));
    results.push({
      id: testCase.id,
      status: { original: original.status, port: port.status, identical: original.status === port.status },
      json: { identical: jsonOriginal === jsonPort, ...(jsonOriginal === jsonPort ? { value: maskResponse(original.json) } : { original: jsonOriginal.slice(0, 600), port: jsonPort.slice(0, 600) }) },
      rows: { identical: rows.length === 0, differences: rows },
    });
    console.log(`ingest ${testCase.id}: status ${original.status}/${port.status} ${original.status === port.status ? "=" : "≠"}  json ${jsonOriginal === jsonPort ? "=" : "≠"}  rows ${rows.length === 0 ? "=" : "≠"}`);
  }
  return results;
}

/** 30 requests per minute per key: from a fresh minute both must refuse the 31st, and only it. */
async function runRateLimit({ key, originalUrl, functionUrl, tables, originalSession }) {
  const wait = 61_000 - (Date.now() % 60_000);
  await new Promise((resolve) => setTimeout(resolve, wait));
  const drive = async (url, extra) => {
    const statuses = [];
    for (let index = 0; index < 32; index++) statuses.push((await post(url, { headers: { "x-mk-legacy-api-key": key }, raw: "{ not json" }, extra)).status);
    return statuses;
  };
  const original = await drive(originalUrl, originalSession);
  const port = await drive(functionUrl, {});
  const first = (statuses) => statuses.indexOf(429) + 1;
  const identical = JSON.stringify(original) === JSON.stringify(port);
  const rows = rowDifferences(snapshot(tables));
  console.log(`ingest rate-limit: first 429 at request ${first(original)}/${first(port)} ${identical ? "=" : "≠"}  rows ${rows.length === 0 ? "=" : "≠"}`);
  return { id: "rate-limit-30-per-minute", status: { original: first(original), port: first(port), identical }, json: { identical: true }, rows: { identical: rows.length === 0, differences: rows } };
}

// ---------------------------------------------------------------------------------------------
// Runo push cases
// ---------------------------------------------------------------------------------------------
// The original lead-form.tsx message for the route's result (unchanged in the port).
const uiMessage = (ok) => (ok ? "Lead saved and pushed to Runo." : "Lead saved locally. Runo sync not yet configured.");

async function runoCases({ stub, originalKeys, jewelosKeys, runoKey, tables }) {
  const leadIds = psql(ORIGINAL_DB_CONTAINER, "select id from public.leads order by phone_number;").split("\n").filter(Boolean);
  const users = Object.fromEntries(PARITY_USERS.map((user) => [user.key, user]));
  const sessions = {};
  for (const name of ["salesperson", "salesperson_bandra", "super_admin"]) {
    const cookies = await originalSessionCookies(originalKeys, users[name].email, PARITY_PASSWORD, "localhost");
    const session = await jewelosSession(jewelosKeys, users[name].email, PARITY_PASSWORD);
    sessions[name] = { cookie: cookies.map(({ name: key, value }) => `${key}=${value}`).join("; "), token: JSON.parse(session.value).access_token };
  }
  const cases = [
    { id: "creator-push-success", as: "salesperson", lead: leadIds[0], runo: { status: 200, body: { id: "runo-customer-1" } } },
    { id: "runo-error-status", as: "salesperson", lead: leadIds[0], runo: { status: 500, body: { message: "boom" } } },
    { id: "runo-network-failure", as: "salesperson", lead: leadIds[0], runo: { drop: true } },
    { id: "runo-success-without-id", as: "salesperson", lead: leadIds[0], runo: { status: 200, body: { ok: true } } },
    { id: "other-salesperson-forbidden", as: "salesperson_bandra", lead: leadIds[0], runo: { status: 200, body: { id: "must-not-be-sent" } } },
    { id: "super-admin-pushes-any-lead", as: "super_admin", lead: leadIds[1], runo: { status: 200, body: { id: "runo-customer-2" } } },
    { id: "unknown-lead", as: "salesperson", lead: "00000000-0000-4000-8000-00000000dead", runo: { status: 200, body: {} } },
  ];
  const results = [];
  for (const testCase of cases) {
    const session = sessions[testCase.as];
    const outbound = {};
    const responses = {};
    for (const app of ["original", "port"]) {
      stub.requests.length = 0;
      stub.respond(testCase.runo);
      const response = app === "original"
        ? await fetch(`${ORIGINAL_ORIGIN}/crm/api/leads/${testCase.lead}/runo`, { method: "POST", headers: { cookie: session.cookie } })
        : await fetch(`${jewelosKeys.url}/functions/v1/crm-runo-push`, { method: "POST", headers: { Authorization: `Bearer ${session.token}`, apikey: jewelosKeys.anonKey, "content-type": "application/json" }, body: JSON.stringify({ leadId: testCase.lead }) });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      responses[app] = { status: response.status, json };
      outbound[app] = stub.requests.map((request) => ({ ...request, authKey: request.authKey === runoKey ? "<runo key>" : request.authKey }));
    }
    const rows = rowDifferences(snapshot(tables));
    const statusIdentical = responses.original.status === responses.port.status;
    const jsonIdentical = JSON.stringify(responses.original.json) === JSON.stringify(responses.port.json);
    const outboundIdentical = JSON.stringify(outbound.original) === JSON.stringify(outbound.port);
    const okOf = (status) => status >= 200 && status < 300;
    const message = { original: uiMessage(okOf(responses.original.status)), port: uiMessage(okOf(responses.port.status)) };
    results.push({
      id: `runo:${testCase.id}`,
      status: { original: responses.original.status, port: responses.port.status, identical: statusIdentical },
      json: { identical: jsonIdentical, value: responses.original.json, ...(jsonIdentical ? {} : { port: responses.port.json }) },
      outbound: { identical: outboundIdentical, requests: outbound.original.length, ...(outboundIdentical ? { sample: outbound.original[0] } : { original: outbound.original, port: outbound.port }) },
      uiMessage: { identical: message.original === message.port, message: message.original },
      rows: { identical: rows.length === 0, differences: rows },
    });
    console.log(`runo ${testCase.id}: status ${responses.original.status}/${responses.port.status} ${statusIdentical ? "=" : "≠"}  json ${jsonIdentical ? "=" : "≠"}  outbound ${outboundIdentical ? "=" : "≠"} (${outbound.original.length} request)  message ${message.original === message.port ? "=" : "≠"}  rows ${rows.length === 0 ? "=" : "≠"}`);
  }
  return results;
}

// ---------------------------------------------------------------------------------------------
export async function runIngestParity({ originalKeys, jewelosKeys, base, jewelosWorkdir, report }) {
  const key = randomBytes(24).toString("hex");
  const runoKey = randomBytes(16).toString("hex");
  const stub = await startRunoStub();
  const envFile = join(base, "crm-functions.env");
  // Untracked, outside the repository, synthetic values only.
  writeFileSync(envFile, `CRM_LEGACY_WALKIN_INGEST_API_KEY=${key}\nRUNO_API_KEY=${runoKey}\nCRM_RUNO_API_URL=http://host.docker.internal:${STUB_PORT}/v1/crm/allocation\n`);
  const servers = [];
  try {
    servers.push(startServer("node", ["node_modules/next/dist/bin/next", "dev", "--port", "3300"], {
      cwd: join(REPO_ROOT, "sreejith-crm", "web-app"),
      env: {
        NEXT_PUBLIC_SUPABASE_URL: originalKeys.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: originalKeys.anonKey, NEXT_TELEMETRY_DISABLED: "1",
        // Explicit local values: they override the app's git-ignored .env, which may name hosted databases.
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:56322/postgres", DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:56322/postgres",
        LEGACY_WALKIN_INGEST_API_KEY: key, RUNO_API_KEY: runoKey, PARITY_RUNO_STUB_URL: `http://127.0.0.1:${STUB_PORT}`,
        NODE_OPTIONS: `--require ${join(REPO_ROOT, "scripts", "crm-parity", "runo-redirect.cjs").replaceAll("\\", "/")}`,
      },
    }));
    servers.push(startServer("supabase.cmd", ["functions", "serve", "--env-file", envFile, ...(jewelosWorkdir ? ["--workdir", jewelosWorkdir] : [])], { cwd: REPO_ROOT, env: {} }));
    const functionBase = `${jewelosKeys.url}/functions/v1`;
    try {
      await waitForUrl(`${ORIGINAL_ORIGIN}/crm/login`);
      await waitForUrl(`${functionBase}/crm-walkin-ingest`, { timeoutMs: 240_000 });
    } catch (error) {
      for (const server of servers) console.error(`--- server log ---\n${server.logTail()}`);
      throw error;
    }
    const tables = tableColumns();
    // The original's proxy.ts redirects every request without a session (its matcher excludes only
    // static assets), API routes included, so a cookie-less Apps Script call never reaches the
    // handler. The harness sends a signed-in cookie to the original so the HANDLER is compared;
    // the redirect itself is recorded as a finding.
    const salesperson = PARITY_USERS.find((user) => user.key === "salesperson");
    const cookies = await originalSessionCookies(originalKeys, salesperson.email, PARITY_PASSWORD, "localhost");
    const originalSession = { cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; ") };
    const probe = await fetch(`${ORIGINAL_ORIGIN}/crm/api/ingest/walkin`, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", "x-mk-legacy-api-key": key }, body: JSON.stringify(envelope()) });
    const proxyFinding = { statusWithoutSession: probe.status, location: probe.headers.get("location") };
    console.log(`original without a session: HTTP ${proxyFinding.statusWithoutSession} -> ${proxyFinding.location}`);
    const results = [];
    results.push(...await runIngestCases({ cases: ingestCases(key), originalUrl: `${ORIGINAL_ORIGIN}/crm/api/ingest/walkin`, functionUrl: `${functionBase}/crm-walkin-ingest`, tables, originalSession }));
    results.push(...await runoCases({ stub, originalKeys, jewelosKeys, runoKey, tables }));
    results.push(await runRateLimit({ key, originalUrl: `${ORIGINAL_ORIGIN}/crm/api/ingest/walkin`, functionUrl: `${functionBase}/crm-walkin-ingest`, tables, originalSession }));

    // JewelOS audit rows written by the ingest carry no customer values.
    const auditText = psql(JEWELOS_DB_CONTAINER, "select coalesce(string_agg(new_value::text, ' '), '') from public.audit_logs where module = 'crm' and action like 'crm.legacy_walkin_ingest_%';");
    const auditClean = !/Ingest Parity|Ingest Companion|9100090|Pune|Synthetic|Andheri/.test(auditText);
    const failed = results.filter((result) => !(result.status.identical && result.json.identical && result.rows.identical && (result.outbound?.identical ?? true) && (result.uiMessage?.identical ?? true)));
    if (failed.length) {
      // Keep the function runtime's own log next to the report: it explains platform-level answers (5xx from the gateway).
      const container = jewelosWorkdir ? "supabase_edge_runtime_jewelos-crm-parity-port" : "supabase_edge_runtime_jewelos";
      const logs = run("docker", ["logs", "--tail", "300", container], { allowFailure: true });
      writeFileSync(join(base, "ingest-functions-runtime.log"), `${logs.stdout}
${logs.stderr}
--- functions serve ---
${servers[1]?.logTail?.() ?? ""}`);
      console.log(`function runtime log: ${join(base, "ingest-functions-runtime.log")}`);
    }
    report({ results, auditHasNoCustomerValues: auditClean, originalProxyFinding: proxyFinding });
    console.log(`\ningest parity: ${results.length} cases, ${failed.length} differing; JewelOS ingest audit rows free of customer values: ${auditClean ? "yes" : "NO"}`);
    return failed.length === 0 && auditClean;
  } finally {
    servers.forEach(stopServer);
    stub.close();
  }
}
