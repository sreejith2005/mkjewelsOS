import { describe, expect, it, vi } from "vitest";
import type { FormBundle } from "@jewelos/data/forms/api";
import { formBuilderDefinition, newFormBuilderDefinition, saveFormBuilder } from "./formBuilderController";

const bundle = (lifecycle: "draft" | "published"): FormBundle => ({
  id: "form-1", tenant_id: "tenant-1", family_id: "family-1", name: "Inspection", description: "", version: 1,
  lifecycle, permissions: { roles: ["staff"] }, sections: [{ key: "section_1", title: "Section 1" }],
  created_at: "2026-01-01", updated_at: "2026-01-01", published_at: null, archived_at: null,
  fields: [{ key: "field_1", label: "Result", type: "text", sortOrder: 0, sectionKey: "section_1" }], submissionCount: 0,
} as unknown as FormBundle);

describe("native form builder lifecycle", () => {
  it("starts a valid empty draft and clones bundle data", () => {
    expect(newFormBuilderDefinition()).toMatchObject({ name: "", sections: [{ key: "section_1" }], fields: [] });
    const source = bundle("draft");
    const definition = formBuilderDefinition(source);
    expect(definition).toMatchObject({ name: "Inspection", fields: [{ key: "field_1" }] });
    expect(definition.fields).not.toBe(source.fields);
  });

  it("delegates draft and published saves to audited data functions", async () => {
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    const savePublishedForm = vi.fn().mockResolvedValue(undefined);
    await saveFormBuilder(bundle("draft"), formBuilderDefinition(bundle("draft")), { saveDraft, savePublishedForm });
    expect(saveDraft).toHaveBeenCalledWith("form-1", expect.anything(), expect.anything());
    await saveFormBuilder(bundle("published"), formBuilderDefinition(bundle("published")), { saveDraft, savePublishedForm });
    expect(savePublishedForm).toHaveBeenCalledWith("form-1", expect.anything(), expect.anything());
  });

  it("keeps a new form new after a failed save so retry uses the same contract", async () => {
    const saveDraft = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const api = { saveDraft, savePublishedForm: vi.fn() };
    const definition = { ...newFormBuilderDefinition(), name: "New form" };
    await expect(saveFormBuilder(undefined, definition, api)).rejects.toThrow("offline");
    await saveFormBuilder(undefined, definition, api);
    expect(saveDraft).toHaveBeenNthCalledWith(2, null, expect.anything(), expect.anything());
  });
});
