import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(process.cwd(), "src");
const ALLOWED = new Set([
  "theme/makeStyles.ts",
  "theme/theme.ts",
  "theme/ThemeProvider.tsx",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("native theme coverage", () => {
  it("does not capture the default palette in application modules", () => {
    const violations = sourceFiles(SOURCE_ROOT)
      .map((path) => ({ path, relativePath: relative(SOURCE_ROOT, path).replaceAll("\\", "/") }))
      .filter(({ relativePath }) => !ALLOWED.has(relativePath))
      .filter(({ path }) => /from\s+["']@\/theme\/theme["']/.test(readFileSync(path, "utf8")))
      .map(({ relativePath }) => relativePath);

    expect(violations, `Static theme imports:\n${violations.join("\n")}`).toEqual([]);
  });
});
