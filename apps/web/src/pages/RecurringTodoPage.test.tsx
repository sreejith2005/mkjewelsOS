import { describe, expect, it } from "vitest";

describe("Recurring / To-Do workspace contract", () => {
  it("keeps operational buckets and manager tools in the dedicated workspace", async () => {
    const source = await import("./RecurringTodoPage?raw").then((module) => module.default);
    for (const label of ["Today", "Overdue", "Rejected", "Completed", "Coverage Required", "Manager Review", "Schedules", "Verification", "Follow-ups", "Performance", "Import schedules"]) {
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
    expect(source).toContain("await materializeRecurringTemplate(templateId, payload);");
  });

  it("asks for a real completion remark instead of writing a placeholder", async () => {
    const source = await import("./RecurringTodoPage?raw").then((module) => module.default);

    expect(source).not.toContain("Completed from Recurring / To-Do");
    expect(source).toContain("const needsRemark = Boolean(task.requires_remark) || !isOwnWork;");
    expect(source).toContain("Why are you completing this on behalf of the doer?");
    expect(source).toContain("if (needsRemark && !entered?.trim()) return;");
  });

  it("offers verification to the named verifier as well as an administrator", async () => {
    const source = await import("./RecurringTodoPage?raw").then((module) => module.default);

    expect(source).toContain(
      "const canVerify = canManage || task.verifier_user_profile_id === profile?.id;",
    );
    expect(source).toContain("!task.requires_form && canVerify &&");
  });

  it("filters the workspace on the reference filter set and reports the on-time outcome", async () => {
    const source = await import("./RecurringTodoPage?raw").then((module) => module.default);

    for (const filter of ["status: statusFilter", "priority: priorityFilter", "branch_id: branchFilter", "department_id: departmentFilter"]) {
      expect(source).toContain(filter);
    }
    for (const tile of ["On time", "Delayed", "On behalf"]) {
      expect(source).toContain(tile);
    }
    expect(source).toContain("Delayed by ${task.completion_delay_minutes ?? 0} min");
  });
});
