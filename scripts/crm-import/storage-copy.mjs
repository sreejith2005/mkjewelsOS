// Copies the original CRM's Storage objects (bucket crm-documents) into JewelOS bucket
// crm-legacy-documents at the same object path (0188: only the bucket id changes, so the imported
// crm.documents.storage_path values stay valid). Verifies size and eTag on download and SHA-256
// after upload, and writes a manifest. Keys come from the environment at run time only:
//
//   SOURCE_SUPABASE_URL (or --source-env=<file with SOURCE_SUPABASE_URL=...>)
//   SOURCE_SUPABASE_KEY            key allowed to read the private source bucket (GET only)
//   TARGET_SUPABASE_URL, TARGET_SUPABASE_SERVICE_KEY
//   CRM_IMPORT_SOURCE_URL          database listing the source objects (--objects-table, default storage.objects)
//
//   node scripts/crm-import/storage-copy.mjs --files-dir=C:\crm-private\work\files --manifest=C:\crm-private\work\storage-manifest.json [--dry-run]
//
// Files and manifest hold real data: both paths are refused inside a Git working tree. The console
// shows counts only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import pg from "pg";

import { assertOutsideGit, parseArgs, redactError } from "./lib.mjs";

export const SOURCE_BUCKET = "crm-documents";
export const TARGET_BUCKET = "crm-legacy-documents";

/** Object path in the target bucket: unchanged (the Phase 2 bucket move kept every path). */
export const targetPath = (sourcePath) => sourcePath;

const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const md5 = (buffer) => createHash("md5").update(buffer).digest("hex");

function readEnvFile(file) {
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

async function storageFetch(url, key, init = {}) {
  const response = await fetch(url, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, ...(init.headers ?? {}) } });
  return response;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fromFile = args["source-env"] ? readEnvFile(args["source-env"]) : {};
  const sourceUrl = process.env.SOURCE_SUPABASE_URL ?? fromFile.SOURCE_SUPABASE_URL;
  const sourceKey = process.env.SOURCE_SUPABASE_KEY;
  const targetUrl = process.env.TARGET_SUPABASE_URL;
  const targetKey = process.env.TARGET_SUPABASE_SERVICE_KEY;
  const dbUrl = process.env.CRM_IMPORT_SOURCE_URL;
  const filesDir = args["files-dir"];
  const manifestPath = args.manifest;
  const objectsTable = args["objects-table"] ?? "storage.objects";
  const dryRun = args["dry-run"] === true;
  if (!/^[a-z_]+\.[a-z_]+$/.test(objectsTable)) throw new Error("--objects-table must be schema.table");
  for (const [name, value] of Object.entries({ SOURCE_SUPABASE_URL: sourceUrl, SOURCE_SUPABASE_KEY: sourceKey, CRM_IMPORT_SOURCE_URL: dbUrl, "--files-dir": filesDir, "--manifest": manifestPath })) {
    if (!value) throw new Error(`${name} is required`);
  }
  if (!dryRun && (!targetUrl || !targetKey)) throw new Error("TARGET_SUPABASE_URL and TARGET_SUPABASE_SERVICE_KEY are required (or --dry-run)");
  assertOutsideGit(filesDir);
  assertOutsideGit(manifestPath);

  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  const { rows: objects } = await db.query(
    `select name, (metadata->>'size')::bigint as size, metadata->>'eTag' as etag, coalesce(metadata->>'mimetype', 'application/octet-stream') as mimetype
       from ${objectsTable} where bucket_id = $1 order by name`,
    [SOURCE_BUCKET],
  );
  await db.end();
  console.log(`source objects: ${objects.length}${dryRun ? " (dry run: download and verify only)" : ""}`);

  const manifest = { source_bucket: SOURCE_BUCKET, target_bucket: TARGET_BUCKET, path_rule: "target path = source path", started_at: new Date().toISOString(), objects: [] };
  const tally = { downloaded: 0, cached: 0, uploaded: 0, already_present: 0, verified: 0, failed: 0 };
  for (const object of objects) {
    const entry = { path: object.name, target_path: targetPath(object.name), expected_size: Number(object.size) };
    manifest.objects.push(entry);
    try {
      const local = join(filesDir, ...object.name.split("/"));
      let body;
      if (existsSync(local) && readFileSync(local).length === entry.expected_size) {
        body = readFileSync(local);
        tally.cached++;
      } else {
        const response = await storageFetch(`${sourceUrl}/storage/v1/object/authenticated/${SOURCE_BUCKET}/${encodePath(object.name)}`, sourceKey);
        if (!response.ok) throw new Error(`source download HTTP ${response.status}`);
        body = Buffer.from(await response.arrayBuffer());
        mkdirSync(dirname(local), { recursive: true });
        writeFileSync(local, body);
        tally.downloaded++;
      }
      entry.size = body.length;
      entry.sha256 = sha256(body);
      entry.size_ok = entry.size === entry.expected_size;
      // A single-part upload's eTag is the object's MD5; multipart eTags ("...-N") are not comparable.
      const etag = (object.etag ?? "").replaceAll("\"", "");
      entry.etag_ok = etag && !etag.includes("-") ? md5(body) === etag : null;
      if (!entry.size_ok || entry.etag_ok === false) throw new Error("downloaded file does not match the source metadata");
      if (dryRun) continue;

      const upload = await storageFetch(`${targetUrl}/storage/v1/object/${TARGET_BUCKET}/${encodePath(entry.target_path)}`, targetKey, {
        method: "POST", body, headers: { "content-type": object.mimetype, "x-upsert": "false", "cache-control": "3600" },
      });
      if (upload.ok) tally.uploaded++;
      else if (upload.status === 409 || upload.status === 400) tally.already_present++; // verified below either way
      else throw new Error(`target upload HTTP ${upload.status}`);
      const check = await storageFetch(`${targetUrl}/storage/v1/object/authenticated/${TARGET_BUCKET}/${encodePath(entry.target_path)}`, targetKey);
      if (!check.ok) throw new Error(`target read-back HTTP ${check.status}`);
      const copy = Buffer.from(await check.arrayBuffer());
      entry.target_size = copy.length;
      entry.target_sha256 = sha256(copy);
      entry.verified = entry.target_sha256 === entry.sha256 && entry.target_size === entry.size;
      if (!entry.verified) throw new Error("target object differs from the source file");
      tally.verified++;
    } catch (error) {
      entry.error = redactError(error);
      tally.failed++;
    }
  }
  manifest.finished_at = new Date().toISOString();
  manifest.tally = tally;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(", "));
  if (tally.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`storage-copy failed: ${redactError(error)}`);
  process.exitCode = 1;
});
