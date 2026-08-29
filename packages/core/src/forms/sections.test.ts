import { describe, expect, it } from "vitest";
import {
  FORM_SUBMIT_TARGET,
  formOptionLabel,
  nextOptionValue,
  normalizeFormAnswers,
  normalizeFormDefinition,
  parseFormOptions,
  reachableSectionKeys,
  resolveFormOptions,
  validateCompleteForm,
  validateFormDefinition,
  visibleFormSections,
  type FormFieldDefinition,
  type FormTemplateDefinition,
} from "./index";

const customerType: FormFieldDefinition = {
  key: "customer_type",
  label: "What type of customer are you?",
  type: "select",
  sortOrder: 0,
  sectionKey: "section_1",
  required: true,
  options: [{ value: "individual", label: "Individual" }, { value: "business", label: "Business" }],
  branches: [
    { operator: "equals", value: "individual", targetSectionKey: "individual_details" },
    { operator: "equals", value: "business", targetSectionKey: "business_details" },
  ],
};

const onboarding: FormTemplateDefinition = normalizeFormDefinition({
  name: "Customer Onboarding",
  sections: [
    { key: "section_1", title: "Customer type" },
    { key: "individual_details", title: "Individual Details", next: FORM_SUBMIT_TARGET },
    { key: "business_details", title: "Business Details" },
  ],
  fields: [
    customerType,
    { key: "individual_name", label: "Name", type: "text", sortOrder: 1, sectionKey: "individual_details", required: true },
    { key: "age", label: "Age", type: "number", sortOrder: 2, sectionKey: "individual_details" },
    { key: "company_name", label: "Company Name", type: "text", sortOrder: 3, sectionKey: "business_details", required: true },
    { key: "gst_number", label: "GST Number", type: "text", sortOrder: 4, sectionKey: "business_details", required: true },
  ],
});

const sectionTitles = (answers: Record<string, string>) => visibleFormSections(onboarding, answers).map((entry) => entry.section.title);

describe("Section branching", () => {
  it("accepts a data-driven multi-branch definition", () => {
    expect(validateFormDefinition(onboarding)).toEqual([]);
  });

  it("shows only the branch the controlling answer selects", () => {
    expect(sectionTitles({})).toEqual(["Customer type"]);
    expect(sectionTitles({ customer_type: "individual" })).toEqual(["Customer type", "Individual Details"]);
    expect(sectionTitles({ customer_type: "business" })).toEqual(["Customer type", "Business Details"]);
  });

  it("does not require or keep answers from the branch that is no longer taken", () => {
    const answers = { customer_type: "business", individual_name: "Synthetic Person", company_name: "MK", gst_number: "27AAA" };
    expect(validateCompleteForm(onboarding, answers).valid).toBe(true);
    expect(normalizeFormAnswers(onboarding, answers)).toEqual({ customer_type: "business", company_name: "MK", gst_number: "27AAA" });
  });

  it("still requires the fields of the branch that is taken", () => {
    const issues = validateCompleteForm(onboarding, { customer_type: "individual" }).issues;
    expect(issues.map((issue) => issue.fieldKey)).toEqual(["individual_name"]);
  });

  it("ends the form when a branch targets submit", () => {
    const definition = normalizeFormDefinition({
      ...onboarding,
      fields: onboarding.fields.map((field) => field.key === "customer_type"
        ? { ...field, branches: [{ operator: "equals" as const, value: "individual", targetSectionKey: FORM_SUBMIT_TARGET }] }
        : field),
    });
    expect([...reachableSectionKeys(definition, { customer_type: "individual" })]).toEqual(["section_1"]);
    expect([...reachableSectionKeys(definition, { customer_type: "business" })]).toEqual(["section_1", "individual_details"]);
  });

  it("treats a form without sections as one reachable section", () => {
    const flat = normalizeFormDefinition({ name: "Flat", fields: [{ key: "note", label: "Note", type: "text", sortOrder: 0 }] });
    expect(visibleFormSections(flat, {}).flatMap((entry) => entry.fields.map((field) => field.key))).toEqual(["note"]);
  });

  it("rejects branches that point backwards, at a deleted section, or at a deleted option", () => {
    const broken = normalizeFormDefinition({
      ...onboarding,
      fields: onboarding.fields.map((field) => field.key === "customer_type" ? {
        ...field,
        branches: [
          { operator: "equals" as const, value: "individual", targetSectionKey: "section_1" },
          { operator: "equals" as const, value: "business", targetSectionKey: "deleted_section" },
          { operator: "equals" as const, value: "deleted_option", targetSectionKey: "business_details" },
        ],
      } : field),
    });
    expect(validateFormDefinition(broken).map((issue) => issue.code).sort())
      .toEqual(["backward_branch", "unknown_branch_option", "unknown_branch_target"]);
  });

  it("keeps fields grouped in section order after normalization", () => {
    const shuffled = normalizeFormDefinition({
      ...onboarding,
      fields: [...onboarding.fields].reverse().map((field, index) => ({ ...field, sortOrder: index })),
    });
    expect(shuffled.fields.map((field) => field.sectionKey)).toEqual(["section_1", "individual_details", "individual_details", "business_details", "business_details"]);
    expect(validateFormDefinition(shuffled)).toEqual([]);
  });
});

describe("Option identity", () => {
  it("reads both the historical string options and stable identified options", () => {
    expect(parseFormOptions(["Individual", " Business "])).toEqual([{ value: "Individual", label: "Individual" }, { value: "Business", label: "Business" }]);
    expect(parseFormOptions([{ value: "individual", label: "Individual" }])).toEqual([{ value: "individual", label: "Individual" }]);
  });

  it("keeps a branch working after the option label is renamed", () => {
    const renamed = normalizeFormDefinition({
      ...onboarding,
      fields: onboarding.fields.map((field) => field.key === "customer_type"
        ? { ...field, options: [{ value: "individual", label: "Retail buyer" }, { value: "business", label: "Business" }] }
        : field),
    });
    expect(validateFormDefinition(renamed)).toEqual([]);
    expect(visibleFormSections(renamed, { customer_type: "individual" }).map((entry) => entry.section.key)).toEqual(["section_1", "individual_details"]);
    expect(formOptionLabel(renamed.fields[0]?.options, "individual")).toBe("Retail buyer");
  });

  it("builds collision-free values for new options", () => {
    expect(nextOptionValue(" Lead Source ", [])).toBe("lead_source");
    expect(nextOptionValue("Lead Source", ["lead_source"])).toBe("lead_source_2");
  });

  it("resolves a Dropdown Master reference without copying the master options", () => {
    const referencing = normalizeFormDefinition({
      name: "Lead",
      fields: [{ key: "lead_status", label: "Lead status", type: "select", sortOrder: 0, optionSource: { kind: "master", masterType: "lead_status" } }],
    });
    expect(referencing.fields[0]?.options).toBeUndefined();
    expect(validateFormDefinition(referencing)).toEqual([]);
    const resolved = resolveFormOptions(referencing, [
      { masterType: "lead_status", value: "new", label: "New" },
      { masterType: "crm_source", value: "walk_in", label: "Walk-in" },
    ]);
    expect(resolved.fields[0]?.options).toEqual([{ value: "new", label: "New" }]);
    expect(validateCompleteForm(resolved, { lead_status: "new" }).valid).toBe(true);
    expect(validateCompleteForm(resolved, { lead_status: "walk_in" }).issues[0]?.code).toBe("invalid_option");
  });
});
