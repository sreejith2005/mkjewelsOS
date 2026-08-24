import { describe, expect, it } from "vitest";

describe("recurring schedule completion mode authoring", () => {
  it("places Task Type before Buddy Assignment Allowed and derives image-evidence tasks", async () => {
    const source = await import("./TaskForms?raw").then((module) => module.default);

    expect(source.indexOf('label="Task Type"')).toBeLessThan(
      source.indexOf('label="Buddy Assignment Allowed"'),
    );
    expect(source).toContain('task_type: taskMode === "task" ? "delegation" : "checklist"');
    expect(source).toContain('requires_upload: taskMode === "task"');
  });
});
