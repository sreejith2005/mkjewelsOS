import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOG } from "./catalog";

const migrationUrl = new URL("../../../../supabase/migrations/0156_granular_permissions_and_section_enforcement.sql", import.meta.url);

type SeedRow = { key: string; kind: string; pageId: string | null; defaultRoles: string[] };

function seededCatalog(): SeedRow[] {
  const sql = readFileSync(fileURLToPath(migrationUrl), "utf8");
  const block = sql.split("-- permission-catalog:begin")[1]?.split("-- permission-catalog:end")[0];
  if (!block) throw new Error("Permission catalog seed markers are missing");
  return [...block.matchAll(/^\('([a-z_.]+)', '([a-z]+)', (?:'([a-z_]+)'|null), '\{([a-z_,]*)\}', \d+\)[,;]$/gm)].map((match) => ({
    key: match[1]!,
    kind: match[2]!,
    pageId: match[3] ?? null,
    defaultRoles: match[4]!.split(",").filter(Boolean).sort(),
  }));
}

describe("permission catalog parity with migration 0156", () => {
  it("seeds exactly the catalog the client knows, with identical kinds, pages and role defaults", () => {
    const seeded = seededCatalog();
    expect(seeded).toHaveLength(PERMISSION_CATALOG.length);
    expect(seeded).toEqual(
      PERMISSION_CATALOG.map((item) => ({ key: item.key, kind: item.kind, pageId: item.pageId, defaultRoles: [...item.defaultRoles].sort() })),
    );
  });
});
