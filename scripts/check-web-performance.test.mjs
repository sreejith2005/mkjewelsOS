import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { checkWebPerformance, startupFiles, WEB_BUDGETS } from "./check-web-performance.mjs";

test("startup follows transitive static imports, deduplicates shared chunks, excludes lazy routes", () => {
  const files = startupFiles({
    main: { isEntry: true, file: "main.js", imports: ["a", "shared"], dynamicImports: ["lazy"] },
    a: { file: "a.js", imports: ["shared"], css: ["style.css"] },
    shared: { file: "shared.js", imports: ["a"] },
    lazy: { isDynamicEntry: true, file: "lazy.js" },
  });
  assert.deepEqual([...files].sort(), ["a.js", "main.js", "shared.js", "style.css"]);
  assert.throws(() => startupFiles({}), /no entry/);
  assert.throws(() => startupFiles({ main: { isEntry: true, file: "main.js", imports: ["missing"] } }), /Missing/);
});

test("an oversized production startup fails the budget", async () => {
  const dist = await mkdtemp(path.join(tmpdir(), "jewelos-budget-"));
  try {
    await mkdir(path.join(dist, ".vite"));
    await writeFile(path.join(dist, ".vite/manifest.json"), JSON.stringify({ main: { isEntry: true, file: "main.js" } }));
    await writeFile(path.join(dist, "main.js"), randomBytes(WEB_BUDGETS.startup + 1024));
    const result = await checkWebPerformance(dist);
    assert.ok(result.violations.some((message) => message.startsWith("Startup")));
    assert.ok(result.violations.some((message) => message.startsWith("Chunk")));
  } finally { await rm(dist, { recursive: true }); }
});
