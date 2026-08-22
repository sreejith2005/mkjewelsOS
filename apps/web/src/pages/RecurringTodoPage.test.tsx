import { describe, expect, it } from "vitest";

describe("Recurring / To-Do workspace contract", () => {
  it("keeps operational buckets and manager tools in the dedicated workspace", async () => {
    const source = await import("./RecurringTodoPage?raw").then((module) => module.default);
    for (const label of ["Today", "Overdue", "Completed", "Coverage Required", "Manager Review", "Schedules", "Verification", "Follow-ups", "Performance", "Import schedules"]) {
      expect(source).toContain(label);
    }
    for (const action of ["Start", "Complete", "Upload", "Fill form", "Verify", "Reject", "Pause", "Activate", "Run now"]) {
      expect(source).toContain(action);
    }
  });
});
