import { describe, expect, it } from "vitest";

describe("Recurring / To-Do workspace contract", () => {
  it("keeps operational buckets and manager tools in the dedicated workspace", async () => {
    const source = await import("./RecurringTodoPage?raw").then((module) => module.default);
    for (const label of ["Today", "Overdue", "Completed", "Coverage Required", "Manager Review", "Schedules", "Verification", "Follow-ups", "Performance", "Import schedules"]) {
      expect(source).toContain(label);
    }
    for (const action of ["Start", "Complete", "Upload", "Verify", "Reject", "Pause", "Activate", "Run now"]) {
      expect(source).toContain(action);
    }
    expect(source).toContain("Complete form");
    expect(source).toContain('task.requires_form && task.status !== "completed"');
    expect(source).toContain('task.coverage_status !== "coverage_required"');
    expect(source).toContain("!task.requires_form && task.task_type === \"checklist\"");
    expect(source).toContain("!task.requires_form && task.task_type !== \"checklist\"");
    expect(source).toContain('aria-label="Complete checklist"');
    expect(source).toContain("completeRecurringTaskWithImage");
  });

  it("materializes a due schedule immediately after saving it", async () => {
    const source = await import("./RecurringTodoPage?raw").then((module) => module.default);

    expect(source).toContain("materializeRecurringTemplate");
    expect(source).toContain("const templateId = await saveRecurringTemplate(id, payload);");
    expect(source).toContain("await materializeRecurringTemplate(templateId);");
  });
});
