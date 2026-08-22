import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => {
  const supabase = {
    rest: {},
    rpc: vi.fn(function (this: unknown, name: string) {
      if (this !== supabase) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
      return Promise.resolve({ data: name === "validate_task_bulk_import" ? { valid: true, canonical_hash: "hash", summary: { requested_count: 1, valid_count: 1, error_count: 0, one_time_count: 1, recurring_count: 0, initial_instance_count: 0 }, issues: [] } : { batch_id: "batch", created_count: 1, replayed: false, outcome: "completed" }, error: null });
    }),
    from: vi.fn(function (this: unknown) {
      if (this !== supabase) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
      return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) };
    }),
  };
  return { supabase };
});

vi.mock("@jewelos/api-client", () => client);

describe("task bulk-import API", () => {
  beforeEach(() => vi.resetModules());

  it("keeps the Supabase client context for validation and import-history calls", async () => {
    const api = await import("./api");
    await expect(api.validateTaskBulkImport({ tasks: [] }, "hash")).resolves.toMatchObject({ valid: true });
    await expect(api.loadTaskImportBatches()).resolves.toEqual([]);
    expect(client.supabase.rpc).toHaveBeenCalledWith("validate_task_bulk_import", expect.anything());
    expect(client.supabase.from).toHaveBeenCalledWith("task_import_batches");
  });
});
