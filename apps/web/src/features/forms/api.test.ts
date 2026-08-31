import { describe, expect, it, vi } from "vitest";
import { isFormFieldVisible } from "@jewelos/core";

vi.mock("@jewelos/api-client", () => ({ supabase: {} }));

import { deletedFormBundle, deleteForm, publishAsNewForm, savePublishedForm, startFmsFromFormSubmission, toDefinition, type FormField, type FormSubmission, type FormTemplate } from "./api";

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
  it("uses the audited deletion RPC and reports what it took with it", async () => {
    const impact = { form: { id: "published-form", name: "Walk-in", version: 1, lifecycle: "published" }, submissions: 2, taskTemplates: 0, tasks: 0, starterAssignments: 0, flows: [] };
    const rpc = vi.fn().mockResolvedValue({ data: impact, error: null });
    const { supabase } = await import("@jewelos/api-client");
    Object.assign(supabase, { rpc });

    await expect(deleteForm("published-form")).resolves.toEqual(impact);
    expect(rpc).toHaveBeenCalledWith("delete_form_with_audit", { p_template_id: "published-form" });
  });

  it("refuses to report a deletion the server did not confirm", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const { supabase } = await import("@jewelos/api-client");
    Object.assign(supabase, { rpc });

    await expect(deleteForm("published-form")).rejects.toThrow("did not confirm");
  });
});

describe("deletedFormBundle", () => {
  const submission = (snapshot: unknown) => ({ form_template_id: null, template_snapshot: snapshot } as unknown as FormSubmission);

  it("reads a submission whose form was deleted from the snapshot it kept", () => {
    const bundle = deletedFormBundle(submission({
      template: { id: "gone", name: "Walk-in", version: 3, description: null, permissions: { roles: ["staff"] }, sections: [] },
      fields: [{ id: "field-1", field_key: "customer_name", field_name: "Customer name", field_type: "text", sort_order: 0,
        is_required: true, is_shown: true, is_editable: true, placeholder: null, helper_text: null, options: null, validation: {}, conditional_logic: null }],
    }));

    expect(bundle?.name).toBe("Walk-in");
    expect(bundle?.version).toBe(3);
    expect(bundle?.fields.map((field) => field.label)).toEqual(["Customer name"]);
  });

  it("has nothing to show for a submission whose form still exists", () => {
    expect(deletedFormBundle(submission(null))).toBeNull();
    expect(deletedFormBundle(submission({ fields: [] }))).toBeNull();
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
