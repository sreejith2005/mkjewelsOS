import { describe, expect, it } from "vitest";

describe("Recurring / To-Do assignment composer", () => {
  it("keeps the operational assignment, schedule, and task-control fields", async () => {
    const source = await import("./TaskForms?raw").then((module) => module.default);
    for (const label of [
      "1 · Assignment",
      "Assign to user",
      "Department",
      "Branch",
      "Core task",
      "2 · Schedule",
      "Frequency",
      "Task start date",
      "Scheduled start time",
      "Due time",
      "3 · Task controls",
      "Task type",
      "Buddy assignment allowed",
    ]) expect(source).toContain(label);
    expect(source).toContain("due_time");
    expect(source).toContain("coverage_enabled: true");
  });
});
