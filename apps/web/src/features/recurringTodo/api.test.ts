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

  it("uses the audited RPC when the Edge Function fails for a daily schedule due today", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code" } });
    const rpc = vi.fn().mockResolvedValue({ data: "instance-1", error: null });
    const { supabase } = await import("@jewelos/api-client");
    Object.assign(supabase, { functions: { invoke }, rpc });

    await expect(materializeRecurringTemplate("template-1", {
      recurrence_rule: "FREQ=DAILY",
      schedule_kind: "daily",
      starts_on: "2026-08-27",
    }, "2026-08-27")).resolves.toEqual({ created: 1 });

    expect(rpc).toHaveBeenCalledWith("run_recurring_todo_template_now_with_audit", {
      p_target_date: "2026-08-27",
      p_template_id: "template-1",
    });
  });

  it("does not use the fallback RPC for a weekly schedule that is not due", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code" } });
    const rpc = vi.fn();
    const { supabase } = await import("@jewelos/api-client");
    Object.assign(supabase, { functions: { invoke }, rpc });

    await expect(materializeRecurringTemplate("template-1", {
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO",
      schedule_kind: "weekly",
      starts_on: "2026-08-24",
    }, "2026-08-27")).resolves.toEqual({ created: 0 });

    expect(rpc).not.toHaveBeenCalled();
  });
});
