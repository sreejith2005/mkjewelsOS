import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const mobileRequire = createRequire(import.meta.url);

describe("mobile runtime dependencies", () => {
  it("resolves the spreadsheet parser used by shared task import code", () => {
    expect(() => mobileRequire.resolve("xlsx")).not.toThrow();
  });
});
