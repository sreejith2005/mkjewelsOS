import { describe, expect, it } from "vitest";

describe("Employee Directory account administration", () => {
  it("offers the active Users route an Add user action backed by the real account form", async () => {
    const source = await import("./TeamDirectoryPage?raw").then(
      (module) => module.default,
    );

    expect(source).toContain("Add user");
    expect(source).toContain("<AddUserForm");
    expect(source).toContain("<EditUser");
    const editorSource = await import("./UserManagementPage?raw").then(
      (module) => module.default,
    );
    expect(editorSource).toContain("Delete user");
  });

  it("hides former employees by default through the shared core rule", async () => {
    const source = await import("./TeamDirectoryPage?raw").then(
      (module) => module.default,
    );

    expect(source).toContain("useState(false); const [showFormer");
    expect(source).toContain("(showFormer || !isFormerEmployee(employee))");
    expect(source).toContain("Show former employees");
  });
});
