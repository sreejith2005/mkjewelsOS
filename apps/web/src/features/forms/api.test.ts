import { describe, expect, it, vi } from "vitest";
import { isFormFieldVisible } from "@jewelos/core";

vi.mock("@jewelos/api-client", () => ({ supabase: {} }));

import { deleteForm, publishAsNewForm, savePublishedForm, startFmsFromFormSubmission, toDefinition, type FormField, type FormTemplate } from "./api";

describe("toDefinition", () => {
  it("does not turn a NULL database condition into a conditional field", () => {
    const template = { name: "Walk-in", description: null, permissions: { roles: ["staff"] } } as unknown as FormTemplate;
    const field = {
      id: "field-1", field_key: "customer_name", field_name: "Customer name", field_type: "text", sort_order: 0,
      is_required: false, is_shown: true, is_editable: true, placeholder: null, helper_text: null,
      options: null, validation: {}, conditional_logic: null,
    } as FormField;

    const definition = toDefinition(template, [field]);

    expect(definition.fields[0]).not.toHaveProperty("condition");
    expect(isFormFieldVisible(definition.fields[0]!, {})).toBe(true);
  });
});

describe("publishAsNewForm", () => {
  it("duplicates the draft into an independent family before publishing it", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "copied-draft", error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const { supabase } = await import("@jewelos/api-client");
    Object.assign(supabase, { rpc });

    await expect(publishAsNewForm("edited-draft")).resolves.toBe("copied-draft");
    expect(rpc).toHaveBeenNthCalledWith(1, "duplicate_form_with_audit", { p_source_template_id: "edited-draft" });
    expect(rpc).toHaveBeenNthCalledWith(2, "publish_form_with_audit", { p_template_id: "copied-draft" });
  });
});

describe("deleteForm", () => {
  it("uses the audited deletion RPC for every deletable lifecycle", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "deleted-form", error: null });
    const { supabase } = await import("@jewelos/api-client");
    Object.assign(supabase, { rpc });

    await expect(deleteForm("published-form")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("delete_form_with_audit", { p_template_id: "published-form" });
  });
});

describe("savePublishedForm", () => {
  it("uses the audited in-place edit RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "published-form", error: null });
    const { supabase } = await import("@jewelos/api-client");
    Object.assign(supabase, { rpc });

    await expect(savePublishedForm("published-form", { name: "Walk-in Form" }, [])).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("save_published_form_with_audit", { p_template_id: "published-form", p_payload: { name: "Walk-in Form" }, p_fields: [] });
  });
});

describe("startFmsFromFormSubmission", () => {
  it("uses the audited workflow trigger after a standalone form submission", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ instance_id: "instance-1", reference_number: "FMS-1" }], error: null });
    const { supabase } = await import("@jewelos/api-client");
    Object.assign(supabase, { rpc });

    await expect(startFmsFromFormSubmission("submission-1")).resolves.toEqual({ instanceId: "instance-1", referenceNumber: "FMS-1" });
    expect(rpc).toHaveBeenCalledWith("start_fms_from_form_submission_with_audit", { p_submission_id: "submission-1" });
  });
});
