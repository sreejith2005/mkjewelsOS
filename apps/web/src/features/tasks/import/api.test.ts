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

import { loadTaskImportBatches, validateTaskBulkImport } from "./api";

describe("validateTaskBulkImport", () => {
  it("keeps the Supabase client context while invoking the validation RPC", async () => {
    restRpc.mockResolvedValueOnce({
      data: { valid: true, canonical_hash: "a".repeat(64), summary: {}, issues: [] },
      error: null,
    });

    await expect(validateTaskBulkImport({ tasks: [] }, "a".repeat(64))).resolves.toMatchObject({ valid: true });
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
