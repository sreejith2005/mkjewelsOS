import { describe, expect, it } from "vitest";
import { customerAnswerSnapshot, customerCsvCell, validateCustomerMapping, type CustomerFormMapping } from "./customerIntegration";
import type { FormTemplateDefinition } from "./types";

const form: FormTemplateDefinition = { name: "Synthetic enquiry", sections: [{ key: "one", title: "One" }, { key: "two", title: "Two" }], fields: [
  { key: "phone", label: "Phone", type: "phone", sortOrder: 0, sectionKey: "one" },
  { key: "status", label: "Status", type: "select", sortOrder: 1, sectionKey: "one", options: [{ value: "not_interested", label: "DECISION PENDING" }] },
  { key: "hidden", label: "Hidden", type: "text", sortOrder: 2, shown: false },
  { key: "zero", label: "Budget", type: "number", sortOrder: 3, sectionKey: "two" },
  { key: "false", label: "Confirmed", type: "checkbox", sortOrder: 4, sectionKey: "two" },
  { key: "employee", label: "Owner", type: "user_dropdown", sortOrder: 5 },
  { key: "nested", label: "Evidence", type: "text", sortOrder: 6 },
] };
const mapping: CustomerFormMapping = { schemaVersion: 1, enabled: true, channel: "INSTAGRAM", identityScope: "synthetic-account", fields: [
  { fieldKey: "phone", mode: "both", destination: "primary_phone" },
  { fieldKey: "status", mode: "history", destination: "outcome" },
  { fieldKey: "hidden", mode: "history", destination: "note" },
  { fieldKey: "zero", mode: "both", destination: "budget" },
  { fieldKey: "false", mode: "history", destination: "note" },
  { fieldKey: "nested", mode: "history", destination: "note" },
] };
describe("customer form integration", () => {
  it("requires stable known unique field keys and destination types", () => {
    expect(validateCustomerMapping(form, mapping)).toEqual([]);
    expect(validateCustomerMapping(form, { ...mapping, fields: [...mapping.fields, mapping.fields[0]!] })).toContain("Duplicate question mapping: phone");
    expect(validateCustomerMapping(form, { ...mapping, fields: [{ fieldKey: "missing", mode: "both", destination: "city" }] })).toContain("Unknown question: missing");
    expect(validateCustomerMapping(form, { ...mapping, fields: [{ fieldKey: "status", mode: "profile", destination: "dob" }] })).toContain("Question status cannot supply dob");
  });
  it("keeps assignee answers operational", () => {
    expect(validateCustomerMapping(form, { ...mapping, fields: [{ fieldKey: "employee", mode: "both", destination: "primary_name" }] })).toContain("Question employee is operational");
  });
  it("preserves the actual option meaning rather than interpreting a global token", () => {
    expect(customerAnswerSnapshot(form, mapping, { status: "not_interested" })[0]).toMatchObject({ fieldKey: "status", original: "not_interested", optionLabels: ["DECISION PENDING"] });
  });
  it("excludes blank, absent, hidden and out-of-section answers", () => {
    expect(customerAnswerSnapshot(form, mapping, { phone: "  ", hidden: "secret", zero: 5, status: "not_interested" }, "one").map(x => x.fieldKey)).toEqual(["status"]);
  });
  it("retains false, zero and future nested history without flattening", () => {
    const rows = customerAnswerSnapshot(form, mapping, { zero: 0, false: false, nested: { a: ["x", 0] } });
    expect(rows.map(x => x.original)).toEqual([0, false, { a: ["x", 0] }]);
  });
  it("disabled mappings cannot emit answers", () => {
    expect(customerAnswerSnapshot(form, { ...mapping, enabled: false }, { phone: "9876543210" })).toEqual([]);
  });
  it.each(["=1+1", " +SUM(A1)", "\t@bad", "\r-formula"])("neutralizes spreadsheet text %j", text => {
    expect(customerCsvCell(text)).toBe(`"'${text.replaceAll('"', '""')}"`);
  });
  it("keeps country-coded phones as text and quotes original CSV values", () => {
    expect(customerCsvCell("+6591234567", true)).toBe('"\'+6591234567"');
    expect(customerCsvCell('a,"b"\nnext')).toBe('"a,""b""\nnext"');
  });
});
