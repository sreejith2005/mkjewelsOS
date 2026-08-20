import { readFile } from "node:fs/promises";

import { classifyCrmMappingPreflight, type CrmPreflightMapping, type CrmPreflightSourceRecord } from "../packages/core/src/crm/preflight.ts";

type Snapshot = { branches?: CrmPreflightSourceRecord[]; staff?: CrmPreflightSourceRecord[] };
type MappingSnapshot = { branchMappings?: CrmPreflightMapping[]; staffMappings?: CrmPreflightMapping[] };

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function main(): Promise<void> {
  const [legacyPath, jewelosPath, mappingsPath] = process.argv.slice(2);
  if (!legacyPath || !jewelosPath || !mappingsPath) {
    throw new Error("Usage: tsx scripts/crm-migration-preflight.ts <legacy-snapshot.json> <jewelos-snapshot.json> <mappings.json>");
  }
  const [legacy, jewelos, mappings] = await Promise.all([
    readJson<Snapshot>(legacyPath), readJson<Snapshot>(jewelosPath), readJson<MappingSnapshot>(mappingsPath),
  ]);
  const branchReport = classifyCrmMappingPreflight(legacy.branches ?? [], mappings.branchMappings ?? [], new Set((jewelos.branches ?? []).map((item) => item.externalId)));
  const staffReport = classifyCrmMappingPreflight(legacy.staff ?? [], mappings.staffMappings ?? [], new Set((jewelos.staff ?? []).map((item) => item.externalId)));
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), branchReport, staffReport }, null, 2));
}

void main();
