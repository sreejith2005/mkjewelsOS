import { beforeEach, describe, expect, it, vi } from "vitest";

const { equalityFilters, identifierFilters, selectedTables, taskRows, taskScopeRows, taskUsers } = vi.hoisted(() => ({
  equalityFilters: [] as Array<[string, unknown]>,
  identifierFilters: [] as Array<{ table: string; values: unknown[] }>,
  selectedTables: [] as string[],
  taskRows: [] as Array<Record<string, unknown>>,
  taskScopeRows: [] as Array<{ id: string | null }>,
  taskUsers: [] as Array<{ employee_name: string | null; id: string | null }>,
}));

function query(table: string) {
  const result = () => ({ data: table === "v_all_tasks" ? taskRows : table === "v_task_feed_scope" ? taskScopeRows : table === "v_task_users" ? taskUsers : [], error: null });
  const builder = {
    eq(column: string, value: unknown) { equalityFilters.push([column, value]); return builder; },
    gte() { return builder; },
    is() { return builder; },
    in(_column: string, values: unknown[]) { identifierFilters.push({ table, values }); return builder; },
    lte() { return builder; },
    or() { return builder; },
    order() { return builder; },
    range() { return Promise.resolve(result()); },
    select() { selectedTables.push(table); return builder; },
    then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
  };
  return builder;
}

vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ from: (table: string) => query(table) }) }));

import { loadTaskFeed, taskFeedCurrentOrOverdueFilter, taskFeedIdBatches } from "./api";

beforeEach(() => {
  equalityFilters.splice(0);
  identifierFilters.splice(0);
  selectedTables.splice(0);
  taskRows.splice(0);
  taskScopeRows.splice(0);
  taskUsers.splice(0);
});

describe("task feed effective-deadline scope", () => {
  it("requests today plus only unfinished historical effective deadlines", () => {
    expect(taskFeedCurrentOrOverdueFilter("2026-08-27T00:00:00.000+05:30", "2026-08-27T23:59:59.999+05:30")).toBe(
      "and(effective_due_datetime.gte.2026-08-27T00:00:00.000+05:30,effective_due_datetime.lte.2026-08-27T23:59:59.999+05:30),and(effective_due_datetime.lt.2026-08-27T00:00:00.000+05:30,status.not.in.(completed,rejected,blocked)),and(task_type.eq.fms,status.in.(pending,in_progress,in_review,overdue))",
    );
  });

  it("batches task identifiers before requesting detailed assignee rows", () => {
    expect(taskFeedIdBatches(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("includes authored checklist and delegation instances in the delegated workspace", async () => {
    await loadTaskFeed("admin-1", "2026-08-28T00:00:00.000+05:30", "2026-08-28T23:59:59.999+05:30", {
      tenantId: "tenant-1",
      delegated: true,
      includeOverdue: true,
    });

    expect(equalityFilters).toContainEqual(["created_by", "admin-1"]);
    expect(equalityFilters).not.toContainEqual(["task_type", "delegation"]);
  });

  it("discovers tenant-scoped authored ids before hydrating the wide task view", async () => {
    taskScopeRows.push({ id: "task-1" }, { id: "task-1" }, { id: "task-2" });
    taskRows.push(...["task-1", "task-2"].map((id) => ({
      actual_datetime: null,
      assignee_id: "doer-1",
      due_datetime: null,
      form_template_id: null,
      id,
      planned_datetime: "2026-08-28T12:00:00.000+05:30",
      revised_datetime: null,
      status: "pending",
      task_type: "delegation",
    })));

    await loadTaskFeed("admin-1", "2026-08-28T00:00:00.000+05:30", "2026-08-28T23:59:59.999+05:30", {
      tenantId: "tenant-1",
      delegated: true,
      includeOverdue: true,
    });

    expect(selectedTables).toContain("v_task_feed_scope");
    expect(equalityFilters).toContainEqual(["tenant_id", "tenant-1"]);
    expect(identifierFilters.filter((item) => item.table === "v_all_tasks")).toEqual([
      { table: "v_all_tasks", values: ["task-1", "task-2"] },
    ]);
  });

  it("batches checklist, attachment, and form detail requests for large task feeds", async () => {
    taskScopeRows.push(...Array.from({ length: 201 }, (_, index) => ({ id: `task-${index}` })));
    taskRows.push(...Array.from({ length: 201 }, (_, index) => ({
      actual_datetime: null,
      assignee_id: `user-${index}`,
      due_datetime: null,
      form_template_id: null,
      id: `task-${index}`,
      planned_datetime: "2026-08-28T12:00:00.000+05:30",
      revised_datetime: null,
      status: "pending",
      task_type: index % 2 ? "delegation" : "checklist",
    })));

    await loadTaskFeed("admin-1", "2026-08-28T00:00:00.000+05:30", "2026-08-28T23:59:59.999+05:30", { tenantId: "tenant-1", delegated: true });

    expect(identifierFilters.filter((item) => item.table === "v_all_tasks").map((item) => item.values.length)).toEqual([200, 1]);
    for (const table of ["task_checklists", "task_attachments"]) {
      expect(identifierFilters.filter((item) => item.table === table).map((item) => item.values.length)).toEqual([50, 50, 50, 50, 1]);
    }
    expect(identifierFilters.filter((item) => item.table === "form_submissions")).toEqual([]);
  });

  it("resolves the designated verifier from the existing bounded roster load", async () => {
    taskScopeRows.push({ id: "task-1" });
    taskRows.push({
      actual_datetime: null,
      assignee_id: "doer-1",
      due_datetime: null,
      form_template_id: null,
      id: "task-1",
      planned_datetime: "2026-08-28T12:00:00.000+05:30",
      revised_datetime: null,
      status: "pending",
      task_type: "checklist",
      verifier_user_profile_id: "verifier-1",
    });
    taskUsers.push(
      { employee_name: "Ashwini Kamble", id: "doer-1" },
      { employee_name: "Nikita Patil", id: "verifier-1" },
    );

    const [result] = await loadTaskFeed("admin-1", "2026-08-28T00:00:00.000+05:30", "2026-08-28T23:59:59.999+05:30", { tenantId: "tenant-1", delegated: true });

    expect(result?.assigneeName).toBe("Ashwini Kamble");
    expect(result?.verifierName).toBe("Nikita Patil");
  });

  it("uses a neutral verifier fallback when the visible roster cannot resolve the profile", async () => {
    taskScopeRows.push({ id: "task-1" });
    taskRows.push({
      actual_datetime: null,
      assignee_id: "doer-1",
      due_datetime: null,
      form_template_id: null,
      id: "task-1",
      planned_datetime: "2026-08-28T12:00:00.000+05:30",
      revised_datetime: null,
      status: "pending",
      task_type: "checklist",
      verifier_user_profile_id: "verifier-1",
    });

    const [result] = await loadTaskFeed("admin-1", "2026-08-28T00:00:00.000+05:30", "2026-08-28T23:59:59.999+05:30", { tenantId: "tenant-1", delegated: true });

    expect(result?.verifierName).toBe("Verifier unavailable");
  });
});
