import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOG } from "./catalog";

const migrationsDir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));

type SeedRow = { key: string; kind: string; pageId: string | null; defaultRoles: string[] };

/**
 * Migration 0156 seeds the catalog and later migrations append to it. Every
 * migration carrying the seed markers is read, and rows are ordered by their
 * `sort_order`, which is the order the client catalog lists them in.
 */
function seededCatalog(): SeedRow[] {
  const blocks = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(`${migrationsDir}${file}`, "utf8"))
    .filter((sql) => sql.includes("-- permission-catalog:begin"))
    .map((sql) => sql.split("-- permission-catalog:begin")[1]?.split("-- permission-catalog:end")[0] ?? "");
  if (blocks.length === 0 || blocks.some((block) => !block)) throw new Error("Permission catalog seed markers are missing");
  return blocks
    .flatMap((block) => [...block.matchAll(/^\('([a-z_.]+)', '([a-z]+)', (?:'([a-z_]+)'|null), '\{([a-z_,]*)\}', (\d+)\)[,;]$/gm)])
    .map((match) => ({
      sortOrder: Number(match[5]),
      row: { key: match[1]!, kind: match[2]!, pageId: match[3] ?? null, defaultRoles: match[4]!.split(",").filter(Boolean).sort() },
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ row }) => row);
}

describe("permission catalog parity with the seeding migrations", () => {
  it("seeds exactly the catalog the client knows, with identical kinds, pages and role defaults", () => {
    const seeded = seededCatalog();
    expect(seeded).toHaveLength(PERMISSION_CATALOG.length);
    expect(seeded).toEqual(
      PERMISSION_CATALOG.map((item) => ({ key: item.key, kind: item.kind, pageId: item.pageId, defaultRoles: [...item.defaultRoles].sort() })),
    );
  });
});
