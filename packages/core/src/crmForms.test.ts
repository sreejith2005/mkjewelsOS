import { describe, expect, it } from "vitest";
import {
  CRM_QUEUE_TARGETS, checkCrmFormBinding, crmAnswersFromForm, crmLeadTargets, crmStarterForm, crmTargetCandidates,
  dropdownMasterForCrmOption, suggestCrmFieldMap, type CrmLeadFieldConfig,
} from "./crmForms";
import { validateFormDefinition } from "./forms/definition";
import type { FormTemplateDefinition } from "./forms/types";

const queueForm: FormTemplateDefinition = {
  name: "Client queue",
  fields: [
    { key: "heading", label: "Welcome", type: "section_header", sortOrder: 0 },
    { key: "customer_name", label: "Client name", type: "text", sortOrder: 1, required: true, validation: { width: "half" } },
    { key: "phone", label: "Mobile number", type: "phone", sortOrder: 2, required: true, validation: { width: "half" } },
    { key: "visit_reason", label: "Why are they here?", type: "select", sortOrder: 3, options: [{ value: "repair", label: "Repair" }] },
  ],
};

const leadFields: CrmLeadFieldConfig[] = [
  { field_key: "source_of_lead", label: "Source of lead", field_type: "dropdown", is_mandatory: true, is_hidden: false, display_order: 3, option_source: "lookup_source_of_leads" },
  { field_key: "mobile_no", label: "Mobile no", field_type: "text", is_mandatory: false, is_hidden: false, display_order: 2, option_source: null },
  { field_key: "name", label: "Name", field_type: "text", is_mandatory: true, is_hidden: false, display_order: 1, option_source: null },
  { field_key: "dob", label: "Date of birth", field_type: "date", is_mandatory: false, is_hidden: false, display_order: 4, option_source: null },
  { field_key: "old_note", label: "Old note", field_type: "text", is_mandatory: false, is_hidden: true, display_order: 5, option_source: null },
  { field_key: "photo", label: "Photo", field_type: "file", is_mandatory: false, is_hidden: false, display_order: 6, option_source: null },
];

describe("CRM form targets", () => {
  it("takes lead targets from the CRM's own lead field configuration, in CRM order", () => {
    const targets = crmLeadTargets(leadFields);
    expect(targets.map((target) => target.key)).toEqual(["name", "mobile_no", "source_of_lead", "dob"]);
    expect(targets.find((target) => target.key === "mobile_no")).toMatchObject({ required: true, kind: "phone" });
    expect(targets.find((target) => target.key === "source_of_lead")).toMatchObject({ kind: "choice", optionKey: "lookup_source_of_leads" });
    expect(targets.find((target) => target.key === "dob")?.kind).toBe("date");
  });

  it("offers only questions that can hold the CRM answer", () => {
    expect(crmTargetCandidates(queueForm, CRM_QUEUE_TARGETS[1]!).map((field) => field.key)).toEqual(["customer_name", "phone"]);
    expect(crmTargetCandidates(queueForm, CRM_QUEUE_TARGETS[0]!).map((field) => field.key)).toEqual(["customer_name"]);
  });
});

describe("checking a CRM form link", () => {
  it("accepts a complete link by question key", () => {
    expect(checkCrmFormBinding(queueForm, { client_name: "customer_name", mobile: "phone" }, CRM_QUEUE_TARGETS)).toEqual([]);
  });

  it("explains every problem so CRM keeps its standard form until they are fixed", () => {
    const issues = checkCrmFormBinding({ ...queueForm, fields: queueForm.fields.map((field) => field.key === "customer_name" ? { ...field, required: false } : field) },
      { client_name: "customer_name", mobile: "removed", extra: "phone" }, CRM_QUEUE_TARGETS);
    expect(issues.map((issue) => issue.message)).toEqual([
      "\"Client name\" fills Client name, which CRM requires: make the question required in the Form Builder.",
      "The question linked to Mobile number is no longer in the form.",
      "CRM no longer has the answer \"extra\". Remove that link.",
    ]);
    expect(checkCrmFormBinding(queueForm, {}, CRM_QUEUE_TARGETS)).toHaveLength(2);
  });

  it("refuses one question filling two answers and an unsuitable question type", () => {
    const targets = crmLeadTargets(leadFields);
    const form: FormTemplateDefinition = { name: "Lead", fields: [
      { key: "n", label: "Name", type: "text", sortOrder: 0, required: true },
      { key: "m", label: "Mobile", type: "phone", sortOrder: 1, required: true },
      { key: "s", label: "Source", type: "select", sortOrder: 2, required: true, options: [{ value: "x", label: "X" }] },
      { key: "d", label: "Date", type: "text", sortOrder: 3 },
    ] };
    const issues = checkCrmFormBinding(form, { name: "n", mobile_no: "m", source_of_lead: "s", dob: "d" }, targets);
    expect(issues).toEqual([{ targetKey: "dob", fieldKey: "d", message: "\"Date\" cannot fill Date of birth: use a date question." }]);
    expect(checkCrmFormBinding(form, { name: "n", mobile_no: "n", source_of_lead: "s" }, targets).some((issue) => issue.message.includes("already fills"))).toBe(true);
  });

  it("blocks forms with file uploads, which CRM registration cannot save", () => {
    const withFile: FormTemplateDefinition = { ...queueForm, fields: [...queueForm.fields, { key: "proof", label: "ID proof", type: "file", sortOrder: 9 }] };
    expect(checkCrmFormBinding(withFile, { client_name: "customer_name", mobile: "phone" }, CRM_QUEUE_TARGETS).map((issue) => issue.fieldKey)).toEqual(["proof"]);
  });
});

