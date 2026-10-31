import { beforeEach, describe, expect, it, vi } from "vitest";

const { pageRpc, equalityFilters, identifierFilters, selectedTables, taskRows, taskScopeRows, taskUsers } = vi.hoisted(() => ({
  pageRpc: vi.fn(),
  equalityFilters: [] as Array<[string, unknown]>,
  identifierFilters: [] as Array<{ table: string; values: unknown[] }>,
  selectedTables: [] as string[],
  taskRows: [] as Array<Record<string, unknown>>,
  taskScopeRows: [] as Array<{ id: string | null }>,
  taskUsers: [] as Array<{ employee_name: string | null; id: string | null }>,
}));

function query(table: string) {
  let includedIds: unknown[] | null = null;
  const result = () => ({
    data: table === "v_all_tasks"
      ? taskRows
        .filter((row) => !includedIds || includedIds.includes(row.id))
        .sort((left, right) => String(right.planned_datetime).localeCompare(String(left.planned_datetime)))
      : table === "v_task_feed_scope" ? taskScopeRows : table === "v_task_users" ? taskUsers : [],
    error: null,
  });
  const builder = {
    eq(column: string, value: unknown) { equalityFilters.push([column, value]); return builder; },
    gte() { return builder; },
    is() { return builder; },
    in(_column: string, values: unknown[]) { identifierFilters.push({ table, values }); includedIds = values; return builder; },
    lte() { return builder; },
    or() { return builder; },
    order() { return builder; },
    range() { return Promise.resolve(result()); },
    select() { selectedTables.push(table); return builder; },
    then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
  };
  return builder;
}

vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ rpc: pageRpc, from: (table: string) => query(table) }) }));

import { loadTaskAssignmentUsers, loadTaskSearchPage, loadTaskPage, loadTaskTabCounts, loadTaskFeed, taskFeedCurrentOrOverdueFilter, taskFeedIdBatches } from "./api";

beforeEach(() => {
  pageRpc.mockReset();
  equalityFilters.splice(0);
  identifierFilters.splice(0);
  selectedTables.splice(0);
  taskRows.splice(0);
  taskScopeRows.splice(0);
  taskUsers.splice(0);
});

describe("server-authorized task assignment roster", () => {
  it("counts Today from the same server filters used by pages, including the FMS hierarchy", async () => {
    pageRpc.mockImplementation(async (name: string) => name === "get_fms_task_workspace"
      ? { data: { total: 10 }, error: null }
      : { data: { ids: [], total: 2, counts: { pending: 2, overdue: 1, completed: 0, open: 3 } }, error: null });
    expect(await loadTaskTabCounts(false, "today")).toEqual({ mine: 2, delegated: 2, inLoop: 2, fms: 10 });
    expect(pageRpc).toHaveBeenCalledWith("get_fms_task_workspace", expect.objectContaining({ p_filter: { scope: "today", status: "active" } }));
    expect(pageRpc.mock.calls.filter(call => call[0] === "task_workspace_page").every(call => call[1].p_filter.scope === "today")).toBe(true);
    expect(selectedTables).toEqual([]);
  });
  it("loads all personal subsection counts without hydrating tasks or querying the admin scope", async () => {
    pageRpc.mockImplementation(async (_name: string, args: { p_view: string }) => ({
      data: { ids: [], total: 0, counts: { pending: args.p_view === "mine" ? 5 : 2, overdue: 1, completed: 0, open: args.p_view === "mine" ? 6 : 3 } }, error: null,
    }));
    expect(await loadTaskTabCounts(false)).toEqual({ mine: 6, delegated: 3, inLoop: 3, fms: 3 });
    expect(pageRpc.mock.calls.map(call => call[1].p_view)).toEqual(["mine", "delegated", "inLoop", "fms"]);
    expect(selectedTables).toEqual([]);
  });
  it("requests the admin count only when offered, and propagates server denial", async () => {
    pageRpc.mockResolvedValue({ data: null, error: { message: "All tasks access denied" } });
    await expect(loadTaskTabCounts(true)).rejects.toThrow("All tasks access denied");
    expect(pageRpc.mock.calls.map(call => call[1].p_view)).toContain("all");
    expect(selectedTables).toEqual([]);
  });
  it("returns authorized peers even when the directory contains no other people", async () => {
    pageRpc.mockReturnValue({ range: async () => ({ data: [{ id: "peer", employee_name: "Old label", first_name: "Branch", last_name: "Peer" }], error: null }) });
    const users = await loadTaskAssignmentUsers();
    expect(users.map(user => [user.id, user.employee_name])).toEqual([["peer", "Branch Peer"]]);
    expect(selectedTables).not.toContain("user_profiles");
  });
  it("fails closed when the assignment RPC denies access instead of falling back to the directory", async () => {
    pageRpc.mockReturnValue({ range: async () => ({ data: null, error: { message: "Task access denied" } }) });
    await expect(loadTaskAssignmentUsers()).rejects.toThrow("Load task assignment users: Task access denied");
    expect(selectedTables).toEqual([]);
  });
  it("loads every authorized assignee beyond one response page", async () => {
    pageRpc.mockReturnValue({ range: async (from: number) => ({ data: from === 0 ? Array.from({ length: 500 }, (_, index) => ({ id: `peer-${index}`, employee_name: `Peer ${index}` })) : [{ id: "last-peer", employee_name: "Last peer" }], error: null }) });
    const users = await loadTaskAssignmentUsers();
    expect(users).toHaveLength(501);
    expect(users.at(-1)?.id).toBe("last-peer");
  });
});

