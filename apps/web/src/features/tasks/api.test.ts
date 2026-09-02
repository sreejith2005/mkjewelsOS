import { beforeEach, describe, expect, it, vi } from "vitest";

const { equalityFilters, identifierFilters, taskRows, taskUsers } = vi.hoisted(() => ({
  equalityFilters: [] as Array<[string, unknown]>,
  identifierFilters: [] as Array<{ table: string; values: unknown[] }>,
  taskRows: [] as Array<Record<string, unknown>>,
  taskUsers: [] as Array<{ employee_name: string | null; id: string | null }>,
}));

function query(table: string) {
  const result = () => ({ data: table === "v_all_tasks" ? taskRows : table === "v_task_users" ? taskUsers : [], error: null });
  const builder = {
    eq(column: string, value: unknown) { equalityFilters.push([column, value]); return builder; },
    gte() { return builder; },
    is() { return builder; },
    in(_column: string, values: unknown[]) { identifierFilters.push({ table, values }); return builder; },
    lte() { return builder; },
    or() { return builder; },
    order() { return builder; },
    range() { return Promise.resolve(result()); },
    select() { return builder; },
    then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
  };
  return builder;
}

vi.mock("@jewelos/api-client", () => ({ supabase: { from: (table: string) => query(table) } }));

import { loadTaskFeed, taskFeedCurrentOrOverdueFilter, taskFeedIdBatches } from "./api";

beforeEach(() => {
  equalityFilters.splice(0);
  identifierFilters.splice(0);
  taskRows.splice(0);
  taskUsers.splice(0);
});

describe("task feed effective-deadline scope", () => {
  it("requests today plus only unfinished historical effective deadlines", () => {
    expect(taskFeedCurrentOrOverdueFilter("2026-08-27T00:00:00.000+05:30", "2026-08-27T23:59:59.999+05:30")).toBe(
      "and(revised_datetime.gte.2026-08-27T00:00:00.000+05:30,revised_datetime.lte.2026-08-27T23:59:59.999+05:30),and(revised_datetime.is.null,due_datetime.gte.2026-08-27T00:00:00.000+05:30,due_datetime.lte.2026-08-27T23:59:59.999+05:30),and(revised_datetime.is.null,due_datetime.is.null,planned_datetime.gte.2026-08-27T00:00:00.000+05:30,planned_datetime.lte.2026-08-27T23:59:59.999+05:30),and(revised_datetime.lt.2026-08-27T00:00:00.000+05:30,status.not.in.(completed,rejected,blocked)),and(revised_datetime.is.null,due_datetime.lt.2026-08-27T00:00:00.000+05:30,status.not.in.(completed,rejected,blocked)),and(revised_datetime.is.null,due_datetime.is.null,planned_datetime.lt.2026-08-27T00:00:00.000+05:30,status.not.in.(completed,rejected,blocked))",
    );
  });

  it("batches task identifiers before requesting detailed assignee rows", () => {
    expect(taskFeedIdBatches(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("includes authored checklist and delegation instances in the delegated workspace", async () => {
    await loadTaskFeed("admin-1", "2026-08-28T00:00:00.000+05:30", "2026-08-28T23:59:59.999+05:30", {
      delegated: true,
      includeOverdue: true,
    });

    expect(equalityFilters).toContainEqual(["created_by", "admin-1"]);
    expect(equalityFilters).not.toContainEqual(["task_type", "delegation"]);
  });

  it("batches checklist, attachment, and form detail requests for large task feeds", async () => {
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

    await loadTaskFeed("admin-1", "2026-08-28T00:00:00.000+05:30", "2026-08-28T23:59:59.999+05:30", { delegated: true });

    for (const table of ["task_checklists", "task_attachments"]) {
      expect(identifierFilters.filter((item) => item.table === table).map((item) => item.values.length)).toEqual([50, 50, 50, 50, 1]);
    }
    expect(identifierFilters.filter((item) => item.table === "form_submissions")).toEqual([]);
  });

  it("resolves the designated verifier from the existing bounded roster load", async () => {
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

    const [result] = await loadTaskFeed("admin-1", "2026-08-28T00:00:00.000+05:30", "2026-08-28T23:59:59.999+05:30", { delegated: true });

    expect(result?.assigneeName).toBe("Ashwini Kamble");
    expect(result?.verifierName).toBe("Nikita Patil");
  });

  it("uses a neutral verifier fallback when the visible roster cannot resolve the profile", async () => {
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

    const [result] = await loadTaskFeed("admin-1", "2026-08-28T00:00:00.000+05:30", "2026-08-28T23:59:59.999+05:30", { delegated: true });

    expect(result?.verifierName).toBe("Verifier unavailable");
  });
});
