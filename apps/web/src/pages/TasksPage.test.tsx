import { describe, expect, it } from "vitest";

describe("normal task upload completion", () => {
  it("uses one upload-and-complete contract instead of separate attachment and completion requests", async () => {
    const source = await import("./TasksPage?raw").then((module) => module.default);

    expect(source).toContain("uploadAndCompleteTask");
    expect(source).not.toContain('await uploadTaskAttachment(profile.tenant_id, task.id, action.file);\n      await updateTask(task.id, "complete")');
  });
});
