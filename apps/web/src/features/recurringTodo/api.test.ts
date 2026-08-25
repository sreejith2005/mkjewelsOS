import { describe, expect, it, vi } from "vitest";

vi.mock("@jewelos/api-client", () => ({ supabase: {} }));

import { materializeRecurringTemplate } from "./api";

describe("materializeRecurringTemplate", () => {
  it("invokes the authenticated immediate-materialization function", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { created: 1 }, error: null });
    const { supabase } = await import("@jewelos/api-client");
    Object.assign(supabase, { functions: { invoke } });

    await expect(materializeRecurringTemplate("template-1")).resolves.toEqual({ created: 1 });
    expect(invoke).toHaveBeenCalledWith("materialize-recurring-schedule", {
      body: { template_id: "template-1" },
      method: "POST",
    });
  });
});