describe("suggesting a link", () => {
  it("matches by key, label or common wording and keeps earlier choices", () => {
    expect(suggestCrmFieldMap(queueForm, CRM_QUEUE_TARGETS)).toEqual({ client_name: "customer_name", mobile: "phone" });
    const form: FormTemplateDefinition = { name: "x", fields: [
      { key: "a", label: "Customer name", type: "text", sortOrder: 0 },
      { key: "b", label: "Full name", type: "text", sortOrder: 1 },
      { key: "c", label: "Contact number", type: "phone", sortOrder: 2 },
    ] };
    expect(suggestCrmFieldMap(form, CRM_QUEUE_TARGETS)).toEqual({ client_name: "a", mobile: "c" });
    expect(suggestCrmFieldMap(form, CRM_QUEUE_TARGETS, { client_name: "b" })).toEqual({ client_name: "b", mobile: "c" });
  });
});

describe("answers for CRM", () => {
  it("uses what the person saw for choices and leaves blanks out", () => {
    expect(crmAnswersFromForm({ name: "n", source_of_lead: "s", dob: "d", city: "c" }, { n: " Asha ", s: "insta", d: "2026-01-02", c: "" }, { s: "Instagram" }))
      .toEqual({ name: "Asha", source_of_lead: "Instagram", dob: "2026-01-02" });
  });
});

describe("starter form", () => {
  it("builds a valid two-per-row form with one question per CRM answer and its link", () => {
    const targets = crmLeadTargets(leadFields);
    const starter = crmStarterForm(targets, new Set(["crm_source"]));
    expect(starter.fields.map((field) => [field.key, field.type, field.required, field.validation?.width])).toEqual([
      ["name", "text", true, "half"], ["mobile_no", "phone", true, "half"], ["source_of_lead", "select", true, "half"], ["dob", "date", false, "half"],
    ]);
    expect(starter.fields[2]?.optionSource).toEqual({ kind: "master", masterType: "crm_source" });
    expect(starter.fieldMap).toEqual({ name: "name", mobile_no: "mobile_no", source_of_lead: "source_of_lead", dob: "dob" });
    const definition = { name: "Lead registration", fields: starter.fields };
    expect(validateFormDefinition(definition)).toEqual([]);
    expect(checkCrmFormBinding(definition, starter.fieldMap, targets)).toEqual([]);
  });

  it("finds the Dropdown Master list behind a CRM choice", () => {
    const types = new Set(["crm_source", "lead_budget", "occasion"]);
    expect(dropdownMasterForCrmOption("lookup_source_of_leads", types)).toBe("crm_source");
    expect(dropdownMasterForCrmOption("budget", types)).toBe("lead_budget");
    expect(dropdownMasterForCrmOption("occasion", types)).toBe("occasion");
    expect(dropdownMasterForCrmOption("unknown", types)).toBeUndefined();
  });
});

describe("question width", () => {
  it("accepts full, half and third only", () => {
    const form = (width: string): FormTemplateDefinition => ({ name: "w", fields: [{ key: "a", label: "A", type: "text", sortOrder: 0, validation: { width: width as "half" } }] });
    expect(validateFormDefinition(form("third"))).toEqual([]);
    expect(validateFormDefinition(form("wide")).map((issue) => issue.code)).toContain("invalid_validation");
  });
});
