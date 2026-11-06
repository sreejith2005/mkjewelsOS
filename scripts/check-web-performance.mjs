import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const WEB_BUDGETS = { startup: 300 * 1024, chunk: 280 * 1024, total: 1400 * 1024 };

/** Count static startup dependencies once; lazy routes must stay outside startup. */
export function startupFiles(manifest) {
  const seen = new Set();
  const files = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const entry = manifest[key];
    if (!entry) throw new Error(`Missing build manifest dependency: ${key}`);
    files.add(entry.file);
    for (const css of entry.css ?? []) files.add(css);
    for (const dependency of entry.imports ?? []) visit(dependency);
  };
  for (const [key, entry] of Object.entries(manifest)) if (entry.isEntry) visit(key);
  if (!files.size) throw new Error("Build manifest has no entry point");
  return files;
}

export async function checkWebPerformance(dist) {
  const manifest = JSON.parse(await readFile(path.join(dist, ".vite/manifest.json"), "utf8"));
  const startup = startupFiles(manifest);
  const allJs = new Set(Object.values(manifest).map((entry) => entry.file).filter((file) => file.endsWith(".js")));
  const sizes = new Map();
  for (const file of new Set([...startup, ...allJs])) sizes.set(file, gzipSync(await readFile(path.join(dist, file))).length);
  const startupBytes = [...startup].reduce((sum, file) => sum + sizes.get(file), 0);
  const totalBytes = [...allJs].reduce((sum, file) => sum + sizes.get(file), 0);
  const violations = [];
  if (startupBytes > WEB_BUDGETS.startup) violations.push(`Startup ${startupBytes} > ${WEB_BUDGETS.startup} bytes gzip`);
  if (totalBytes > WEB_BUDGETS.total) violations.push(`Total JS ${totalBytes} > ${WEB_BUDGETS.total} bytes gzip`);
  for (const file of allJs) if (sizes.get(file) > WEB_BUDGETS.chunk) violations.push(`Chunk ${file} exceeds ${WEB_BUDGETS.chunk} bytes gzip`);
  return { startupBytes, totalBytes, violations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkWebPerformance(fileURLToPath(new URL("../apps/web/dist/", import.meta.url)));
  console.log(`Web bundle gzip: startup ${result.startupBytes} bytes; total JavaScript ${result.totalBytes} bytes.`);
  if (result.violations.length) { console.error(result.violations.join("\n")); process.exitCode = 1; }
}
