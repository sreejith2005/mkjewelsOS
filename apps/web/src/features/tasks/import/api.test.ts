import { describe, expect, it, vi } from "vitest";

const { restRpc, restFrom } = vi.hoisted(() => ({ restRpc: vi.fn(), restFrom: vi.fn() }));

vi.mock("@jewelos/api-client", () => ({
  supabase: {
    rest: { rpc: restRpc, from: restFrom },
    rpc(this: { rest: { rpc: typeof restRpc } }, name: string, args: Record<string, unknown>) {
      return this.rest.rpc(name, args);
    },
    from(this: { rest: { from: typeof restFrom } }, table: string) {
      return this.rest.from(table);
    },
  },
}));

import { assignImportedTask, loadAssigningLeftTasks, loadTaskImportBatches, reconcileTaskImportAssignments, saveTaskImportIdentityAlias, validateTaskBulkImport } from "./api";

describe("validateTaskBulkImport", () => {
  it("keeps the Supabase client context while invoking the validation RPC", async () => {
    restRpc.mockResolvedValueOnce({
      data: { valid: true, canonical_hash: "a".repeat(64), summary: {}, issues: [] },
      error: null,
    });

    await expect(validateTaskBulkImport({ tasks: [] }, "a".repeat(64))).resolves.toMatchObject({ valid: true });
  });
});

describe("Assigning Left API", () => {
  it("loads the protected admin queue", async () => {
    restRpc.mockResolvedValueOnce({ data: [{ record_kind: "task", id: "task-1" }], error: null });
    await expect(loadAssigningLeftTasks()).resolves.toEqual([{ record_kind: "task", id: "task-1" }]);
    expect(restRpc).toHaveBeenCalledWith("list_assigning_left_tasks", undefined);
  });

  it("assigns a queued record through the audited RPC", async () => {
    restRpc.mockResolvedValueOnce({ data: { assignment_status: "assigned" }, error: null });
    await expect(assignImportedTask("template", "template-1", "profile-1")).resolves.toMatchObject({ assignment_status: "assigned" });
    expect(restRpc).toHaveBeenCalledWith("assign_imported_task_with_audit", { p_record_kind: "template", p_record_id: "template-1", p_user_profile_id: "profile-1" });
  });
});

describe("task import identity API", () => {
  it("remembers one source label through the audited RPC", async () => {
    restRpc.mockResolvedValueOnce({ data: { saved: true }, error: null });
    await expect(saveTaskImportIdentityAlias("Duplicate Person", "profile-1")).resolves.toMatchObject({ saved: true });
    expect(restRpc).toHaveBeenCalledWith("save_task_import_identity_alias_with_audit", { p_source_label: "Duplicate Person", p_user_profile_id: "profile-1" });
  });

  it("reconciles an uploaded row against existing imported work", async () => {
    restRpc.mockResolvedValueOnce({ data: { updated_count: 1 }, error: null });
    await expect(reconcileTaskImportAssignments([])).resolves.toEqual({ updated_count: 1 });
    expect(restRpc).toHaveBeenCalledWith("reconcile_task_import_assignments", { p_rows: [] });
  });
});

describe("loadTaskImportBatches", () => {
  it("keeps the Supabase client context while loading import history", async () => {
    restFrom.mockReturnValueOnce({
      select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    });

    await expect(loadTaskImportBatches()).resolves.toEqual([]);
  });
});