describe("task feed effective-deadline scope", () => {
  it("requests today plus only unfinished historical effective deadlines", () => {
    expect(taskFeedCurrentOrOverdueFilter("2026-08-27T00:00:00.000+05:30", "2026-08-27T23:59:59.999+05:30")).toBe(
      "and(effective_due_datetime.gte.2026-08-27T00:00:00.000+05:30,effective_due_datetime.lte.2026-08-27T23:59:59.999+05:30),and(effective_due_datetime.lt.2026-08-27T00:00:00.000+05:30,status.not.in.(completed,rejected,blocked)),and(effective_due_datetime.gt.2026-08-27T23:59:59.999+05:30,task_template_id.is.null,status.not.in.(completed,rejected,blocked)),and(task_type.eq.fms,status.in.(pending,in_progress,in_review,overdue))",
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

    expect(identifierFilters.filter((item) => item.table === "v_all_tasks").map((item) => item.values.length)).toEqual([50, 50, 50, 50, 1]);
    for (const table of ["task_checklists", "task_attachments"]) {
      expect(identifierFilters.filter((item) => item.table === table).map((item) => item.values.length)).toEqual([50, 50, 50, 50, 1]);
    }
    expect(identifierFilters.filter((item) => item.table === "form_submissions")).toEqual([]);
  });

  it("keeps delegated tasks globally date-ordered across hydration batches", async () => {
    taskScopeRows.push(...Array.from({ length: 51 }, (_, index) => ({ id: `task-${index}` })));
    taskRows.push(...Array.from({ length: 51 }, (_, index) => ({
      actual_datetime: null,
      assignee_id: `user-${index}`,
      due_datetime: null,
      form_template_id: null,
      id: `task-${index}`,
      planned_datetime: index === 50 ? "2026-08-28T12:00:00.000+05:30" : "2026-08-28T09:00:00.000+05:30",
      revised_datetime: null,
      status: "pending",
      task_type: "delegation",
    })));

    const result = await loadTaskFeed("admin-1", "2026-08-28T00:00:00.000+05:30", "2026-08-28T23:59:59.999+05:30", { tenantId: "tenant-1", delegated: true });

    expect(result[0]?.id).toBe("task-50");
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


describe("bounded page hydration", () => {
  it("hydrates only supplied ids without discovering the entire feed", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    taskRows.push({ id, assignee_id: "doer-1", task_type: "delegation", status: "pending", planned_datetime: "2030-01-01T00:00:00Z" });
    const rows = await loadTaskFeed("doer-1", "", "", { tenantId: "tenant-1", recordIds: [id] });
    expect(rows.map((row) => row.id)).toEqual([id]);
    expect(selectedTables).not.toContain("v_task_feed_scope");
    expect(identifierFilters.find((filter) => filter.table === "v_all_tasks")?.values).toEqual([id]);
  });
  it("does not turn an empty server page into an unbounded feed", async () => {
    expect(await loadTaskFeed("doer-1", "", "", { tenantId: "tenant-1", recordIds: [] })).toEqual([]);
    expect(selectedTables).toEqual([]);
  });
});


describe("server task page access", () => {
  it("counts every searched subsection from the same filters before pagination without hydration", async () => {
    const { defaultTaskSearch } = await import("@jewelos/core");
    const { loadTaskTabCounts } = await import("./api");
    const filters = { ...defaultTaskSearch(), query: "silver", status: "completed" as const, priority: "high" as const, scope: "today" as const, subsection: "mine" as const };
    pageRpc.mockResolvedValue({ data: { ids: [], total: 850, counts: { pending: 0, overdue: 0, completed: 850, open: 0 } }, error: null });
    expect(await loadTaskTabCounts(true, "today", "pending", filters)).toEqual({ mine: 850, delegated: 850, inLoop: 850, fms: 850, all: 850 });
    for (const subsection of ["mine", "delegated", "inLoop", "fms", "all"]) {
      expect(pageRpc).toHaveBeenCalledWith("task_workspace_page", { p_filter: { ...filters, subsection, mode: "explore" }, p_offset: 0, p_limit: 1 });
    }
    expect(selectedTables).toEqual([]);
  });

  it("passes strict calendar scope to the server before hydrating only the returned page", async () => {
    pageRpc.mockResolvedValue({ data: { ids: [], total: 0, counts: { pending: 0, overdue: 0, completed: 0, open: 0 } }, error: null });
    const result = await loadTaskPage("viewer", "tenant", "delegated", "pending", 50, "today");
    expect(pageRpc).toHaveBeenCalledWith("task_workspace_page", expect.objectContaining({ p_filter: expect.objectContaining({ scope: "today", subsection: "delegated", status: "pending", mode: "board" }), p_offset: 50, p_limit: 50 }));
    expect(result.tasks).toEqual([]);
    expect(selectedTables).toEqual([]);
  });

  it("preserves server ordering and full counts after detail hydration", async () => {
    const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
    const counts = { pending: 12000, overdue: 40, completed: 10, open: 12040 };
    pageRpc.mockResolvedValue({ data: { ids, total: 12000, counts }, error: null });
    taskRows.push(...ids.map((id, index) => ({ id, task_type: "delegation", status: "pending", assignee_id: "doer-1", planned_datetime: `2030-01-0${index + 1}T00:00:00Z` })));
    const page = await loadTaskPage("admin-1", "tenant-1", "all", "pending", 50);
    expect(page.tasks.map((task) => task.id)).toEqual(ids);
    expect(page.total).toBe(12000);
    expect(page.counts).toEqual(counts);
    expect(pageRpc).toHaveBeenCalledWith("task_feed_page", { p_view: "all", p_status: "pending", p_offset: 50, p_limit: 50 });
    expect(selectedTables).not.toContain("v_task_feed_scope");
  });
  it("does not hydrate an empty server page", async () => {
    pageRpc.mockResolvedValue({ data: { ids: [], total: 0, counts: { pending: 0, overdue: 0, completed: 0, open: 0 } }, error: null });
    expect((await loadTaskPage("admin-1", "tenant-1", "all", "pending")).tasks).toEqual([]);
    expect(selectedTables).toEqual([]);
  });
  it("propagates page authorization failures without reading task details", async () => {
    pageRpc.mockResolvedValue({ data: null, error: new Error("All tasks access denied") });
    await expect(loadTaskPage("staff-1", "tenant-1", "all", "pending")).rejects.toThrow("All tasks access denied");
    expect(selectedTables).toEqual([]);
  });
});

it("searches on the server and hydrates only returned IDs with subsection labels", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  pageRpc.mockResolvedValue({ data: { ids: [id], total: 850, counts: { pending: 800, overdue: 50, completed: 0, open: 850 }, sections: { [id]: "inLoop" } }, error: null });
  taskRows.push({ id, task_type: "checklist", status: "pending", assignee_id: "doer-1", planned_datetime: "2030-01-01T00:00:00Z" });
  const { defaultTaskSearch } = await import("@jewelos/core");
  const result = await loadTaskSearchPage("viewer", "tenant", { ...defaultTaskSearch(), query: "silver", kind: "crm" }, 50);
  expect(result.total).toBe(850);
  expect(result.tasks.map(task => task.id)).toEqual([id]);
  expect(result.sections[id]).toBe("inLoop");
  expect(pageRpc).toHaveBeenCalledWith("task_workspace_page", expect.objectContaining({ p_filter: expect.objectContaining({ query: "silver", kind: "crm" }), p_limit: 50, p_offset: 50 }));
  expect(selectedTables).not.toContain("v_task_feed_scope");
});
