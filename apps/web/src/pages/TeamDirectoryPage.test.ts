import { describe, expect, it } from "vitest";

describe("Employee Directory account administration", () => {
  it("offers the active Users route an Add user action backed by the real account form", async () => {
    const source = await import("./TeamDirectoryPage?raw").then(
      (module) => module.default,
    );

    expect(source).toContain("Add user");
    expect(source).toContain("<AddUserForm");
  });
});
